#!/usr/bin/env bash
# check-prod-env.sh — pre-deploy validator for AMASS-CRM .env.production.
#
# Mirrors the Zod schema + prodOnlyChecks defined in
# apps/api/src/config/env.ts. Catches misconfigurations BEFORE the rollout
# starts, instead of letting the API crash mid-deploy.
#
# Source of truth: apps/api/src/config/env.ts
# If you add/change a prodOnlyChecks rule there, mirror it here.
#
# Usage:
#   scripts/check-prod-env.sh                              # default search path
#   scripts/check-prod-env.sh --env-file=/opt/amass/.env   # explicit file
#
# Exits 0 on success (warnings OK), 1 on any failure.

set -euo pipefail

# ── ANSI colors (only when stdout is a tty, so CI logs stay clean) ──────────
if [[ -t 1 ]]; then
  C_OK=$'\033[1;32m'; C_FAIL=$'\033[1;31m'; C_WARN=$'\033[1;33m'
  C_DIM=$'\033[2m';   C_RESET=$'\033[0m'
else
  C_OK=""; C_FAIL=""; C_WARN=""; C_DIM=""; C_RESET=""
fi

PASS_CHAR="✓"
FAIL_CHAR="✗"
WARN_CHAR="⚠"

# ── Arg parsing ─────────────────────────────────────────────────────────────
ENV_FILE=""
for arg in "$@"; do
  case "$arg" in
    --env-file=*) ENV_FILE="${arg#*=}" ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--env-file=PATH]

Validates a production .env file against the rules in
apps/api/src/config/env.ts (Zod schema + prodOnlyChecks).

Default file search order:
  1. ./.env.production
  2. /opt/amass/.env
EOF
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f ".env.production" ]]; then
    ENV_FILE=".env.production"
  elif [[ -f "/opt/amass/.env" ]]; then
    ENV_FILE="/opt/amass/.env"
  else
    echo "${C_FAIL}${FAIL_CHAR} no env file found (looked at .env.production and /opt/amass/.env)${C_RESET}" >&2
    echo "${C_DIM}  pass --env-file=/path/to/.env.production to specify one${C_RESET}" >&2
    exit 1
  fi
fi

if [[ ! -e "$ENV_FILE" ]]; then
  echo "${C_FAIL}${FAIL_CHAR} env file not found: $ENV_FILE${C_RESET}" >&2
  exit 1
fi

