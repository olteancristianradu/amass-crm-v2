# Load tests

Operator-run benchmarks for the production stack. Not part of CI — these
intentionally hammer the live system and should only run against staging
or a dedicated load-test VPS.

## Prerequisites

```sh
brew install k6           # or https://k6.io/docs/get-started/installation/
```

## sync-gateway.k6.js — B1-PR6

Validates the WebSocket sync gateway under realistic load.

**Acceptance criteria** (from B1 epic plan):
- Handshake p95 < 300ms
- Event delivery e2e p95 < 2s, p99 < 5s
- Zero failed connections at 100 VUs

### Quick run (against local stack)

```sh
# 1. Get a valid JWT for any test user
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"dana@test.ro","password":"Dana2026!"}' \
  | jq -r '.tokens.accessToken')

# 2. Run the test
BASE_URL=ws://localhost:3000/sync BEARER_TOKEN=$TOKEN VUS=50 DURATION=60s \
  k6 run infra/load-tests/sync-gateway.k6.js
```

### Production run (from a separate VPS)

```sh
BASE_URL=wss://app.tudomain.ro/sync BEARER_TOKEN=$PROD_TEST_TOKEN \
  VUS=100 DURATION=5m k6 run infra/load-tests/sync-gateway.k6.js
```

Watch these metrics in parallel:
- `redis-cli INFO memory` — presence map grows linearly with VUs
- `pg_stat_activity` — confirm no connection-pool exhaustion
- API container CPU / event-loop lag — `docker stats amass-api`

### Interpreting the output

The summary prints 4 numbers that map to the launch acceptance criteria:

| Metric | Target | Failure means |
|---|---|---|
| Handshake p95 | < 300ms | JWT verify too slow OR Redis is the bottleneck |
| Event e2e p95 | < 2s | Broadcast fan-out lag |
| Connections failed | 0 | Gateway rejecting handshakes — JWT secret mismatch or rate limit |
| Events received / VU | ≥ 1 per published event | Some clients missed events — room membership bug |

### Generating sustained mutations for end-to-end test

The sync-gateway test only validates the WS path. To exercise the FULL
loop (HTTP mutation → publish → broadcast → FE receive), run this in
parallel:

```sh
while true; do
  curl -s -X POST http://localhost:3000/api/v1/deals/$DEAL_ID/move \
    -H "authorization: Bearer $TOKEN" \
    -d '{"stageId":"'$STAGE_ID'","position":0}' > /dev/null
  sleep 2
done
```

Connected WS clients should see a `deal.moved` event within 2s of each
HTTP call.
