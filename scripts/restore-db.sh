#!/bin/sh
# AMASS-CRM — restore Postgres from a backup in S3-compatible object storage.
#
# DANGEROUS. This drops the target database and recreates it from a pg_dump.
# Requires `--confirm-i-want-to-destroy-prod` as an explicit safety flag.
#
# Usage:
#   restore-db.sh --confirm-i-want-to-destroy-prod
#       → interactive: lists last 30 backups, asks user to pick by index
#   restore-db.sh --confirm-i-want-to-destroy-prod --file s3://.../2026-05-15_020000.dump
#       → non-interactive: restores the specified dump
#   restore-db.sh --confirm-i-want-to-destroy-prod --file 2026-05-15_020000.dump
#       → resolves relative to s3://${BACKUP_BUCKET}/db/<file>
#
# Required env (same as backup-db.sh): PGHOST PGUSER PGPASSWORD PGDATABASE
#   BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
#   BACKUP_BUCKET (default: amass-backups)

set -eu
# shellcheck disable=SC3040
(set -o pipefail 2>/dev/null) && set -o pipefail

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "FATAL: $*"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: restore-db.sh --confirm-i-want-to-destroy-prod [--file <path-or-s3-url>]

Required flag:
  --confirm-i-want-to-destroy-prod   acknowledge that this DROPS the target DB

Optional:
  --file <path>     skip the interactive picker; restore the given dump.
                    Accepts a bare filename (resolved against the backup bucket),
                    a backup/... alias path, or a local file path.

Env vars:
  PGHOST PGUSER PGPASSWORD PGDATABASE
  BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY
  BACKUP_BUCKET (default: amass-backups)
EOF
}

# ---------------------------------------------------------------------------
# 1. Parse flags
# ---------------------------------------------------------------------------
CONFIRMED=0
FILE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm-i-want-to-destroy-prod) CONFIRMED=1; shift ;;
    --file) FILE_ARG="${2:-}"; shift 2 ;;
    --file=*) FILE_ARG="${1#--file=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (run with --help)" ;;
  esac
done

if [ "$CONFIRMED" -ne 1 ]; then
  log "ERROR: refusing to run without --confirm-i-want-to-destroy-prod"
  usage
  exit 2
fi

# ---------------------------------------------------------------------------
# 2. Validate env
# ---------------------------------------------------------------------------
: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY required}"
BACKUP_BUCKET="${BACKUP_BUCKET:-amass-backups}"

# ---------------------------------------------------------------------------
# 3. Configure mc alias
# ---------------------------------------------------------------------------
log "configuring mc alias 'backup' → ${BACKUP_S3_ENDPOINT}"
mc alias set backup "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" >/dev/null \
  || die "mc alias set failed"

# ---------------------------------------------------------------------------
# 4. Pick the dump to restore
# ---------------------------------------------------------------------------
TMP_DIR="$(mktemp -d -t amass-restore-XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM
LOCAL_DUMP="${TMP_DIR}/restore.dump"

if [ -n "$FILE_ARG" ]; then
  case "$FILE_ARG" in
    backup/*|s3://*) SRC="$FILE_ARG" ;;
    /*) SRC="$FILE_ARG" ;;  # absolute local path
    *)  SRC="backup/${BACKUP_BUCKET}/db/${FILE_ARG}" ;;
  esac
  log "explicit file selected: ${SRC}"
else
  log "listing last 30 dumps in s3://${BACKUP_BUCKET}/db/"
  # mc ls outputs: <date> <time> <tz> <size> <name>. We sort newest-last by
  # default; reverse so newest=first and cap at 30.
  LIST_FILE="${TMP_DIR}/list.txt"
  mc ls "backup/${BACKUP_BUCKET}/db/" 2>/dev/null \
    | awk '{print $NF}' \
    | sort -r \
    | head -n 30 > "$LIST_FILE" \
    || die "mc ls failed"

  COUNT="$(wc -l < "$LIST_FILE" | tr -d ' ')"
  if [ "$COUNT" -eq 0 ]; then
    die "no dumps found in s3://${BACKUP_BUCKET}/db/"
  fi

  log "available dumps (newest first):"
  i=1
  while IFS= read -r line; do
    printf '  [%d] %s\n' "$i" "$line"
    i=$((i + 1))
  done < "$LIST_FILE"

  printf 'Pick a dump [1-%s]: ' "$COUNT"
  read -r CHOICE
  case "$CHOICE" in
    ''|*[!0-9]*) die "invalid choice: '$CHOICE'" ;;
  esac
  if [ "$CHOICE" -lt 1 ] || [ "$CHOICE" -gt "$COUNT" ]; then
    die "choice out of range: $CHOICE"
  fi
  PICKED="$(sed -n "${CHOICE}p" "$LIST_FILE")"
  SRC="backup/${BACKUP_BUCKET}/db/${PICKED}"
  log "selected: ${SRC}"
fi

# ---------------------------------------------------------------------------
# 5. Download (skip if SRC is already a local path)
# ---------------------------------------------------------------------------
case "$SRC" in
  /*)
    log "using local dump file: ${SRC}"
    cp "$SRC" "$LOCAL_DUMP" || die "local copy failed"
    ;;
  *)
    log "downloading ${SRC} → ${LOCAL_DUMP}"
    mc cp "$SRC" "$LOCAL_DUMP" >/dev/null || die "mc cp download failed"
    ;;
esac

DUMP_SIZE_BYTES="$(wc -c < "$LOCAL_DUMP" | tr -d ' ')"
log "dump downloaded size=${DUMP_SIZE_BYTES}B"

# ---------------------------------------------------------------------------
# 6. Final confirmation prompt (belt + suspenders alongside the flag)
# ---------------------------------------------------------------------------
log "ABOUT TO DROP AND RECREATE database '${PGDATABASE}' on host '${PGHOST}'"
printf 'Type the database name (%s) to proceed: ' "$PGDATABASE"
read -r TYPED
if [ "$TYPED" != "$PGDATABASE" ]; then
  die "confirmation mismatch — aborting"
fi

# ---------------------------------------------------------------------------
# 7. dropdb + createdb + pg_restore
# ---------------------------------------------------------------------------
log "dropdb ${PGDATABASE}"
dropdb --if-exists --host="${PGHOST}" --username="${PGUSER}" "${PGDATABASE}" \
  || die "dropdb failed"

log "createdb ${PGDATABASE}"
createdb --host="${PGHOST}" --username="${PGUSER}" "${PGDATABASE}" \
  || die "createdb failed"

log "pg_restore (verbose, no-owner, no-acl) → ${PGDATABASE}"
pg_restore \
  --host="${PGHOST}" \
  --username="${PGUSER}" \
  --dbname="${PGDATABASE}" \
  --verbose \
  --no-owner \
  --no-acl \
  "$LOCAL_DUMP" \
  || die "pg_restore failed"

log "restore complete; verify with: psql -c 'SELECT count(*) FROM tenants;'"
exit 0
