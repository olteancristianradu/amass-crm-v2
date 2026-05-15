#!/usr/bin/env bash
# Update AMASS-CRM pe un VPS deploy-at cu bootstrap-vps.sh.
#
# Hardened update flow (D3-VPS-PR2):
#   PHASE 0 — preflight (perms, repo, docker daemon, capture ROLLBACK_SHA)
#   PHASE 1 — pre-update DB backup via db-backup sidecar (blocking)
#   PHASE 2 — git fetch + checkout + build new images
#   PHASE 3 — apply Prisma migrations in a one-shot container with NEW image
#   PHASE 4 — recreate api/web/ai-worker + wait for /api/v1/health
#   PHASE 5 — auto-rollback on any failure (checkout ROLLBACK_SHA, rebuild, recreate)
#   PHASE 6 — report (status, applied commits, elapsed time)
#
# Safe-by-default: data volumes (Postgres / MinIO / Redis) are never touched.
# Schema migrations are NOT auto-reverted on rollback — restore from the
# PHASE-1 backup via docs/INCIDENT_RESPONSE.md if data has diverged.
#
# Usage (pe server, ca root):
#   /opt/amass/scripts/update-vps.sh                # update pe main
#   /opt/amass/scripts/update-vps.sh --branch=dev   # switch + update pe alt branch
#   /opt/amass/scripts/update-vps.sh --skip-backup  # emergency hot-fix (DANGEROUS)
#   /opt/amass/scripts/update-vps.sh --help         # afișează acest usage

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────
BRANCH="main"
SKIP_BACKUP="no"

usage() {
  cat <<'EOF'
update-vps.sh — hardened rolling update for AMASS-CRM

Usage:
  update-vps.sh [--branch=NAME] [--skip-backup] [-h|--help]

Options:
  --branch=NAME    Git branch to deploy (default: main).
  --skip-backup    Skip PHASE-1 pre-update DB backup. ONLY for emergency
                   hot-fixes when the backup pipeline itself is broken.
                   Logs a loud warning. Auto-rollback still works, but
                   any schema-changing migration becomes unrecoverable
                   without a recent backup.
  -h, --help       Show this message and exit.

Phases (each logged with a timestamp + phase tag):
  0 preflight  · 1 db-backup · 2 fetch+build · 3 migrate ·
  4 recreate+health · 5 rollback (on failure) · 6 report

On any failure in phases 1–4, the script auto-rolls back containers to
the previous git SHA and re-runs the health check. See
docs/INCIDENT_RESPONSE.md#rolling-update--rollback.
EOF
}

for arg in "$@"; do
  case $arg in
    --branch=*)    BRANCH="${arg#*=}" ;;
    --skip-backup) SKIP_BACKUP="yes" ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "unknown arg: $arg (try --help)"; exit 1 ;;
  esac
done

# ── Constants ─────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/amass"
COMPOSE_BASE="$INSTALL_DIR/infra/docker-compose.yml"
COMPOSE_PROD="$INSTALL_DIR/infra/docker-compose.prod.yml"
ENV_FILE_PROD="$INSTALL_DIR/.env.production"
ENV_FILE_DEV="$INSTALL_DIR/.env"

# Prefer .env.production if present (matches prod overlay); fall back to .env
# so dev VPSes (single-env-file setup) still work.
if [[ -f "$ENV_FILE_PROD" ]]; then
  ENV_FILE="$ENV_FILE_PROD"
  COMPOSE="docker compose -f $COMPOSE_BASE -f $COMPOSE_PROD --env-file $ENV_FILE"
else
  ENV_FILE="$ENV_FILE_DEV"
  COMPOSE="docker compose -f $COMPOSE_BASE --env-file $ENV_FILE"
fi

# Health endpoint. The api service exposes /api/v1/health on port 3000
# inside the container; in prod it's behind Caddy but the container port
# is still reachable on the docker network from the host loopback.
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"
# 60s total budget: 30 iterations × 2s sleep. Matches the api container's
# `start_period: 30s` healthcheck plus a generous buffer for migration-heavy
# boots. Long enough for cold Nest startup; short enough to surface a hard
# failure before the operator gives up.
HEALTH_RETRIES=30
HEALTH_SLEEP=2

CURRENT_PHASE="init"
ROLLBACK_SHA=""
NEW_SHA=""
START_TS="$(date +%s)"

