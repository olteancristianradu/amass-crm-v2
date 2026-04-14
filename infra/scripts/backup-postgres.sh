#!/usr/bin/env bash
# backup-postgres.sh — dump the AMASS-CRM Postgres database to a compressed file.
#
# Usage (from host):
#   ./infra/scripts/backup-postgres.sh [output_dir]
#
# Reads connection info from environment variables (same as .env):
#   POSTGRES_USER     (default: postgres)
#   POSTGRES_DB       (default: amass_crm)
#   POSTGRES_HOST     (default: localhost)
#   POSTGRES_PORT     (default: 5432)
#
# Output file: <output_dir>/amass_crm_YYYYMMDD_HHMMSS.sql.gz
#
# For production, run this from a cron job:
#   0 3 * * * /opt/amass-crm/infra/scripts/backup-postgres.sh /var/backups/amass >> /var/log/amass-backup.log 2>&1
#
# Restore:
#   gunzip -c amass_crm_20260101_030000.sql.gz | psql -U postgres amass_crm

set -euo pipefail

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-amass_crm}"
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
OUTPUT_DIR="${1:-/tmp/amass-backups}"

mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="${OUTPUT_DIR}/amass_crm_${TIMESTAMP}.sql.gz"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup → $OUTPUT_FILE"

PGPASSWORD="${POSTGRES_PASSWORD:-}" pg_dump \
  --host="$POSTGRES_HOST" \
  --port="$POSTGRES_PORT" \
  --username="$POSTGRES_USER" \
  --no-password \
  --format=plain \
  --no-owner \
  --no-privileges \
  "$POSTGRES_DB" \
  | gzip > "$OUTPUT_FILE"

SIZE=$(du -sh "$OUTPUT_FILE" | cut -f1)
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: $OUTPUT_FILE ($SIZE)"

# Retain last 7 daily backups
find "$OUTPUT_DIR" -name "amass_crm_*.sql.gz" -mtime +7 -delete
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Old backups pruned (kept last 7 days)"
