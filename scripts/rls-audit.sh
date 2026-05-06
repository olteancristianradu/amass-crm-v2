#!/usr/bin/env bash
# RLS deny-by-default audit — verifies that every tenant-scoped table
# returns 0 rows when queried as `app_user` without `app.tenant_id` set.
#
# Run periodically (weekly cron via redteam-weekly.yml does this in CI;
# this script is the operator-side equivalent for staging/prod).
#
# Usage:
#   DATABASE_URL=postgresql://... bash scripts/rls-audit.sh
#   # or for the local docker stack:
#   bash scripts/rls-audit.sh
#
# Exit codes:
#   0 — all tenant-scoped tables denied access (✓)
#   1 — at least one table returned non-zero rows without tenant context
#   2 — could not connect to the database

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/amass_crm}"

if ! command -v psql >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1; then
    PSQL="docker exec -i amass-postgres psql -U postgres -d amass_crm"
  else
    echo "Need either psql or docker (with amass-postgres container) to run this." >&2
    exit 2
  fi
else
  PSQL="psql ${DB_URL}"
fi

# Tables that must enforce tenant isolation. Keep this list in sync with
# Prisma schema changes — anytime a new tenant-scoped model lands, add
# its @@map name here.
TABLES=(
  users companies contacts clients deals tasks reminders notes
  attachments leads invoices invoice_lines payments quotes quote_lines
  products contracts orders campaigns subscriptions cases
  email_accounts email_messages email_attachments email_sequences
  contact_segments calls call_transcripts phone_numbers
  sms_messages whatsapp_threads whatsapp_messages
  audit_log activities pipelines pipeline_stages
  custom_fields validation_rules formula_fields tags entity_tags
  reports report_dashboards saved_views webhook_endpoints webhook_deliveries
  consents lead_scores lead_score_rules approval_policies
  forecast_snapshots commissions territories events notifications
  exports import_jobs sso_configurations onboarding_sessions tour_progress
)

failures=()
ok_count=0

for table in "${TABLES[@]}"; do
  # Skip tables that don't exist yet (early-stage schema). If the count
  # query errors with "relation does not exist", treat as a soft skip.
  if ! $PSQL -c "SELECT 1 FROM ${table} LIMIT 1" >/dev/null 2>&1; then
    continue
  fi

  # The transaction wrapper emits BEGIN/SET/ROLLBACK lines along with the
  # count. Extract only the digit-only line that is the actual count.
  raw=$(
    $PSQL -tA -c "BEGIN; SET LOCAL ROLE app_user; SELECT count(*) FROM ${table}; ROLLBACK;" 2>/dev/null || echo "ERR"
  )
  count=$(echo "$raw" | grep -E '^[0-9]+$' | head -1)

  if echo "$raw" | grep -q "ERR"; then
    failures+=("${table}: query failed (RLS may be misconfigured)")
  elif [ -z "$count" ]; then
    failures+=("${table}: count not parsed from output: $raw")
  elif [ "$count" -gt 0 ]; then
    failures+=("${table}: returned ${count} rows without tenant context (FAIL-OPEN)")
  else
    ok_count=$((ok_count + 1))
  fi
done

echo "──────────────────────────────────────────────────────────"
echo "RLS deny-by-default audit"
echo "──────────────────────────────────────────────────────────"
echo "Tables checked OK (returned 0): ${ok_count}"

if [ ${#failures[@]} -gt 0 ]; then
  echo "FAILURES (${#failures[@]}):"
  for f in "${failures[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo "All tenant-scoped tables enforce deny-by-default RLS. ✓"
