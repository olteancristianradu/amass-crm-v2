// B1-PR6: load test for the Socket.IO sync gateway.
//
// Validates the production claim: "100 simultaneous WebSocket connections
// per tenant with sub-2s end-to-end mutation→event latency".
//
// Run from outside the prod stack (or from a separate VPS so the test
// client + server resources aren't shared):
//
//   k6 run \
//     -e BASE_URL=wss://app.tudomain.ro/sync \
//     -e BEARER_TOKEN=<a-tenant-user-jwt> \
//     -e VUS=100 \
//     -e DURATION=5m \
//     infra/load-tests/sync-gateway.k6.js
//
// Install: `brew install k6`  (or https://k6.io/docs/get-started/installation/)
//
// What this measures:
//   - WS handshake p95 / p99 (connection latency, includes JWT verify)
//   - Concurrent connection count sustained
//   - Time-to-event-receipt for a broadcast (the BE publishes via a
//     side-channel HTTP trigger; the WS clients each report the wall-clock
//     delta between issue and receive)
//
// What this does NOT measure:
//   - Redis memory pressure (run `redis-cli INFO memory` during the test)
//   - Postgres connection-pool exhaustion (the WS path doesn't hit DB, but
//     the broadcast trigger does — watch `pg_stat_activity`)
//   - JS event-loop lag at the API container (run `clinic doctor` instead)
//
// Acceptance criteria (from the B1 epic plan):
//   - handshake p95 < 300ms
//   - event delivery p95 < 2s, p99 < 5s
//   - 0 failed connections at VUS=100, <1% at VUS=500

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'ws://localhost:3000/sync';
const BEARER_TOKEN = __ENV.BEARER_TOKEN || '';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '60s';

if (!BEARER_TOKEN) {
  // Fail fast at script-load time so the operator sees the missing config
  // before k6 ramps up 100 VUs and they all fail handshake with the same error.
  throw new Error('Missing BEARER_TOKEN env var. Mint one via POST /auth/login.');
}

const handshakeLatency = new Trend('ws_handshake_seconds');
const eventLatency = new Trend('ws_event_e2e_seconds');
const connectionsFailed = new Counter('ws_connections_failed');
const eventsReceived = new Counter('ws_events_received');

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    ws_handshake_seconds: ['p(95)<0.3'],
    ws_event_e2e_seconds: ['p(95)<2', 'p(99)<5'],
    ws_connections_failed: ['count<1'],  // any failure at the target VU level is a regression
  },
  // Discard response bodies — we only need timing.
  discardResponseBodies: true,
};

export default function () {
  const startedAt = Date.now();
  const url = `${BASE_URL}?token=${BEARER_TOKEN}`;

  const res = ws.connect(url, { headers: { Authorization: `Bearer ${BEARER_TOKEN}` } }, (socket) => {
    socket.on('open', () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      handshakeLatency.add(elapsed);
      // Stay connected for the duration of this iteration so the connection
      // count stays at VUS. The publisher elsewhere fires periodic broadcasts
      // that we count via the 'message' handler.
      socket.setTimeout(() => socket.close(), 30_000);
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg && msg.timestamp) {
          // The publisher includes a server-issue timestamp; subtract from
          // local clock to get the end-to-end delivery latency.
          // Note: clock skew between BE host and k6 host is included here.
          // Use the same host or sync via NTP for accuracy.
          const e2e = (Date.now() - msg.timestamp) / 1000;
          eventLatency.add(e2e);
          eventsReceived.add(1);
        }
      } catch (_e) {
        // Some Socket.IO control frames aren't JSON — ignore.
      }
    });

    socket.on('error', () => {
      connectionsFailed.add(1);
    });

    socket.on('close', () => {
      // No-op; iteration ends naturally.
    });
  });

  check(res, { 'connection established (101)': (r) => r && r.status === 101 });
  if (!res || res.status !== 101) connectionsFailed.add(1);

  // Each VU runs one connection per iteration; the default sleep prevents
  // a thundering reconnect storm when the iteration loop spins up again.
  sleep(1);
}

// Run-summary hook: pretty-print the actionable bits. k6's default summary
// is verbose; this trims to the 4 numbers that matter.
export function handleSummary(data) {
  const ts = (m) => data.metrics[m]?.values || {};
  const fmt = (v) => (v != null ? `${(v * 1000).toFixed(0)}ms` : 'n/a');
  const out = [
    '',
    '=== B1 sync-gateway load test ===',
    `VUs:                 ${VUS}`,
    `Duration:            ${DURATION}`,
    `Handshake p95:       ${fmt(ts('ws_handshake_seconds').p95)}`,
    `Handshake p99:       ${fmt(ts('ws_handshake_seconds').p99)}`,
    `Event e2e p95:       ${fmt(ts('ws_event_e2e_seconds').p95)}`,
    `Event e2e p99:       ${fmt(ts('ws_event_e2e_seconds').p99)}`,
    `Connections failed:  ${ts('ws_connections_failed').count || 0}`,
    `Events received:     ${ts('ws_events_received').count || 0}`,
    `Thresholds passed:   ${Object.values(data.metrics).filter((m) => m.thresholds && Object.values(m.thresholds).every((t) => !t.fails)).length}/${Object.keys(data.metrics).filter((k) => data.metrics[k].thresholds).length}`,
    '',
  ].join('\n');
  return { stdout: out };
}
