#!/usr/bin/env bash
# Pre-deploy validation for `railway up`.
#
# Reads `apps/api/src/config/env.ts` (Zod schema) and prints the list of
# environment variables Railway must have set per service. Also verifies
# that each app's Dockerfile is present.
#
# Exit codes:
#   0 — repo is in a deployable shape (env-var checklist printed)
#   1 — something the deploy needs is missing (Dockerfile, env.ts, etc.)
#
# This script does NOT need access to the live Railway project — it only
# reads files in the repo. Run it before `railway up` to avoid the dance
# of "push → wait for build → fail on missing env → set var → push again".
#
# Usage:
#   scripts/check-railway-readiness.sh
#   scripts/check-railway-readiness.sh --env-file .env.production    # also lint a local env file
#
# Notes:
#   • `.env.production` is intentionally NOT committed (and shouldn't be).
#     If it exists, this script reads it to cross-check what's been set
#     locally, but it never writes it.
#   • Source of truth for required vars: apps/api/src/config/env.ts

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,/^set -eu/p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^set -eu/d'
      exit 0
      ;;
    *)
      printf 'Unknown arg: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

# ── ANSI helpers ────────────────────────────────────────────────────
if [ -t 1 ]; then
  CL_OK=$'\033[1;32m'; CL_BAD=$'\033[1;31m'; CL_WARN=$'\033[1;33m'
  CL_HEAD=$'\033[1;36m'; CL_DIM=$'\033[2m'; CL_RST=$'\033[0m'
else
  CL_OK=""; CL_BAD=""; CL_WARN=""; CL_HEAD=""; CL_DIM=""; CL_RST=""
fi

FAILED=0
fail()  { printf '%s  ✗ %s%s\n' "$CL_BAD" "$*" "$CL_RST"; FAILED=1; }
warn()  { printf '%s  ⚠ %s%s\n' "$CL_WARN" "$*" "$CL_RST"; }
ok()    { printf '%s  ✓ %s%s\n' "$CL_OK" "$*" "$CL_RST"; }
head()  { printf '\n%s▶ %s%s\n' "$CL_HEAD" "$*" "$CL_RST"; }
dim()   { printf '%s    %s%s\n' "$CL_DIM" "$*" "$CL_RST"; }

# ── 1. Dockerfile + railway.toml presence per service ───────────────
head "Service Dockerfiles & Railway configs"

for svc in api web ai-worker; do
  df="apps/$svc/Dockerfile"
  rt="apps/$svc/railway.toml"
  if [ -f "$df" ]; then
    ok "apps/$svc/Dockerfile"
  else
    fail "apps/$svc/Dockerfile is MISSING — Railway has nothing to build."
  fi
  if [ -f "$rt" ]; then
    ok "apps/$svc/railway.toml"
  else
    fail "apps/$svc/railway.toml is MISSING — Railway will fall back to repo root."
  fi
done

if [ -f "railway.toml" ]; then
  ok "railway.toml (root)"
else
  warn "railway.toml at repo root is missing — Railway autodetect may panic."
fi

# ── 2. env.ts presence ──────────────────────────────────────────────
head "Env schema (single source of truth)"

ENV_TS="apps/api/src/config/env.ts"
if [ -f "$ENV_TS" ]; then
  ok "$ENV_TS"
else
  fail "$ENV_TS is missing — can't parse the schema."
  exit 1
fi

# ── 3. Extract required-in-prod env vars from env.ts ────────────────
# We grep for keys whose Zod chain does NOT include `.optional()` AND
# does NOT include `.default(`. Best-effort static parse — the canonical
# check is still `node dist/main.js` failing at startup.

extract_required() {
  # Robust extractor: track parenthesis depth so commas inside
  # z.preprocess((v) => ..., z.string().optional()) don't prematurely
  # terminate an entry. A key entry runs from `NAME:` through the
  # matching `,` at depth 0.
  awk '
    function flush(   has_opt, has_def) {
      if (current == "") return
      has_opt = (buf ~ /\.optional\(\)/)
      has_def = (buf ~ /\.default\(/)
      if (!has_opt && !has_def) print current
      current = ""
      buf = ""
      depth = 0
    }
    function count_chars(s, ch,   i, c, n) {
      n = 0
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == ch) n++
      }
      return n
    }
    /^const envSchema = z\.object\(\{/ { in_obj = 1; next }
    in_obj && /^\}\);/                  { flush(); in_obj = 0; next }
    !in_obj { next }
    {
      line = $0
      # Detect start of a new top-level key only when not inside another entry.
      if (current == "" && line ~ /^  [A-Z_][A-Z0-9_]*:/) {
        idx = index(line, ":")
        current = substr(line, 1, idx - 1)
        sub(/^  /, "", current)
        rest = substr(line, idx + 1)
        buf = rest
        depth = count_chars(rest, "(") - count_chars(rest, ")")
        if (depth <= 0 && rest ~ /,[[:space:]]*$/) {
          flush()
        }
        next
      }
      if (current != "") {
        buf = buf " " line
        depth = depth + count_chars(line, "(") - count_chars(line, ")")
        if (depth <= 0 && line ~ /,[[:space:]]*$/) {
          flush()
        }
      }
    }
    END { flush() }
  ' "$ENV_TS"
}