# ── Parse env file line-by-line into a temp KEY<TAB>VALUE table.
# We avoid bash 4 associative arrays for macOS compatibility (default
# bash 3.2). We NEVER `source` or `eval` raw env input — that would let
# `$(rm -rf /)` style values execute.
TMP_TABLE="$(mktemp -t check-prod-env.XXXXXX)"
# Track placeholder hits in a separate file (so the parser can be a pure
# pipeline without subshell state-loss surprises).
TMP_PLACEHOLDERS="$(mktemp -t check-prod-env-ph.XXXXXX)"
cleanup() { rm -f "$TMP_TABLE" "$TMP_PLACEHOLDERS"; }
trap cleanup EXIT

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  # Skip blanks.
  [[ -z "${line// }" ]] && continue
  # Skip comments (after leading whitespace strip).
  trimmed="${line#"${line%%[![:space:]]*}"}"
  [[ "${trimmed:0:1}" == "#" ]] && continue
  # Strip optional `export ` prefix.
  trimmed="${trimmed#export }"
  # Must look like KEY=VALUE (KEY = [A-Za-z_][A-Za-z0-9_]*).
  if [[ ! "$trimmed" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    continue
  fi
  key="${trimmed%%=*}"
  value="${trimmed#*=}"
  # Strip matching surrounding quotes ("..." or '...').
  if [[ ${#value} -ge 2 ]]; then
    first="${value:0:1}"; last="${value: -1}"
    if [[ ( "$first" == '"' && "$last" == '"' ) || ( "$first" == "'" && "$last" == "'" ) ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  # Write KEY<TAB>VALUE — TAB is safe because env vars cannot contain raw tabs in our schema.
  printf '%s\t%s\n' "$key" "$value" >> "$TMP_TABLE"
done < "$ENV_FILE"

# ── Helpers ─────────────────────────────────────────────────────────────────
get() {
  # Print the value for key $1 (empty if not present). If the same key is
  # set twice, the last occurrence wins (matches dotenv-style sourcing).
  awk -v k="$1" -F'\t' '$1 == k { v = $2 } END { print v }' "$TMP_TABLE"
}
has() {
  # 0 (true) if key is present with non-empty value.
  local v
  v="$(get "$1")"
  [[ -n "$v" ]]
}
key_present() {
  # 0 (true) if key is present at all (even empty).
  awk -v k="$1" -F'\t' 'BEGIN { found=1 } $1 == k { found=0 } END { exit found }' "$TMP_TABLE"
}

# Mask a secret-looking value. Show last 4 if length > 8, else "***".
mask() {
  local v="$1"
  local n=${#v}
  if (( n == 0 )); then printf '<empty>'; return; fi
  if (( n <= 8 )); then printf '***'; return; fi
  printf '***%s (len=%d)' "${v: -4}" "$n"
}

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { # pass KEY display_value
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '  %s%s%s %s=%s\n' "$C_OK" "$PASS_CHAR" "$C_RESET" "$1" "$2"
}
fail() { # fail KEY display_value fix_suggestion
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '  %s%s %s=%s  → fix: %s%s\n' "$C_FAIL" "$FAIL_CHAR" "$1" "$2" "$3" "$C_RESET"
}
warn() { # warn KEY display_value reason
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '  %s%s %s=%s  → recommended: %s%s\n' "$C_WARN" "$WARN_CHAR" "$1" "$2" "$3" "$C_RESET"
}

# ── Pre-flight: detect committed-template smell ─────────────────────────────
# If the env file still contains obvious placeholders, bail loudly — the
# operator probably copied .env.example without filling it in.
while IFS=$'\t' read -r k v; do
  case "$v" in
    *change-me*|*changeme*|*"your-key-here"*|*"your-secret-here"*|*"REPLACE_ME"*|*"replace-me"*|*TODO*|*"<your-"*)
      echo "$k" >> "$TMP_PLACEHOLDERS"
      ;;
  esac
done < "$TMP_TABLE"

echo
echo "${C_DIM}Validating: $ENV_FILE${C_RESET}"
echo "${C_DIM}Source of truth: apps/api/src/config/env.ts${C_RESET}"
echo

if [[ -s "$TMP_PLACEHOLDERS" ]]; then
  ph_count=$(wc -l < "$TMP_PLACEHOLDERS" | tr -d ' ')
  echo "${C_FAIL}${FAIL_CHAR} env file looks like an unfilled template (${ph_count} placeholder value(s)):${C_RESET}"
  while IFS= read -r k; do
    echo "    - $k"
  done < "$TMP_PLACEHOLDERS"
  echo "${C_DIM}  Replace placeholders with real secrets before deploying.${C_RESET}"
  echo
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# ── Group 1: REQUIRED (Zod schema, no default, no .optional()) ──────────────
# DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_URL, ENCRYPTION_KEY
echo "${C_DIM}── REQUIRED (Zod schema) ─────────────────────────────────${C_RESET}"

check_required() {
  local key="$1" fix="$2"
  if has "$key"; then
    pass "$key" "$(mask "$(get "$key")")"
  else
    fail "$key" "<missing>" "$fix"
  fi
}

check_required "DATABASE_URL"       "set to postgresql://user:pass@host:5432/db"
check_required "JWT_SECRET"         "openssl rand -hex 32"
check_required "JWT_REFRESH_SECRET" "openssl rand -hex 32"
check_required "REDIS_URL"          "set to redis://host:6379"
check_required "ENCRYPTION_KEY"     "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""

# ── Group 2: PRODUCTION-ONLY (mirrors prodOnlyChecks in env.ts) ─────────────
echo
echo "${C_DIM}── PRODUCTION-ONLY (prodOnlyChecks) ──────────────────────${C_RESET}"

# 2a. NODE_ENV=production
node_env="$(get NODE_ENV)"
if [[ "$node_env" == "production" ]]; then
  pass "NODE_ENV" "production"
else
  fail "NODE_ENV" "${node_env:-<unset>}" "set NODE_ENV=production"
fi

# 2b. AI_WORKER_SECRET non-empty (and ≥16 chars per Zod schema)
aws_v="$(get AI_WORKER_SECRET)"
if [[ -n "$aws_v" ]]; then
  if (( ${#aws_v} >= 16 )); then
    pass "AI_WORKER_SECRET" "$(mask "$aws_v")"
  else
    fail "AI_WORKER_SECRET" "$(mask "$aws_v")" "must be ≥16 chars — openssl rand -hex 32"
  fi
else
  fail "AI_WORKER_SECRET" "<missing>" "openssl rand -hex 32  (Python AI worker callback auth)"
fi

# 2c. MINIO_ACCESS_KEY != "minioadmin"
mak="$(get MINIO_ACCESS_KEY)"
if [[ -z "$mak" ]]; then
  fail "MINIO_ACCESS_KEY" "<missing>" "set a non-default access key (openssl rand -base64 20)"
elif [[ "$mak" == "minioadmin" ]]; then
  fail "MINIO_ACCESS_KEY" "minioadmin" "MUST NOT be 'minioadmin' in production — rotate it"
else
  pass "MINIO_ACCESS_KEY" "$(mask "$mak")"
fi

# 2d. MINIO_SECRET_KEY != "minioadmin"
msk="$(get MINIO_SECRET_KEY)"
if [[ -z "$msk" ]]; then
  fail "MINIO_SECRET_KEY" "<missing>" "set a non-default secret key (openssl rand -base64 40)"
elif [[ "$msk" == "minioadmin" ]]; then
  fail "MINIO_SECRET_KEY" "minioadmin" "MUST NOT be 'minioadmin' in production — rotate it"
else
  pass "MINIO_SECRET_KEY" "$(mask "$msk")"
fi

# 2e. ENCRYPTION_KEY != 64 zeros (also enforce hex length from Zod)
ek="$(get ENCRYPTION_KEY)"
# gitleaks:allow — this is a 64-zero sentinel used as a reject pattern, not a
# real key. Splitting it so naive secret scanners that match long hex runs see
# two short literals instead of one secret-shaped string.
zero64="0000000000000000$(printf '0%.0s' {1..48})"
if [[ -z "$ek" ]]; then
  : # already caught by REQUIRED above; don't double-fail
elif [[ "$ek" == "$zero64" ]]; then
  fail "ENCRYPTION_KEY" "0000...(64 zeros)" "MUST NOT be all zeros — regenerate"
elif [[ ${#ek} -ne 64 ]]; then
  fail "ENCRYPTION_KEY" "$(mask "$ek")" "must be exactly 64 hex chars (32 bytes)"
elif [[ ! "$ek" =~ ^[0-9a-fA-F]+$ ]]; then
  fail "ENCRYPTION_KEY" "$(mask "$ek")" "must be hex characters only"
else
  pass "ENCRYPTION_KEY" "$(mask "$ek")"
fi

# 2f. JWT_SECRET length ≥ 32
js="$(get JWT_SECRET)"
if [[ -n "$js" ]]; then
  if (( ${#js} < 32 )); then
    fail "JWT_SECRET" "$(mask "$js")" "must be ≥32 chars in production (current: ${#js}). openssl rand -hex 32"
  else
    pass "JWT_SECRET (length)" "${#js} chars"
  fi
fi

# 2g. JWT_REFRESH_SECRET length ≥ 32
jrs="$(get JWT_REFRESH_SECRET)"
if [[ -n "$jrs" ]]; then
  if (( ${#jrs} < 32 )); then
    fail "JWT_REFRESH_SECRET" "$(mask "$jrs")" "must be ≥32 chars in production (current: ${#jrs}). openssl rand -hex 32"
  else
    pass "JWT_REFRESH_SECRET (length)" "${#jrs} chars"
  fi
fi

# 2h. CORS_ALLOWED_ORIGINS does NOT contain bare "*"
co="$(get CORS_ALLOWED_ORIGINS)"
if [[ -z "$co" ]]; then
  # Schema has a default, so empty in the file is fine — but the default
  # is localhost which is wrong in prod. Warn loudly.
  warn "CORS_ALLOWED_ORIGINS" "<unset>" "set to your real origin(s), comma-separated (default is localhost)"
else
  has_wildcard=0
  IFS=',' read -ra origins <<< "$co"
  for o in "${origins[@]}"; do
    o_trim="${o## }"; o_trim="${o_trim%% }"
    if [[ "$o_trim" == "*" ]]; then
      has_wildcard=1
      break
    fi
  done
  if (( has_wildcard )); then
    fail "CORS_ALLOWED_ORIGINS" "$co" "MUST NOT contain bare '*' in production (CSRF + WS-hijacking risk)"
  else
    pass "CORS_ALLOWED_ORIGINS" "$co"
  fi
fi

# 2i. WEBHOOK_TRUSTED_HOSTS is empty or unset
wth="$(get WEBHOOK_TRUSTED_HOSTS)"
if [[ -z "$wth" ]]; then
  pass "WEBHOOK_TRUSTED_HOSTS" "(empty — correct for prod)"
else
  trimmed_any=0
  IFS=',' read -ra hosts <<< "$wth"
  for h in "${hosts[@]}"; do
    h_trim="${h## }"; h_trim="${h_trim%% }"
    [[ -n "$h_trim" ]] && trimmed_any=1
  done
  if (( trimmed_any )); then
    fail "WEBHOOK_TRUSTED_HOSTS" "$wth" "MUST be empty in production (SSRF bypass, dev-only)"
  else
    pass "WEBHOOK_TRUSTED_HOSTS" "(empty — correct for prod)"
  fi
fi

# 2j. METRICS_ALLOWED_IPS or METRICS_AUTH_TOKEN must be set
mai="$(get METRICS_ALLOWED_IPS)"
mat="$(get METRICS_AUTH_TOKEN)"
metrics_ok=0
if [[ -n "$mai" ]]; then
  IFS=',' read -ra ips <<< "$mai"
  for ip in "${ips[@]}"; do
    ip_trim="${ip## }"; ip_trim="${ip_trim%% }"
    if [[ -n "$ip_trim" ]]; then metrics_ok=1; break; fi
  done
fi
if [[ -n "$mat" ]]; then metrics_ok=1; fi
if (( metrics_ok )); then
  if [[ -n "$mat" ]]; then
    pass "METRICS_AUTH (token)" "$(mask "$mat")"
  fi
  if [[ -n "$mai" ]]; then
    pass "METRICS_ALLOWED_IPS" "$mai"
  fi
else
  fail "METRICS_ALLOWED_IPS or METRICS_AUTH_TOKEN" "<both empty>" \
    "set at least one (token: openssl rand -hex 32; or IPs: 10.0.0.1,10.0.0.2)"
fi

# ── Group 3: RECOMMENDED (warnings only) ────────────────────────────────────
echo
echo "${C_DIM}── RECOMMENDED (warnings only) ───────────────────────────${C_RESET}"

check_recommended() {
  local key="$1" reason="$2"
  if has "$key"; then
    pass "$key" "$(mask "$(get "$key")")"
  else
    warn "$key" "<unset>" "$reason"
  fi
}

check_recommended "SENTRY_DSN"             "wire Sentry for error tracking before launch (safe to skip on first deploy)"
check_recommended "STRIPE_WEBHOOK_SECRET"  "needed when billing (S51) is enabled"
check_recommended "SIEM_WEBHOOK_URL"       "default SOC webhook for audit forwarding (per-tenant overrides exist)"

# Backup S3-compatible storage (used by db-backup sidecar AND BackupHealthService).
# All 4 must be set for nightly backups to actually run; without them, backup-db.sh
# fails fast and the backup_last_success_timestamp_seconds gauge stays absent →
# BackupNeverRun alert fires after 30 min in prod.
check_recommended "BACKUP_S3_ENDPOINT"     "set to your S3-compatible endpoint (MinIO, R2, B2, AWS S3) — required for nightly backups"
check_recommended "BACKUP_S3_ACCESS_KEY"   "credentials for the backup bucket (separate IAM principal from app MinIO creds, ideally write-only)"
check_recommended "BACKUP_S3_SECRET_KEY"   "credentials for the backup bucket"
check_recommended "BACKUP_BUCKET"          "name of the bucket where dumps + _heartbeat.json land (default: amass-backups)"

# ── Summary ─────────────────────────────────────────────────────────────────
echo
echo "=========================================================================="
printf '  %sPASS:%s %d   %sFAIL:%s %d   %sWARN:%s %d\n' \
  "$C_OK" "$C_RESET" "$PASS_COUNT" \
  "$C_FAIL" "$C_RESET" "$FAIL_COUNT" \
  "$C_WARN" "$C_RESET" "$WARN_COUNT"
echo "=========================================================================="

if (( FAIL_COUNT > 0 )); then
  echo "${C_FAIL}${FAIL_CHAR} ${FAIL_COUNT} required check(s) failed — fix before deploying.${C_RESET}"
  exit 1
fi

echo "${C_OK}${PASS_CHAR} all required checks passed${C_RESET}"
if (( WARN_COUNT > 0 )); then
  echo "${C_DIM}  (warnings are advisory; safe to ignore on first deploy)${C_RESET}"
fi
exit 0
