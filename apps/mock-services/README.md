# @amass/mock-services

Single Node/Express container exposing seven mock endpoints on different
ports. Used during local verification + integration tests to exercise
the code paths that hit Twilio / Meta / Google / Microsoft / ANAF /
generic webhooks / AI providers without leaving the laptop.

## Boot

```bash
pnpm mocks:up           # starts mailpit, stripe-mock, mock-services
pnpm mocks:logs         # follow logs of all mock containers
pnpm mocks:down         # stop and remove mock containers
```

## Endpoints (inside docker network)

| Service | Port | Sample endpoint |
|---------|------|-----------------|
| twilio  | 3001 | `POST /2010-04-01/Accounts/:sid/Calls.json` |
| meta    | 3002 | `POST /v19.0/:phoneId/messages` |
| google  | 3003 | `POST /token`, `GET /calendar/v3/calendars/primary/events` |
| microsoft | 3004 | `POST /common/oauth2/v2.0/token`, `GET /v1.0/me/calendar/events` |
| anaf    | 3005 | `POST /prod/FCTEL/rest/upload`, `GET /prod/FCTEL/rest/stareMesaj` |
| webhook | 3006 | `POST /*` (records request), `GET /_received` |
| ai      | 3007 | `POST /v1/chat/completions`, `POST /v1/embeddings` |

Healthcheck for every service: `GET /_health`.

## Other mocks

- `mailpit` — fake SMTP at `mailpit:1025`, web UI at `http://localhost:8025`.
- `stripe-mock` — official Stripe API mock at `stripe-mock:12111`.
