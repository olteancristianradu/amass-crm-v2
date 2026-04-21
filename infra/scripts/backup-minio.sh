#!/usr/bin/env bash
# backup-minio.sh — mirror the AMASS-CRM MinIO bucket to a second location
# for disaster recovery. Postgres is the source of truth for metadata, but
# if MinIO storage is lost, every attachment / export / invoice PDF is gone
# irreversibly. This script gives us a cold copy.
#
# Usage:
#   ./infra/scripts/backup-minio.sh [destination]
#
# Env vars:
#   MINIO_ENDPOINT      source endpoint (e.g. http://localhost:9000)
#   MINIO_ACCESS_KEY    source key
#   MINIO_SECRET_KEY    source secret
#   MINIO_BUCKET        source bucket (default: amass-files)
#
# Destinations supported (first matching wins):
#
#   1. Local directory           — positional arg
#        ./backup-minio.sh /var/backups/amass-files
#
#   2. Remote MinIO/S3 target    — configured via mc alias `backup`
#        (user creates the alias once: `mc alias set backup …`)
#        MINIO_BACKUP_ALIAS=backup MINIO_BACKUP_BUCKET=amass-files-bkp \
#          ./backup-minio.sh
#
# Uses `mc mirror --overwrite --remove` so the backup is a faithful copy
# (deletions propagate). If you need append-only history, drop `--remove`
# and schedule periodic full snapshots instead.
#
# Cron example (nightly at 03:30):
#   30 3 * * * /opt/amass-crm/infra/scripts/backup-minio.sh \
#              /var/backups/amass-files >> /var/log/amass-minio-backup.log 2>&1

set -euo pipefail

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY must be set}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY must be set}"
MINIO_BUCKET="${MINIO_BUCKET:-amass-files}"

if ! command -v mc >/dev/null 2>&1; then
	echo "mc (MinIO client) not found in PATH. Install from https://min.io/download" >&2
	exit 1
fi

MC_CONFIG_DIR="$(mktemp -d)"
trap 'rm -rf "$MC_CONFIG_DIR"' EXIT

mc --config-dir "$MC_CONFIG_DIR" alias set source \
	"$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null

TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$TIMESTAMP] Starting MinIO backup"

if [[ $# -ge 1 ]]; then
	DEST_DIR="$1"
	mkdir -p "$DEST_DIR"
	echo "[$TIMESTAMP] Mirroring source/$MINIO_BUCKET → $DEST_DIR"
	mc --config-dir "$MC_CONFIG_DIR" mirror --overwrite --remove \
		"source/$MINIO_BUCKET" "$DEST_DIR"
elif [[ -n "${MINIO_BACKUP_ALIAS:-}" && -n "${MINIO_BACKUP_BUCKET:-}" ]]; then
	echo "[$TIMESTAMP] Mirroring source/$MINIO_BUCKET → $MINIO_BACKUP_ALIAS/$MINIO_BACKUP_BUCKET"
	# The user is expected to have configured the backup alias on the host
	# already (outside this script), so copy its credentials into our
	# ephemeral config.
	cp -r "${HOME}/.mc/"* "$MC_CONFIG_DIR/" 2>/dev/null || true
	mc --config-dir "$MC_CONFIG_DIR" mirror --overwrite --remove \
		"source/$MINIO_BUCKET" "$MINIO_BACKUP_ALIAS/$MINIO_BACKUP_BUCKET"
else
	echo "Usage: $0 <local_destination_dir>" >&2
	echo "   or: set MINIO_BACKUP_ALIAS + MINIO_BACKUP_BUCKET env vars" >&2
	exit 2
fi

DONE_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[$DONE_TS] MinIO backup complete"
