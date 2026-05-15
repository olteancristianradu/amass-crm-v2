#!/usr/bin/env bash
# Manual rollback for AMASS-CRM on a VPS.
#
# Use cases:
#   - update-vps.sh's auto-rollback didn't run (e.g. host crashed mid-deploy);
#   - you need to revert to an older SHA after a successful deploy because
#     a bug surfaced only under real traffic;
#   - a planned rollback to ship a known-good build while the fix is in CI.
#
# This script does NOT call backup-db.sh. It only restores CODE +
# CONTAINERS to the requested SHA. Schema-changing migrations are NOT
# auto-reverted — if the data has diverged, restore from a recent backup
# (see docs/INCIDENT_RESPONSE.md "Database Restore").
#
# Usage:
#   /opt/amass/scripts/rollback-vps.sh --to <SHA-OR-BRANCH>
#
# A confirm prompt requires the same value to be typed back. There is no
# --yes flag on purpose — rollback is rare and should remain a deliberate
# human action.

set -euo pipefail

TARGET=""

usage() {
  cat <<'EOF'
rollback-vps.sh — manual rollback to a specific git SHA or branch

Usage:
  rollback-vps.sh --to <SHA-OR-BRANCH> [-h|--help]

Required:
  --to VALUE   The git ref to roll back to (full or short SHA, or branch).
               You will be prompted to type the value again to confirm.

What it does (in order):
  1. preflight (root, /opt/amass exists, docker running, ref resolves)
  2. confirm prompt (type the ref again)
  3. git checkout <ref>
  4. docker compose build api web ai-worker
  5. docker compose up -d --force-recreate api web ai-worker
  6. health-check /api/v1/health (60s budget)

What it does NOT do:
  - Touch any data volume (Postgres / MinIO / Redis stay untouched).
  - Revert Prisma migrations. Schema-changing migrations applied after
    the target SHA may leave the old code unable to read the new schema.
    If the app misbehaves after rollback: restore from backup, see
    docs/INCIDENT_RESPONSE.md "Database Restore".

  -h, --help   Show this message and exit.
EOF
}

for arg in "$@"; do
  case $arg in
    --to=*)  TARGET="${arg#*=}" ;;
    --to)    shift; TARGET="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *)
      # Allow `--to <val>` form by treating a bare value after --to as the target.
      if [[ -z "$TARGET" && "$arg" != --* ]]; then
        TARGET="$arg"
      else
        echo "unknown arg: $arg (try --help)"; exit 1
      fi
      ;;
  esac
done

[[ -n "$TARGET" ]] || { usage; exit 1; }

# ── Constants ─────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/amass"
COMPOSE_BASE="$INSTALL_DIR/infra/docker-compose.yml"
COMPOSE_PROD="$INSTALL_DIR/infra/docker-compose.prod.yml"
ENV_FILE_PROD="$INSTALL_DIR/.env.production"
ENV_FILE_DEV="$INSTALL_DIR/.env"

if [[ -f "$ENV_FILE_PROD" ]]; then
  ENV_FILE="$ENV_FILE_PROD"
  COMPOSE="docker compose -f $COMPOSE_BASE -f $COMPOSE_PROD --env-file $ENV_FILE"
else
  ENV_FILE="$ENV_FILE_DEV"
  COMPOSE="docker compose -f $COMPOSE_BASE --env-file $ENV_FILE"
fi

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"
HEALTH_RETRIES=30
HEALTH_SLEEP=2

CURRENT_PHASE="rollback"

# ── Logging ───────────────────────────────────────────────────────────────
_ts()  { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '\033[1;36m[%s][%s] %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*"; }
warn() { printf '\033[1;33m[%s][%s] ! %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*" >&2; }
die()  { printf '\033[1;31m[%s][%s] ✗ %s\033[0m\n' "$(_ts)" "$CURRENT_PHASE" "$*" >&2; exit 1; }

# ─────────────────────────────────────────────────────────────────────────
# 1. preflight
# ─────────────────────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run as root."
[[ -d "$INSTALL_DIR/.git" ]] || die "No git repo at $INSTALL_DIR."
docker info >/dev/null 2>&1 || die "docker daemon not responsive."

cd "$INSTALL_DIR"

CURRENT_SHA="$(git rev-parse HEAD)"

# Make sure the ref the operator typed actually resolves to something we
# can check out. `git fetch` first in case they want a SHA that arrived
# after the last update-vps.sh run.
git fetch --all --quiet
if ! TARGET_SHA="$(git rev-parse --verify "$TARGET^{commit}" 2>/dev/null)"; then
  die "Target '$TARGET' does not resolve to a commit. Did you forget to fetch?"
fi

log "current SHA = $CURRENT_SHA"
log "target  ref = $TARGET → $TARGET_SHA"

if [[ "$TARGET_SHA" == "$CURRENT_SHA" ]]; then
  log "already at $TARGET_SHA — nothing to do"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────
# 2. confirm prompt
# ─────────────────────────────────────────────────────────────────────────
cat <<EOF

==========================================================================
  ROLLBACK CONFIRMATION

  This will:
    - Check out '$TARGET' ($TARGET_SHA) over the current HEAD
      ($CURRENT_SHA).
    - Rebuild and recreate api / web / ai-worker.
    - NOT revert any Prisma migration. If the app misbehaves after
      rollback, restore from backup — docs/INCIDENT_RESPONSE.md
      section "Database Restore".

  Type the ref again to confirm (or Ctrl-C to abort):
==========================================================================
EOF

printf 'Type the SHA again to confirm: '
read -r CONFIRM
if [[ "$CONFIRM" != "$TARGET" ]]; then
  die "confirmation mismatch — aborting"
fi

# ─────────────────────────────────────────────────────────────────────────
# 3. checkout
# ─────────────────────────────────────────────────────────────────────────
log "git checkout $TARGET_SHA"
git checkout "$TARGET_SHA" --quiet

# ─────────────────────────────────────────────────────────────────────────
# 4. build
# ─────────────────────────────────────────────────────────────────────────
log "building api/web/ai-worker at $TARGET_SHA"
$COMPOSE build api web ai-worker

# ─────────────────────────────────────────────────────────────────────────
# 5. recreate
# ─────────────────────────────────────────────────────────────────────────
log "recreating containers (--force-recreate)"
$COMPOSE up -d --force-recreate api web ai-worker

# ─────────────────────────────────────────────────────────────────────────
# 6. health-check
# ─────────────────────────────────────────────────────────────────────────
log "waiting for $HEALTH_URL (up to $((HEALTH_RETRIES * HEALTH_SLEEP))s)"
for ((i = 1; i <= HEALTH_RETRIES; i++)); do
  if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    log "health OK on attempt $i ($((i * HEALTH_SLEEP))s)"
    log "rollback successful — service restored at $TARGET_SHA"

    # Final reminder: DB schema may not match the code we just rolled back to.
    cat <<EOF

  NOTE: Schema migrations were NOT reverted. If the rolled-back code
  hits a DB shape it doesn't understand (500 errors, "column does not
  exist", etc.), restore from a recent backup — see
  docs/INCIDENT_RESPONSE.md section "Database Restore".

EOF
    exit 0
  fi
  sleep "$HEALTH_SLEEP"
done

warn "health-check FAILED after $((HEALTH_RETRIES * HEALTH_SLEEP))s — service may be DOWN"
warn "page on-call and consult docs/INCIDENT_RESPONSE.md"
exit 1