REQUIRED_VARS="$(extract_required || true)"

# Fallback if awk parse came up empty (env.ts heavily refactored).
if [ -z "$REQUIRED_VARS" ]; then
  warn "Could not auto-extract required vars from env.ts — falling back to a hardcoded list."
  REQUIRED_VARS="DATABASE_URL REDIS_URL JWT_SECRET JWT_REFRESH_SECRET ENCRYPTION_KEY"
fi

# ── 4. Print the per-service checklist ──────────────────────────────
head "Required env vars per Railway service"

dim "Source of truth: apps/api/src/config/env.ts"
dim "See apps/<svc>/railway.toml for the per-service annotated list."

printf '\n%s  api%s\n' "$CL_HEAD" "$CL_RST"
for v in $REQUIRED_VARS; do
  printf '    - %s\n' "$v"
done
printf '    - %s   %s# also: AI_WORKER_SECRET, CORS_ALLOWED_ORIGINS, MINIO_*,%s\n' "NODE_ENV=production" "$CL_DIM" "$CL_RST"
printf '    %s  PUBLIC_API_BASE_URL, METRICS_AUTH_TOKEN or METRICS_ALLOWED_IPS%s\n' "$CL_DIM" "$CL_RST"

printf '\n%s  web%s\n' "$CL_HEAD" "$CL_RST"
printf '    - %s   %s# BUILD-TIME: must be set before the Vite build runs%s\n' "VITE_API_URL" "$CL_DIM" "$CL_RST"
printf '    - %s   %s# optional, build-time%s\n' "VITE_SENTRY_DSN" "$CL_DIM" "$CL_RST"

printf '\n%s  ai-worker%s\n' "$CL_HEAD" "$CL_RST"
for v in AI_WORKER_SECRET API_URL REDIS_URL MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET; do
  printf '    - %s\n' "$v"
done
printf '    - %s   %s# default "off"; flip to "base"/"small"/... to enable real transcription%s\n' "WHISPER_MODEL" "$CL_DIM" "$CL_RST"
printf '    - %s   %s# optional, enables summarisation%s\n' "ANTHROPIC_API_KEY" "$CL_DIM" "$CL_RST"

# ── 5. Optional: cross-check a local .env.production ────────────────
if [ -n "$ENV_FILE" ]; then
  head "Cross-check against $ENV_FILE"
  if [ ! -f "$ENV_FILE" ]; then
    fail "$ENV_FILE does not exist"
  else
    if [ "$(stat -f %Lp "$ENV_FILE" 2>/dev/null || stat -c %a "$ENV_FILE" 2>/dev/null || echo "")" = "" ]; then
      :
    fi
    MISSING=""
    for v in $REQUIRED_VARS; do
      if ! grep -E "^${v}=" "$ENV_FILE" >/dev/null 2>&1; then
        MISSING="$MISSING $v"
      fi
    done
    if [ -n "$MISSING" ]; then
      for v in $MISSING; do
        fail "$ENV_FILE missing $v"
      done
    else
      ok "all required vars present in $ENV_FILE"
    fi
    # Common anti-footguns from env.ts prodOnlyChecks
    if grep -E '^CORS_ALLOWED_ORIGINS=.*\*' "$ENV_FILE" >/dev/null 2>&1; then
      fail "CORS_ALLOWED_ORIGINS contains '*' — rejected by env.ts prodOnlyChecks"
    fi
    if grep -E '^MINIO_(ACCESS|SECRET)_KEY=minioadmin$' "$ENV_FILE" >/dev/null 2>&1; then
      fail "MINIO_*_KEY is still 'minioadmin' — rejected by env.ts prodOnlyChecks"
    fi
    if grep -E '^ENCRYPTION_KEY=0{64}$' "$ENV_FILE" >/dev/null 2>&1; then
      fail "ENCRYPTION_KEY is all-zeros — rejected by env.ts prodOnlyChecks"
    fi
  fi
else
  head ".env.production cross-check"
  if [ -f ".env.production" ]; then
    warn ".env.production exists locally — re-run with --env-file .env.production to lint it"
    warn "(make sure it's gitignored — never commit production secrets)"
  else
    dim "no local .env.production found — set vars directly in the Railway dashboard"
    dim "or pass --env-file <path> to validate a local secrets file."
  fi
fi

# ── 6. Verdict ──────────────────────────────────────────────────────
printf '\n'
if [ $FAILED -eq 0 ]; then
  printf '%s✓ Repo is in a deployable shape.%s Run:\n' "$CL_OK" "$CL_RST"
  printf '    railway up\n\n'
  printf '%sFull procedure:%s docs/RAILWAY_DEPLOY.md\n' "$CL_DIM" "$CL_RST"
  exit 0
else
  printf '%s✗ Pre-deploy checks failed — fix the items above before running %srailway up%s.\n' "$CL_BAD" "$CL_HEAD" "$CL_RST"
  exit 1
fi
