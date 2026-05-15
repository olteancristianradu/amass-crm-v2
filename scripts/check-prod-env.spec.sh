#!/usr/bin/env bash
# check-prod-env.spec.sh — smoke tests for scripts/check-prod-env.sh.
#
# Plain bash (no bats dependency). Run with:
#   bash scripts/check-prod-env.spec.sh
#
# Exits 0 if all scenarios pass; 1 otherwise.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/check-prod-env.sh"

if [[ ! -x "$SCRIPT" ]]; then
  chmod +x "$SCRIPT"
fi

TMP_DIR="$(mktemp -d -t check-prod-env-spec.XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Counters
PASS=0
FAIL=0

# Pretty print
ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
ko()    { printf '  \033[1;31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
header(){ printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

# write_env <path> <body>
# Writes a here-doc-style env file. Body must use literal newlines via $'\n'.
write_env() {
  local path="$1"
  local body="$2"
  printf '%s\n' "$body" > "$path"
}

# A known-good valid env body, reused by happy-path + mutated for the
# negative scenarios. Values are obviously fake but pass every rule:
#   - JWT secrets are 64 hex (≥32)
#   - ENCRYPTION_KEY is 64 hex non-zero
#   - MinIO creds are not "minioadmin"
#   - METRICS_AUTH_TOKEN is 32 hex
#   - CORS has a real origin (no '*')
#   - NODE_ENV=production
VALID_BODY='NODE_ENV=production
DATABASE_URL=postgresql://app:pw@db:5432/amass
REDIS_URL=redis://redis:6379
JWT_SECRET=11111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
JWT_REFRESH_SECRET=22222222222222222222222222222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ENCRYPTION_KEY=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
AI_WORKER_SECRET=cccccccccccccccccccccccccccccccc
MINIO_ACCESS_KEY=AKIA_FAKE_ACCESS_KEY_1234
MINIO_SECRET_KEY=secret_minio_key_long_enough_42_chars_xxxx
CORS_ALLOWED_ORIGINS=https://crm.example.com
METRICS_AUTH_TOKEN=ddddddddddddddddddddddddddddddddeeeeeeee
WEBHOOK_TRUSTED_HOSTS='

# ── Scenario 1: happy path → exits 0 ────────────────────────────────────────
header "Scenario 1: valid env → exit 0"
SC1_FILE="$TMP_DIR/valid.env"
write_env "$SC1_FILE" "$VALID_BODY"

set +e
SC1_OUT="$(bash "$SCRIPT" --env-file="$SC1_FILE" 2>&1)"
SC1_EXIT=$?
set -e

if [[ $SC1_EXIT -eq 0 ]]; then
  ok "exit code is 0"
else
  ko "expected exit 0, got $SC1_EXIT"
  printf '%s\n' "$SC1_OUT" | sed 's/^/    | /'
fi
if printf '%s' "$SC1_OUT" | grep -q "all required checks passed"; then
  ok "summary mentions 'all required checks passed'"
else
  ko "missing 'all required checks passed' in output"
fi

# ── Scenario 2: missing JWT_SECRET → exits 1 with "JWT_SECRET" in output ────
header "Scenario 2: missing JWT_SECRET → exit 1"
SC2_FILE="$TMP_DIR/no-jwt.env"
# Strip the JWT_SECRET line (but keep JWT_REFRESH_SECRET).
SC2_BODY="$(printf '%s\n' "$VALID_BODY" | grep -v '^JWT_SECRET=')"
write_env "$SC2_FILE" "$SC2_BODY"

set +e
SC2_OUT="$(bash "$SCRIPT" --env-file="$SC2_FILE" 2>&1)"
SC2_EXIT=$?
set -e

if [[ $SC2_EXIT -eq 1 ]]; then
  ok "exit code is 1"
else
  ko "expected exit 1, got $SC2_EXIT"
fi
if printf '%s' "$SC2_OUT" | grep -q "JWT_SECRET"; then
  ok "output mentions JWT_SECRET"
else
  ko "output does NOT mention JWT_SECRET"
  printf '%s\n' "$SC2_OUT" | sed 's/^/    | /'
fi

# ── Scenario 3: short JWT_SECRET → exits 1 mentioning length ────────────────
header "Scenario 3: short JWT_SECRET → exit 1, mentions length"
SC3_FILE="$TMP_DIR/short-jwt.env"
SC3_BODY="$(printf '%s\n' "$VALID_BODY" | sed 's|^JWT_SECRET=.*|JWT_SECRET=short|')"
write_env "$SC3_FILE" "$SC3_BODY"

set +e
SC3_OUT="$(bash "$SCRIPT" --env-file="$SC3_FILE" 2>&1)"
SC3_EXIT=$?
set -e

if [[ $SC3_EXIT -eq 1 ]]; then
  ok "exit code is 1"
else
  ko "expected exit 1, got $SC3_EXIT"
fi
# The script's failure message for short JWT mentions "≥32 chars" and "JWT_SECRET".
if printf '%s' "$SC3_OUT" | grep -q "JWT_SECRET" && \
   printf '%s' "$SC3_OUT" | grep -qi "chars"; then
  ok "output mentions JWT_SECRET AND length"
else
  ko "output is missing JWT_SECRET/length wording"
  printf '%s\n' "$SC3_OUT" | sed 's/^/    | /'
fi

# ── Summary ─────────────────────────────────────────────────────────────────
printf '\n=========================================================================\n'
printf '  PASS: %d   FAIL: %d\n' "$PASS" "$FAIL"
printf '=========================================================================\n'

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
