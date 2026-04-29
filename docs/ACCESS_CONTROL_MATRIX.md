# Access Control Matrix

Per SOC 2 CC6.1 (Logical access — restrict access to authorized users only).
Per GDPR Art. 32(1)(b) (technical measures: ability to restore access).

Last updated: 2026-04-29 · v1.0

## Roles

| Role | Description | Typical use |
|---|---|---|
| OWNER | Tenant owner — billing + all settings + IP rights | Founder of the customer organization |
| ADMIN | Org admin — user mgmt + most settings | IT lead, DPO, COO |
| MANAGER | Team lead — sees own team data + assigns deals | Sales manager |
| AGENT | Front-line — own contacts/deals/tasks/calls | Salesperson, support agent |
| VIEWER | Read-only — limited dashboards | Auditor, observer |

## Cross-cutting permissions

| Capability | OWNER | ADMIN | MANAGER | AGENT | VIEWER |
|---|---|---|---|---|---|
| Login + 2FA setup own | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create own contact/company/deal | ✓ | ✓ | ✓ | ✓ | – |
| View own data | ✓ | ✓ | ✓ | ✓ | ✓ (dashboard slices) |
| View team data | ✓ | ✓ | ✓ (own team) | – | – |
| View all tenant data | ✓ | ✓ | – | – | – |
| Edit own | ✓ | ✓ | ✓ | ✓ | – |
| Edit team's | ✓ | ✓ | ✓ (own team) | – | – |
| Edit all | ✓ | ✓ | – | – | – |
| Delete (soft) | ✓ | ✓ | ✓ (own team) | ✓ (own only) | – |
| GDPR erasure (anonymize) | ✓ | ✓ | – | – | – |
| GDPR export (subject portable) | ✓ | ✓ | – | – | – |
| Read audit log | ✓ | ✓ | – | – | – |
| Manage users (create/disable) | ✓ | ✓ | – | – | – |
| Change roles | ✓ | – | – | – | – |
| Billing + plan change | ✓ | – | – | – | – |
| Webhook endpoints (outbound) | ✓ | ✓ | – | – | – |
| Custom fields config | ✓ | ✓ | – | – | – |
| Workflow automation | ✓ | ✓ | ✓ (read) | – | – |
| Onboarding wizard complete | ✓ | – | – | – | – |
| Sample data load | ✓ | – | – | – | – |
| Export to CSV | ✓ | ✓ | ✓ | ✓ | – |

## Module-specific (Cedar policies — see apps/api/src/access-control/)

For granular fine-grained, Cedar policy engine layered on top of Roles.
Resources use `Resource::id` notation. Examples:
- `consents::create` on `ConsentRecord::*` → MANAGER+
- `consents::revoke` on `ConsentRecord::*` → MANAGER+
- `whatsapp::create` on `WhatsappAccount::*` → OWNER, ADMIN
- `billing::checkout` on `BillingSubscription::self` → OWNER only
- `tenant::delete` → impossible (no policy permits)

## Defense in depth

Three layers enforce access (per CLAUDE.md rule #3):
1. **JwtAuthGuard + RolesGuard** — token validity + role required
2. **Cedar policy** — fine-grained permission per resource
3. **Postgres RLS** — `SET LOCAL ROLE app_user` + `SET LOCAL app.tenant_id` →
   queries auto-filtered to current tenant; cross-tenant impossible at SQL level

If layer 1 leaks (e.g., bug bypasses role check), layers 2+3 still block.

## User lifecycle

| Event | Trigger | Effect |
|---|---|---|
| Created | Owner invites via /settings/users | User receives email with activation token |
| Activated | User sets password via token link | Session granted; full role permissions active |
| 2FA enrolled | User opts in via /settings/2fa | TOTP code required at next login |
| Inactive | Admin sets isActive=false | Existing JWT continues until expiry; refresh token rejected |
| Deleted (soft) | Admin removes | All future sessions rejected; audit trail preserved |
| GDPR erasure | OWNER/ADMIN initiates | PII anonymized; audit/fiscal data preserved |

## Session management

- Access token: 15 min TTL (configurable JWT_ACCESS_TTL)
- Refresh token: 30 day TTL with rotation on each refresh
- Concurrent sessions: unlimited (each device has own refresh token via Session table)
- Manual revocation: OWNER/ADMIN can kill sessions per user from /settings/users
- Token revocation: jti stored in revocation table; rejected on next verify

## Quarterly access review

Per SOC 2 CC6.2: at least quarterly, OWNER reviews:
- All active users — confirm still in role
- All ADMIN-tier accounts — verify business need
- Any service accounts (system_api_keys) — rotate or remove

Manual process for now (until customer base justifies tooling).
