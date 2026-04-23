#!/usr/bin/env bash
# Update AMASS-CRM pe un VPS care a fost deploy-at cu bootstrap-vps.sh.
#
# Ce face (în ordine):
#   1) git pull pe /opt/amass (refresh cod)
#   2) docker compose build (rebuild imaginile care s-au schimbat)
#   3) docker compose up -d (recrează containere cu imagini noi)
#   4) rulează prisma migrate deploy (aplică migrările noi, dacă există)
#   5) afișează status-ul serviciilor + diff-ul de commits
#
# Safe: nu șterge volumele (Postgres + MinIO + Redis persistă).
# Downtime: ~30-60s pentru api/web, zero pentru DB/Redis/MinIO.
#
# Usage (pe server, ca root):
#   /root/update.sh                # update pe branch-ul curent (main)
#   /root/update.sh --branch=dev   # switch + update pe alt branch

set -eu

BRANCH="main"
for arg in "$@"; do
  case $arg in
    --branch=*) BRANCH="${arg#*=}" ;;
    *) echo "unknown arg: $arg" ; exit 1 ;;
  esac
done

INSTALL_DIR="/opt/amass"
COMPOSE="docker compose -f $INSTALL_DIR/infra/docker-compose.yml --env-file $INSTALL_DIR/.env"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
[[ -d "$INSTALL_DIR/.git" ]] || { echo "No install found at $INSTALL_DIR. Run bootstrap-vps.sh first."; exit 1; }

cd "$INSTALL_DIR"

log "Fetching latest from GitHub (branch=$BRANCH)"
OLD_SHA=$(git rev-parse HEAD)
git fetch --all --quiet
git checkout "$BRANCH" --quiet
git pull --ff-only
NEW_SHA=$(git rev-parse HEAD)

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  log "Already up to date ($NEW_SHA) — no rebuild needed"
  exit 0
fi

log "Commits pulled:"
git log --oneline "$OLD_SHA..$NEW_SHA"

log "Rebuilding images (may take 3-8 min with cache)"
$COMPOSE build --pull

log "Recreating containers"
$COMPOSE up -d

log "Applying Prisma migrations (idempotent)"
docker exec amass-api pnpm --filter @amass/api exec prisma migrate deploy \
  || warn "migrate deploy failed — review 'docker logs amass-api'"

log "Service status"
docker ps --format 'table {{.Names}}\t{{.Status}}' | head -12

log "Done. Old=$OLD_SHA → New=$NEW_SHA"
