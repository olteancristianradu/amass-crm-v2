# SCIM 2.0 — Okta Sandbox Setup Runbook

> **Audience**: tenant admins wiring an Okta organisation to amass-crm so
> that user lifecycle (create, deactivate, role change) is driven from Okta
> instead of the CRM UI.
>
> **Status**: B3-PR4 ships the end-to-end test that proves the protocol
> dance works. This document is the operator-facing companion — follow it
> to connect a real Okta sandbox to a CRM tenant.

## Prerequisites

- **CRM tenant** with at least one `OWNER` or `ADMIN` user (you need their
  JWT to mint the SCIM token).
- **Okta organisation** — a free developer org works
  ([developer.okta.com signup](https://developer.okta.com/signup/)).
- **Public CRM URL** Okta can reach. For sandbox you can use
  `https://app.tudomain.ro/scim/v2`; for local development tunnel via
  `ngrok http 3000` and use the ngrok URL.

## Architecture in one paragraph

The CRM exposes SCIM 2.0 under `/api/v1/scim/v2/Users` and
`/api/v1/scim/v2/Groups`. Okta authenticates with a bearer token minted by
your tenant admin (`POST /api/v1/scim/tokens`). The CRM hashes the token
with SHA-256 and stores only the hash; the raw token is shown to you
**exactly once** at creation time. Groups are SYNTHETIC — there are always
exactly 5, derived from the `UserRole` enum (`OWNER`/`ADMIN`/`MANAGER`/`AGENT`/`VIEWER`).
Adding a user to the `role:ADMIN` group sets `User.role = ADMIN`. Removing
them downgrades to `VIEWER`. See
[`docs/ARCHITECTURE.md` §SCIM 2.0](./ARCHITECTURE.md#scim-20-b3) for the
internal model.

## Step 1 — Generate a SCIM bearer token in the CRM

Hit the admin surface with your OWNER/ADMIN JWT. Replace `<JWT>` and the
host as needed:

```bash
curl -sS -X POST https://app.tudomain.ro/api/v1/scim/tokens \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Okta production"}'
```

Response:

```json
{
  "id": "ckxxxxxxxxxxxxxxxxxxxxxx",
  "name": "Okta production",
  "token": "Hf3...43chars...kQ8",
  "createdAt": "2026-05-15T09:12:00.000Z",
  "warning": "Store this token now — it will not be shown again."
}
```

**Copy the `token` value immediately.** The plaintext is never displayed
again — only its SHA-256 hash is stored. If you lose it, revoke this row
(`DELETE /api/v1/scim/tokens/:id`) and mint a new one.

In the CRM UI: **Setări → Integrări → SCIM tokens → Add new** does the
same thing without curl.

## Step 2 — Create the Okta SCIM 2.0 app

1. Okta admin → **Applications → Browse App Catalog → "SCIM 2.0 Test App
   (Header Auth)"** → **Add Integration**.
2. **General settings**: name it something descriptive like
   `amass-crm-prod`. Click **Next**.
3. **Sign-on options**: leave defaults (we don't ship SSO via this app —
   SCIM only).
4. **Assignments**: skip for now; you'll wire users in step 5.

## Step 3 — Wire the SCIM connector

In your new app: **Provisioning → Configure API Integration**.

| Field | Value |
|-------|-------|
| **Enable API integration** | ✓ checked |
| **Base URL** | `https://app.tudomain.ro/api/v1/scim/v2` |
| **API Token** | the `token` value from Step 1 |
| **Unique identifier field for users** | `userName` |
| **Supported provisioning actions** | ✓ Push New Users, ✓ Push Profile Updates, ✓ Push Groups, ✓ Import New Users and Profile Updates |
| **Authentication Mode** | HTTP Header (Bearer) |

Click **Test API Credentials**. Okta will hit `GET /scim/v2/Users` with
the bearer token. Green check = token is good. Red = check the token
isn't already revoked or that the URL is reachable from Okta's IP range.

Click **Save**.

## Step 4 — Map Okta attributes to SCIM fields

Okta → Provisioning → **To App → Edit Attribute Mappings**. The CRM consumes
this minimal subset; everything else is silently dropped:

| Okta attribute | SCIM field | CRM column | Notes |
|---|---|---|---|
| `user.email` | `userName` | `User.email` | Lowercased on write. Must be unique within the tenant. |
| `user.firstName` | `name.givenName` | `User.fullName` (first half) | Recomposed as `${givenName} ${familyName}`. |
| `user.lastName` | `name.familyName` | `User.fullName` (last half) | Required by SCIM schema — use `-` for users without one. |
| `user.email` | `emails[primary eq true].value` | `User.email` | Same as `userName` for us. |
| `user.status == ACTIVE` | `active` | `User.isActive` | Maps deprovisioning → soft-delete. |

**Dropped silently** (Okta sends them, we accept and discard):
`externalId`, `phoneNumbers`, `addresses`, `locale`, `timezone`,
`displayName`, the enterprise extension
(`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`),
secondary emails.

**Roles are NOT mapped via user attributes** — they're driven via Group
membership (Step 5). New users land as `VIEWER` (least privilege) until
Okta puts them in a higher group.

## Step 5 — Map Okta groups to CRM roles

Okta → Provisioning → **Push Groups**. Create 5 Okta groups (or reuse
existing ones) and link each to one of the CRM's synthetic role groups:

| Okta group (your naming) | CRM group id | Effective CRM role |
|---|---|---|
| `amass-crm-owners` | `role:OWNER` | OWNER |
| `amass-crm-admins` | `role:ADMIN` | ADMIN |
| `amass-crm-managers` | `role:MANAGER` | MANAGER |
| `amass-crm-agents` | `role:AGENT` | AGENT |
| `amass-crm-viewers` | `role:VIEWER` | VIEWER |

For each: **Push Groups → + Push Groups → Find groups by name** →
**Match result to existing group** → paste `role:ADMIN` (etc).

Add an Okta user to `amass-crm-admins` → on next sync, the CRM bumps
`User.role = ADMIN`. Remove them → role drops to `VIEWER` (the
least-privilege floor; there's no "no role" state).

## Step 6 — Test the push

1. Okta → Directory → **People → Add Person**. Give them an email
   (`alice@example.com`).
2. **Applications → amass-crm-prod → Assign → Assign to People → Alice**.
3. Within ~30 seconds Okta sends `POST /scim/v2/Users` to the CRM.
4. Verify in CRM: `Setări → Utilizatori` — Alice should appear with role `VIEWER`.
5. Add Alice to your `amass-crm-admins` Okta group → her CRM role flips to `ADMIN`.
6. Unassign Alice from the app in Okta → CRM marks her `active=false`
   (soft delete; her deals/leads stay attributed to her).

## Troubleshooting

### `401 Unauthorized` on every call

- **Token revoked.** Check `GET /api/v1/scim/tokens` from the admin UI;
  any row with `revokedAt != null` is dead. Mint a new one and update
  Okta.
- **Header malformed.** Okta sends `Authorization: Bearer <token>`. If
  you pasted with extra whitespace or a trailing newline the guard
  rejects it. Re-paste cleanly.
- **CRM not reachable.** Curl the URL from outside your network:
  `curl -i https://app.tudomain.ro/api/v1/scim/v2/Users -H "Authorization: Bearer $T"`.
  Expect 200 + a SCIM ListResponse JSON. If you get a connection error,
  Caddy or DNS is misconfigured.

### `400 Bad Request` with `scimType: invalidFilter`

The CRM supports ONLY `userName eq "value"` for `GET /Users?filter=...`
(B3-PR1 deliberate scope). Okta sometimes synthesizes complex filters
like `active eq true and (userName co "@example.com")` during reconcile.

**Workaround**: in Okta's provisioning settings, switch from
**"Import everything"** to **"Profile sourcing → On-demand provision"**.
On-demand mode pushes one user at a time with simple
`userName eq` lookups, which we support. Import-mode requires multi-field
filters and is on our backlog as B3-PR5/6.

### `400` with `scimType: invalidPath` on PATCH

The CRM supports `op: "replace"` only, on these paths:

- `active`
- `name.givenName`
- `name.familyName`
- `emails[primary eq true].value` (and `emails[type eq "work"].value`)
- `userName`

Anything else returns 400. Okta's defaults match this list; if you've
customised the Okta attribute map to push other fields (e.g. `title`,
`addresses[type eq "work"].streetAddress`), undo those — the CRM has
no column to write them to.

### `501 Not Implemented` on `POST /Groups` or `DELETE /Groups/:id`

Expected. The 5 CRM groups are FIXED by the RBAC enum. Okta's "Push
Groups" feature against these endpoints is supposed to MATCH existing
groups (Step 5), not create new ones. If Okta tries to create, the
mapping in step 5 is misconfigured — re-do the **Match result to
existing group** step and pick `role:OWNER` / `role:ADMIN` / etc.

### User shows `Status: Inactive` in CRM after Okta deprovisioning

Working as designed. The CRM never hard-deletes provisioned users —
soft-delete keeps the audit trail intact (their deals/leads/tasks still
reference them via foreign key). If you genuinely need to remove the row,
do it from the CRM admin UI after confirming no active references.

### `409 Conflict` with `scimType: uniqueness` on user create

A user with the same `userName` (email) already exists in this tenant.
Either:

- The user was previously created in the CRM UI (pre-SCIM) — Okta should
  match-and-update them via Step 6, not create. Use
  `GET /Users?filter=userName eq "alice@example.com"` to confirm they
  exist, then mark them as **Confirmed** in Okta's import view.
- A previous deprovision left the row with `active=false` — that row
  still occupies the unique `(tenantId, email)` slot. Reactivate via
  `PATCH active=true` rather than re-create.

## Token rotation

1. Mint a new token via `POST /api/v1/scim/tokens` with a name like
   `Okta production - rotated 2026-Q3`.
2. In Okta → Provisioning → Configure API Integration → paste the new
   token → **Test API Credentials** → **Save**.
3. Wait ~5 minutes; confirm a few SCIM operations succeed (Okta's "Sync
   Now" button).
4. Revoke the old token: `DELETE /api/v1/scim/tokens/<old-id>`. The next
   call using the old token returns 401 immediately (the verify path
   filters by `revokedAt IS NULL` — no Redis blocklist needed).

## Multi-IdP / multi-environment

Each tenant can have unlimited SCIM tokens. Conventional naming:

- `Okta production`
- `Okta staging`
- `Azure AD production`
- `JumpCloud sandbox`

A leaked or compromised token only affects one IdP; revoking it doesn't
impact the others. All token lifecycle events are audit-logged as
`scim.token_created` / `scim.token_revoked` and visible in the CRM audit
log.

## What's NOT covered by this runbook

- **SAML SSO**: see B2 (`/auth/saml/*`) — a different surface.
- **Just-in-time provisioning at SAML login**: separate sprint, not B3.
- **Okta-side group membership rules** (dynamic groups based on
  attributes) — that's Okta product behavior, not our SCIM API.
- **Bidirectional sync** (CRM → Okta on local user changes) — the CRM is
  a SCIM SERVER, not a client. Changes made directly in the CRM UI do
  not propagate back to Okta. Authoritative source = Okta; treat CRM-side
  user edits as a break-glass override.