# ── Logging ───────────────────────────────────────────────────────────────
_ts()  { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '\033[1;36m[%s][%s] %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*"; }
warn() { printf '\033[1;33m[%s][%s] ! %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*" >&2; }
die()  { printf '\033[1;31m[%s][%s] ✗ %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*" >&2; exit 1; }

# ── Rollback ──────────────────────────────────────────────────────────────
# Called by trap on any non-zero exit during phases 1–4 (we disarm it after
# the success path completes). The trap captures the *exit code at moment
# of failure* — restoring it after the rollback so the script still exits
# non-zero, which matters for the calling shell (cron / CI / operator).
rollback() {
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    return 0
  fi

  local FAILED_PHASE="$CURRENT_PHASE"
  CURRENT_PHASE="PHASE-5"

  if [[ -z "$ROLLBACK_SHA" ]]; then
    warn "no ROLLBACK_SHA captured — cannot auto-rollback. Exit rc=$rc"
    exit "$rc"
  fi

  warn "FAILURE in $FAILED_PHASE (rc=$rc) — auto-rollback to $ROLLBACK_SHA"

  # 1. Reset git working tree to the previous SHA.
  if ! git -C "$INSTALL_DIR" checkout "$ROLLBACK_SHA" --quiet; then
    warn "git checkout $ROLLBACK_SHA FAILED — manual intervention required"
    exit "$rc"
  fi

  # 2. Rebuild images at the old SHA. We do NOT use --pull here: the base
  # images are already on disk and we want the FASTEST possible recovery.
  log "rebuilding api/web/ai-worker at $ROLLBACK_SHA (no --pull, cache-friendly)"
  if ! $COMPOSE build api web ai-worker; then
    warn "rollback build FAILED — services may stay on the broken image"
    exit "$rc"
  fi

  # 3. Force-recreate so the old image is in service even if container hash
  # would otherwise match.
  log "recreating containers from $ROLLBACK_SHA"
  if ! $COMPOSE up -d --force-recreate api web ai-worker; then
    warn "rollback up FAILED — services may be down"
    exit "$rc"
  fi

  # 4. Health-check the rollback. If this fails, the operator must page in.
  if wait_for_health; then
    log "rollback healthy — service restored at $ROLLBACK_SHA"
  else
    warn "rollback health-check FAILED after $((HEALTH_RETRIES * HEALTH_SLEEP))s"
    warn "service may be DOWN — page on-call and consult docs/INCIDENT_RESPONSE.md"
  fi

  # 5. Migration warning. Critical: if PHASE-3 partially applied a schema
  # change, the old code may not be able to read the new schema. We do NOT
  # attempt to revert migrations automatically — that's destructive and
  # belongs in the human-driven restore flow.
  if [[ "$FAILED_PHASE" == "PHASE-3" || "$FAILED_PHASE" == "PHASE-4" ]]; then
    cat >&2 <<EOF

  ╔══════════════════════════════════════════════════════════════════════╗
  ║                       !!!  DB DRIFT WARNING  !!!                     ║
  ╠══════════════════════════════════════════════════════════════════════╣
  ║  Migrations may have partially applied before the failure.           ║
  ║  Auto-rollback restored the CODE but NOT the SCHEMA.                 ║
  ║  If the app misbehaves (500s, "column does not exist", etc.):        ║
  ║                                                                      ║
  ║    1) Stop traffic: $COMPOSE stop api web ai-worker
  ║    2) Restore from PHASE-1 backup: see docs/INCIDENT_RESPONSE.md     ║
  ║       section "Database Restore"                                     ║
  ║    3) Start traffic back up                                          ║
  ╚══════════════════════════════════════════════════════════════════════╝

EOF
  fi

  exit "$rc"
}
trap rollback EXIT

# ── Health check helper ───────────────────────────────────────────────────
# Polls $HEALTH_URL up to $HEALTH_RETRIES × $HEALTH_SLEEP seconds.
# Returns 0 on first 2xx, 1 on timeout.
wait_for_health() {
  local i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
      log "health OK on attempt $i ($((i * HEALTH_SLEEP))s)"
      return 0
    fi
    sleep "$HEALTH_SLEEP"
  done
  return 1
}

# ─────────────────────────────────────────────────────────────────────────
# PHASE 0 — preflight
# ─────────────────────────────────────────────────────────────────────────
CURRENT_PHASE="PHASE-0"
log "preflight — verifying environment"

[[ $EUID -eq 0 ]] || die "Run as root (this script touches /opt/amass and docker)."
[[ -d "$INSTALL_DIR/.git" ]] || die "No git repo at $INSTALL_DIR. Run bootstrap-vps.sh first."
[[ -f "$ENV_FILE" ]] || die "No env file at $ENV_FILE."
[[ -f "$COMPOSE_BASE" ]] || die "Missing $COMPOSE_BASE."

if ! docker info >/dev/null 2>&1; then
  die "docker daemon not responsive — is the daemon running?"
fi

cd "$INSTALL_DIR"

# Capture the current SHA BEFORE we touch anything. This is the safety net
# we roll back to if any later phase fails.
ROLLBACK_SHA="$(git rev-parse HEAD)"
log "current SHA = $ROLLBACK_SHA"
log "target branch = $BRANCH"
log "compose      = $COMPOSE"

