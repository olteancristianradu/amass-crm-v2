#!/bin/sh
# AMASS-CRM — nightly Postgres backup → S3-compatible object storage.
#
# Runs inside the `db-backup` container (Alpine + postgresql16-client + mc).
# Triggered by busybox-crond at 02:00 Europe/Bucharest (see infra/db-backup/crontab).
#
# What it does:
#   1. pg_dump --format=custom --compress=9 (Postgres custom format; built-in zstd-like compression)
#   2. mc cp the dump to s3://${BACKUP_BUCKET}/db/<timestamp>.dump
#   3. retention: delete files older than BACKUP_RETENTION_DAYS in s3://${BACKUP_BUCKET}/db/
#
# All sensitive values come from env vars — never hardcoded. Required env:
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE
#   BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY
#   BACKUP_BUCKET (default: amass-backups), BACKUP_RETENTION_DAYS (default: 30)
#
# Exit code: 0 = success, non-zero = some step failed (cron will surface to stderr).
#
# NOTE: /bin/sh because Alpine ships busybox ash by default; we don't depend on bashisms.

set -eu
# Alpine /bin/sh (ash) supports `set -o pipefail`; gate it so the script also runs on
# pure POSIX shells without exiting unexpectedly.
# shellcheck disable=SC3040
(set -o pipefail 2>/dev/null) && set -o pipefail

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "FATAL: $*"
  exit 1
}

# ---------------------------------------------------------------------------
# 0. Validate required env (fail fast — matches CLAUDE.md rule #4)
# ---------------------------------------------------------------------------
: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY required}"

BACKUP_BUCKET="${BACKUP_BUCKET:-amass-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

TS="$(date -u +%Y-%m-%d_%H%M%S)"
TMP_DIR="$(mktemp -d -t amass-backup-XXXXXX)"
DUMP_FILE="${TMP_DIR}/${TS}.dump"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

log "starting backup ts=${TS} db=${PGDATABASE}@${PGHOST} bucket=${BACKUP_BUCKET} retention=${BACKUP_RETENTION_DAYS}d"

# ---------------------------------------------------------------------------
# 1. Configure mc alias (idempotent — mc overwrites existing alias)
# ---------------------------------------------------------------------------
log "configuring mc alias 'backup' → ${BACKUP_S3_ENDPOINT}"
mc alias set backup "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}" >/dev/null \
  || die "mc alias set failed"

# Ensure bucket exists (no-op if already created). `mc mb` is idempotent with --ignore-existing.
mc mb --ignore-existing "backup/${BACKUP_BUCKET}" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 2. pg_dump → custom format with max compression
# ---------------------------------------------------------------------------
# --format=custom is the only format that supports parallel restore + selective
# restore. --compress=9 is built-in zlib at max level (no need for extra gzip).
log "running pg_dump (--format=custom --compress=9) → ${DUMP_FILE}"
pg_dump \
  --host="${PGHOST}" \
  --username="${PGUSER}" \
  --dbname="${PGDATABASE}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="${DUMP_FILE}" \
  || die "pg_dump failed"

DUMP_SIZE_BYTES="$(wc -c < "${DUMP_FILE}" | tr -d ' ')"
log "pg_dump done size=${DUMP_SIZE_BYTES}B"

# ---------------------------------------------------------------------------
# 3. Upload via mc cp
# ---------------------------------------------------------------------------
DEST="backup/${BACKUP_BUCKET}/db/${TS}.dump"
log "uploading → s3://${BACKUP_BUCKET}/db/${TS}.dump"
mc cp "${DUMP_FILE}" "${DEST}" >/dev/null \
  || die "mc cp upload failed"
log "upload ok"

# ---------------------------------------------------------------------------
# 4. Retention: delete dumps older than BACKUP_RETENTION_DAYS
# ---------------------------------------------------------------------------
# mc rm --recursive --older-than=Nd handles the date math for us across all
# providers (MinIO / S3 / R2 / B2). --force required for unattended deletion.
log "retention sweep: removing dumps older than ${BACKUP_RETENTION_DAYS}d"
mc rm \
  --recursive \
  --force \
  --older-than "${BACKUP_RETENTION_DAYS}d" \
  "backup/${BACKUP_BUCKET}/db/" \
  >/dev/null 2>&1 \
  || log "WARN: retention sweep returned non-zero (likely nothing to delete) — ignoring"

REMAINING_COUNT="$(mc ls "backup/${BACKUP_BUCKET}/db/" 2>/dev/null | wc -l | tr -d ' ')"
log "retention sweep done; remaining_dumps=${REMAINING_COUNT}"

log "backup complete ts=${TS}"
exit 0
