#!/usr/bin/env bash
# End-to-end smoke test for a deployed AMASS-CRM stack.
#
# Assumes `docker compose up -d` already ran (via bootstrap-vps.sh or
# manually). Hits real HTTP endpoints, verifies the golden-path CRM
# flow works end-to-end, and checks multi-tenant RLS isolation.
#
# Usage:
#   scripts/smoke-test.sh                  # default: http://localhost:3000
#   scripts/smoke-test.sh https://api.crm.example.com
#
# Exit code 0 on success, 1 on any failure. Prints each check inline.
set -eu

BASE="${1:-http://localhost:3000}"
TS=$(date +%s)
TENANT_A="smoke-a-${TS}"
TENANT_B="smoke-b-${TS}"
EMAIL_A="a-${TS}@smoke.test"
EMAIL_B="b-${TS}@smoke.test"
PASSWORD="Smoke-Test-${TS}-LongPassword"

pass() { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
head() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

json() {
  # Extract a top-level field — needs jq on path.
  command -v jq >/dev/null || fail "jq required (apt install jq)"
  echo "$1" | jq -r "$2"
}

req() {
  local method=$1 path=$2 body=${3:-} token=${4:-}
  local cmd=(curl -sS -X "$method" "${BASE}${path}" -H 'content-type: application/json' -H 'X-Requested-With: amass-web')
  [[ -n "$body" ]]  && cmd+=(-d "$body")
  [[ -n "$token" ]] && cmd+=(-H "authorization: Bearer ${token}")
  "${cmd[@]}"
}

# ── 1. Health ─────────────────────────────────────────────────────────────
head "Health check"
HEALTH=$(req GET /api/v1/health)
[[ "$(json "$HEALTH" '.status')" == "ok" ]] || fail "health != ok: $HEALTH"
pass "api healthy"

# ── 2. Register tenant A + B ──────────────────────────────────────────────
head "Register two tenants"
REG_A=$(req POST /api/v1/auth/register "$(printf '{"tenantSlug":"%s","tenantName":"A","email":"%s","password":"%s","fullName":"A"}' "$TENANT_A" "$EMAIL_A" "$PASSWORD")")
TOKEN_A=$(json "$REG_A" '.tokens.accessToken')
TENANT_A_ID=$(json "$REG_A" '.user.tenantId')
[[ -n "$TOKEN_A" && "$TOKEN_A" != "null" ]] || fail "tenant A register failed: $REG_A"
pass "tenant A registered (id=$TENANT_A_ID)"

REG_B=$(req POST /api/v1/auth/register "$(printf '{"tenantSlug":"%s","tenantName":"B","email":"%s","password":"%s","fullName":"B"}' "$TENANT_B" "$EMAIL_B" "$PASSWORD")")
TOKEN_B=$(json "$REG_B" '.tokens.accessToken')
TENANT_B_ID=$(json "$REG_B" '.user.tenantId')
[[ -n "$TOKEN_B" && "$TOKEN_B" != "null" ]] || fail "tenant B register failed: $REG_B"
pass "tenant B registered (id=$TENANT_B_ID)"

# ── 3. /auth/me under both tokens ─────────────────────────────────────────
head "Authenticated /me"
ME_A=$(req GET /api/v1/auth/me '' "$TOKEN_A")
[[ "$(json "$ME_A" '.email')" == "$EMAIL_A" ]] || fail "me email != expected: $ME_A"
pass "/auth/me returns tenant A email"

# ── 4. Create company under tenant A ──────────────────────────────────────
head "Create company in tenant A"
C_A=$(req POST /api/v1/companies '{"name":"ACME A SRL","cui":"RO99999991"}' "$TOKEN_A")
COMPANY_A_ID=$(json "$C_A" '.id')
[[ -n "$COMPANY_A_ID" && "$COMPANY_A_ID" != "null" ]] || fail "company create failed: $C_A"
pass "company created (id=$COMPANY_A_ID)"

# ── 5. RLS: tenant B MUST NOT see tenant A's company ──────────────────────
head "RLS cross-tenant isolation"
GET_A_AS_B=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/api/v1/companies/${COMPANY_A_ID}" \
  -H 'X-Requested-With: amass-web' \
  -H "authorization: Bearer ${TOKEN_B}")
if [[ "$GET_A_AS_B" != "404" && "$GET_A_AS_B" != "403" ]]; then
  fail "tenant B saw tenant A's company — RLS LEAK (status=$GET_A_AS_B)"
fi
pass "tenant B receives $GET_A_AS_B on tenant A's company (RLS works)"

# ── 6. Company list scoping ───────────────────────────────────────────────
head "List scoping"
LIST_B=$(req GET /api/v1/companies '' "$TOKEN_B")
COUNT_B=$(echo "$LIST_B" | jq '.data | length' 2>/dev/null || echo "?")
[[ "$COUNT_B" == "0" ]] || fail "tenant B company list should be empty, got $COUNT_B"
pass "tenant B company list is empty"

# ── 7. Rate limit on /auth/login ──────────────────────────────────────────
head "Rate limit on /auth/login (expect 429 after ~5 attempts)"
HIT_429=no
for i in 1 2 3 4 5 6 7; do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -H 'X-Requested-With: amass-web' \
    -d "$(printf '{"tenantSlug":"%s","email":"%s","password":"wrong"}' "$TENANT_A" "$EMAIL_A")")
  [[ "$CODE" == "429" ]] && { HIT_429=yes; break; }
done
[[ "$HIT_429" == "yes" ]] || fail "no 429 after 7 bad logins — rate limit broken"
pass "rate limit returned 429"

# ── 8. CSRF header enforcement on /auth/refresh ───────────────────────────
head "CSRF: /auth/refresh without X-Requested-With"
CSRF_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/auth/refresh" \
  -H 'content-type: application/json')
[[ "$CSRF_CODE" == "403" ]] || fail "expected 403 CSRF block, got $CSRF_CODE"
pass "/auth/refresh rejected without X-Requested-With (CSRF defence active)"

# ── Done ─────────────────────────────────────────────────────────────────
echo
printf '\033[1;32m✓ Smoke test passed — 8/8 checks.\033[0m\n'