# ─────────────────────────────────────────────────────────────────────────
# PHASE 1 — pre-update DB backup
# ─────────────────────────────────────────────────────────────────────────
CURRENT_PHASE="PHASE-1"
if [[ "$SKIP_BACKUP" == "yes" ]]; then
  warn "================================================================"
  warn "  --skip-backup ACTIVE — NO pre-update backup will be taken."
  warn "  If this update partially fails, recent writes may be"
  warn "  unrecoverable. Use ONLY for emergency hot-fixes when the"
  warn "  backup pipeline itself is broken."
  warn "================================================================"
else
  log "pre-update DB backup via db-backup sidecar"

  # The db-backup service is defined in docker-compose.prod.yml. On dev
  # VPSes without the prod overlay we have no automated backup path —
  # warn and continue so single-host dev deploys still work.
  if ! $COMPOSE config --services 2>/dev/null | grep -qx 'db-backup'; then
    warn "db-backup service not declared (no prod overlay?) — skipping backup"
    warn "if this is a production host, add docker-compose.prod.yml and re-run"
  else
    # `docker compose run --rm` builds the image on demand (cached) and
    # runs backup-db.sh once. The script is idempotent: ts-stamped dumps,
    # safe to run alongside the nightly cron. We override the entrypoint
    # because the service's default CMD is `crond -f` (long-running).
    if ! $COMPOSE run --rm \
        --entrypoint /usr/local/bin/backup-db.sh \
        db-backup; then
      die "pre-update backup FAILED — refusing to proceed (operator must fix backup pipeline first; pass --skip-backup to override after verifying the risk)"
    fi
    log "pre-update backup complete"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────
# PHASE 2 — fetch + build
# ─────────────────────────────────────────────────────────────────────────
CURRENT_PHASE="PHASE-2"
log "git fetch + checkout $BRANCH"

git fetch --all --quiet
NEW_SHA="$(git rev-parse "origin/${BRANCH}")"

if [[ "$NEW_SHA" == "$ROLLBACK_SHA" ]]; then
  # No-op: nothing to deploy. Disarm the rollback trap (success path) and
  # exit cleanly so cron / cron-like callers see rc=0.
  log "already up to date ($NEW_SHA) — no rebuild needed"
  trap - EXIT
  exit 0
fi

git checkout "$BRANCH" --quiet
git pull --ff-only --quiet
log "pulled $ROLLBACK_SHA → $NEW_SHA"
log "commits in this update:"
git log --oneline "$ROLLBACK_SHA..$NEW_SHA"

log "building api/web/ai-worker (3-8 min with cache)"
# --pull refreshes base images (node, alpine, etc.) so security patches land.
# Building only the three app services keeps the build window minimal —
# postgres/redis/minio/caddy are upstream pulls, not local rebuilds.
$COMPOSE build --pull api web ai-worker

# ─────────────────────────────────────────────────────────────────────────
# PHASE 3 — apply migrations (with the NEW image, in a one-shot container)
# ─────────────────────────────────────────────────────────────────────────
CURRENT_PHASE="PHASE-3"
log "applying Prisma migrations (one-shot container, NEW image)"

# `docker compose run --rm api ...` boots a fresh container off the image
# we just built (PHASE 2) without touching the running api container.
# This means:
#   - migrations run against the schema the NEW code expects (not the old);
#   - if the migration fails, the running api stays on the OLD image with
#     the OLD schema until rollback restores both.
# prisma migrate deploy is idempotent — safe to re-run if interrupted.
if ! $COMPOSE run --rm --no-deps \
    api \
    pnpm --filter @amass/api exec prisma migrate deploy; then
  die "prisma migrate deploy FAILED — triggering rollback"
fi
log "migrations applied"

# ─────────────────────────────────────────────────────────────────────────
# PHASE 4 — recreate containers + health-check
# ─────────────────────────────────────────────────────────────────────────
CURRENT_PHASE="PHASE-4"
log "recreating api/web/ai-worker with new images"

# We deliberately do NOT --force-recreate here. Compose will recreate the
# containers whose image changed (api/web/ai-worker after the rebuild) and
# leave postgres/redis/minio/caddy alone. That's a smaller blast radius.
$COMPOSE up -d api web ai-worker

log "waiting for $HEALTH_URL (up to $((HEALTH_RETRIES * HEALTH_SLEEP))s)"
if ! wait_for_health; then
  die "health-check timed out after $((HEALTH_RETRIES * HEALTH_SLEEP))s — triggering rollback"
fi

# ─────────────────────────────────────────────────────────────────────────
# PHASE 6 — report (success path; PHASE 5 only fires from the trap)
# ─────────────────────────────────────────────────────────────────────────
# Disarm the rollback trap — we made it through all the risky phases.
trap - EXIT
CURRENT_PHASE="PHASE-6"

log "deploy successful — final report"
$COMPOSE ps
echo
log "commits applied in this rollout:"
git log --oneline "$ROLLBACK_SHA..$NEW_SHA"
echo

ELAPSED=$(( $(date +%s) - START_TS ))
log "old=$ROLLBACK_SHA → new=$NEW_SHA (elapsed=${ELAPSED}s)"
log "done"
