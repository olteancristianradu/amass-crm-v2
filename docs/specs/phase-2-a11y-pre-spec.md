# Phase 2 — Accessibility Pre-Spec (Forward-Looking)

> **Status:** PRE_SPEC_ONLY · **Auditor:** `accessibility-auditor` sub-agent · **Date:** 2026-05-18
> **For:** `frontend-engineer` (Phase 2 UI work, ~18 story points across 4 surfaces)
> **WCAG target:** 2.1 Level AA (some AAA where called out as soft-target)

Phase 2 backend (F1 e-sign + F2 multi-step approvals) is shipped as backend-only across
3 commits: `d62371d`, `f19c2e8`, `5d91c0d`. Frontend Phase 2 UI is NOT BUILT yet — this
pre-spec is the a11y contract that `frontend-engineer` must satisfy when the FE work
starts (likely Phase 3 sprint planning will roll this in, or it stays in Phase 2
backlog).

## Pre-existing stale FE (NOT in Phase 2 commits, but will need refactor pass)

These were built for single-step approval policies and predate the centralised design
tokens in `7179229`. They need a refactor pass to consume the new multi-step F2 endpoints
(`POST /approvals/policies` with `steps[]`, `GET /approvals/requests/my-inbox`, `POST
/approvals/requests/:id/withdraw`).

- `apps/web/src/routes/approvals.list.tsx` (253 LoC)
- `apps/web/src/routes/settings.approvals.tsx` (15 LoC)
- `apps/web/src/routes/settings.approvals.page.tsx` (340 LoC)
- `apps/web/src/i18n/{ro,en}/approvals.json`

Re-audit these once the refactor lands.

---

## 1. Signature canvas (F1 ceremony UI, `/p/sign/:token`)

Drawn-signature widgets are historically the worst a11y offender. DocuSign + HelloSign
both ship a "type your name" fallback for this exact reason. Backend already accepts a
base64 PNG (`SubmitSignatureSchema` in `packages/shared/src/schemas/contracts.ts:155`),
so typed-name can rasterize to PNG client-side via OffscreenCanvas and submit through
the same endpoint without backend changes.

| AC | SC | Requirement |
|---|---|---|
| AC-SIG-1 | 2.1.1 (A) | Mode toggle "Desenează / Scrie numele" as `<Tabs>` with two `<TabsTrigger>`. Default to "Scrie numele" when `prefers-reduced-motion` OR keyboard-detected focus before pointer-down. |
| AC-SIG-2 | 2.5.5 (AAA, treat as AA) | Mode-toggle pills ≥44×44 CSS px, ≥8 px gap. Canvas ≥320×120 mobile, ≥480×160 desktop. Action buttons ≥44×44. |
| AC-SIG-3 | 4.1.2 (A) | Canvas: `role="img"`, `aria-label="Zonă de semnătură olografă; apasă T pentru a comuta la mod scris"`, `aria-describedby="sig-legal"`. Typed-name input: visible `<Label>` "Numele complet pentru semnătură electronică". Both share `aria-describedby="sig-legal sig-error"`. |
| AC-SIG-4 | 2.4.7 (AA) | Canvas wrapper + typed-name input use `--ring` token. NEVER `outline: none` without `:focus-visible` replacement. Verify with axe-core `focus-order-semantics`. |
| AC-SIG-5 | 1.4.11 (AA) | Canvas border ≥3:1 against page in both light + dark. Drawn ink ≥3:1 against canvas fill. |
| AC-SIG-6 | 1.4.3 (AA) | Legal disclaimer (`#sig-legal`) ≥4.5:1. Often shipped as muted-text — explicitly check with pa11y. |
| AC-SIG-7 | 3.3.2 (A) | Above canvas: `<p>` (not placeholder) "Desenează semnătura ta sau apasă T pentru a o scrie." |
| AC-SIG-8 | 2.4.3 (A) | Tab order: skip-link → page heading → contract preview iframe → "Citește contractul" checkbox → mode toggle → canvas/input → Șterge → Refuză → Semnez. |
| AC-SIG-9 | 1.3.1 (A) | Typed-name preview in `<figure>` with `<figcaption>"Previzualizare semnătură: <numele>"`. Announce on change via `aria-live="polite"`. |
| AC-SIG-10 | 2.2.6 (AAA soft) | 14-day TTL announced as `<time datetime="…">` so SR users hear "Expiră pe 1 iunie 2026". |
| AC-SIG-11 | 2.3.3 (AAA soft) | Honor `prefers-reduced-motion: reduce` — disable canvas ink-trail animation, render strokes static. |

**Backend enabler verified:** typed-name → OffscreenCanvas → PNG → same `POST
/p/sign/:token/sign` body. No backend change required.

---

## 2. Multi-step approval UI (F2)

Backend endpoints (verified in `f19c2e8` controller):

- `GET /api/v1/approvals/requests/my-inbox`
- `POST /api/v1/approvals/requests/:id/decide` body `{ action: 'APPROVE'|'REJECT', reason? }`
- `POST /api/v1/approvals/requests/:id/withdraw`

Backend emits in-app notifications via `approvals-notifier.service.ts` — FE subscribes via
Socket.IO + must surface without stealing focus.

| AC | SC | Requirement |
|---|---|---|
| AC-APR-1 | 1.4.1 (A) | Status badges PENDING/APPROVED/REJECTED/EXPIRED/WITHDRAWN combine icon + text + colour. Never colour-only. |
| AC-APR-2 | 3.3.1 (A) | 409 `APPROVAL_ALREADY_DECIDED` or 403 `SELF_APPROVAL_FORBIDDEN` → `<div role="alert" aria-live="assertive">` above form. |
| AC-APR-3 | 4.1.3 (AA) | Decide success → toast via `<Toaster>` `aria-live="polite"`. Don't steal focus; keep on Approve button (disabled). |
| AC-APR-4 | 2.4.3 (A) | Tab: subject (`<h1>`) → step list → reason textarea → Aprobă → Respinge → Retrage (destructive last). |
| AC-APR-5 | 3.3.3 (AA) | Reject without reason → inline error `aria-describedby="reason-error"`: "Introdu motivul respingerii (min. 1 caracter)." |
| AC-APR-6 | 1.3.1 (A) | Step list as `<ol>` (not `<div>`). Each `<li>`: `<span class="sr-only">Pasul 1 din 2:</span> Manager review`. Current step `aria-current="step"`. |
| AC-APR-7 | 2.4.6 (AA) | `<h1>` "Aprobare ofertă #Q-2026-0142" → `<h2>` "Pași aprobare" → `<h2>` "Decizia ta" → `<h3>` per step. |
| AC-APR-8 | 4.1.2 (A) | `<Button aria-label="Aprobă oferta Q-2026-0142">Aprobă</Button>`. Icon-only forbidden. |
| AC-APR-9 | 2.1.2 (A) | Decision in `<Sheet>` or `<Dialog>` traps focus, Esc closes, focus returns to row's Decide button. |
| AC-APR-10 | 3.2.2 (A) | Approve/Reject radio MUST NOT auto-submit. Submit only on explicit button. |
| AC-APR-11 | 1.4.3 (AA) | Inbox badge count pill on nav ≥4.5:1 in both modes. |
| AC-APR-12 | 4.1.3 (AA) | SLA expires while inbox open (Socket.IO push from `approvals-sla.processor`) → row flips to "Expirat" announced via `aria-live="polite"` region. |

---

## 3. Contract template editor (variable interpolation `{{var}}`)

Backend ships `contract-templates.service.ts` with strict allow-list interpolation (key
regex `/^[a-zA-Z_][a-zA-Z0-9_.]*$/` in `ContractTemplateVariableSchema`). Admin-facing
but still AA.

| AC | SC | Requirement |
|---|---|---|
| AC-TPL-1 | 2.1.1 (A) | Variable picker = existing `<CommandPalette>` (`apps/web/src/components/ui/command-palette.tsx`). Down/Up nav, Enter insert, Esc dismiss. |
| AC-TPL-2 | 2.4.7 (AA) | After insertion, caret returns to editor immediately after the inserted `{{var}}` token. |
| AC-TPL-3 | 4.1.3 (AA) | Live preview: `<section aria-live="polite" aria-atomic="false">`. `polite` (NOT `assertive`). `atomic="false"` so only diff announced. |
| AC-TPL-4 | 3.3.2 (A) | Each variable shows key (mono) + label (human) + `required` badge. Required announced via text, not colour. |
| AC-TPL-5 | 1.3.5 (AA) | Body `<textarea>` or contenteditable with `role="textbox" aria-multiline="true"`. If Monaco/CodeMirror: `aria-label="Corpul contractului în Markdown"` + screen-reader mode enabled. |
| AC-TPL-6 | 2.4.3 (A) | Tab: name → description → variables list → body → "Insert variable" → preview → publish/save. |
| AC-TPL-7 | 3.3.4 (AA) | Publish is destructive (locks template for in-flight contracts). Confirmation `<Dialog>` with "Da, publică" / "Anulează", focus on Cancel by default. |
| AC-TPL-8 | 1.4.4 (AA) | Usable at 200% browser zoom. No horizontal scroll on form column. |

---

## 4. Public signing page (`/p/sign/:token`) — mobile-first, unauthed

Backend `PublicSigningController` GET returns `CeremonyViewResponse { contractTitle,
tenantName, signerName, pdfDownloadUrl, expiresAt, cosigners[], canSignNow }`.

Highest-stakes a11y surface: counterparties are random external users on random devices,
often mobile. A11y failure = lost deals + GDPR Art. 12 violation.

| AC | SC | Requirement |
|---|---|---|
| AC-PUB-1 | 3.1.1 (A) | `<html lang="ro">` default. If `?lang=en` OR `Accept-Language: en` → `<html lang="en">`. Inline PDF preview keeps `lang` from contract metadata. |
| AC-PUB-2 | 3.1.2 (AA) | Bilingual disclaimers wrap each block in `<section lang="ro">`/`<section lang="en">`. |
| AC-PUB-3 | 1.4.4 (AA) | Base font ≥16 px so iOS Safari doesn't auto-zoom on input focus. |
| AC-PUB-4 | 1.4.10 (AA) | Single-column at ≤375 px, no horizontal scroll. PDF iframe `width="100%" height="60vh"` + `<a href="<pdfDownloadUrl>" download>Descarcă PDF</a>` fallback (mobile Safari blocks iframe-PDF). |
| AC-PUB-5 | 2.4.1 (A) | Skip link `<a href="#main">Sari la conținutul principal</a>` visible on focus. |
| AC-PUB-6 | 2.4.6 (AA) | `<h1>` "Semnează contractul: {title}" → `<h2>` Detalii → Document → Semnătura ta → Refuză (collapsible). No skipping. |
| AC-PUB-7 | 3.3.2 (A) | "Am citit contractul" checkbox: `<Label htmlFor="read-confirm">` wraps whole row so entire row is clickable. |
| AC-PUB-8 | 3.3.1 + 4.1.3 | Decline textarea: visible counter `<span aria-live="polite">{n}/2048 caractere</span>`. Debounce announcement to 500ms. |
| AC-PUB-9 | 2.5.5 | All buttons (Semnez, Refuză, mode toggle, lang switcher, Descarcă PDF) ≥44×44 with ≥8 px spacing. |
| AC-PUB-10 | 1.4.3 | Trust signals (lock icon, tenant logo, legal text) ≥4.5:1. Common failure: greyed-out "Powered by" footer falls below 3:1. |
| AC-PUB-11 | 3.2.2 | Lang switcher does NOT auto-submit/reload. Show "Aplică" button OR clearly announce reload. |
| AC-PUB-12 | 4.1.2 | Cosigners list: `<ul aria-label="Co-semnatari">` each `<li>` "Maria Popescu — În așteptare". |
| AC-PUB-13 | 2.2.1 (A) | Ceremony expiry as live countdown OR static date (NOT hard timeout). 14-day TTL is server-side. Document this. |

---

## 5. Component recommendations

### Use (existing in `apps/web/src/components/ui/`)

| Need | Component |
|---|---|
| Signature-mode toggle | `<Tabs>` (`tabs.tsx`) |
| Variable picker | `<CommandPalette>` (`command-palette.tsx`) |
| Status toasts | `<Toaster>` — confirm `aria-live="polite"` not assertive |
| Form fields | `<Input>`, `<Label>`, `<Textarea>` + React Hook Form + Zod |
| Loading | `<Skeleton>` + `aria-busy="true"` on wrapper |
| Error rows | `<QueryError>` |

### Must vendor (NOT yet in `components/ui/`)

`<Dialog>`, `<Sheet>`, `<Checkbox>`, `<RadioGroup>`, `<Badge>`, `<Form>` (RHF wrapper).

### Avoid

| Anti-pattern | Why |
|---|---|
| Native `<canvas>` without keyboard fallback | Fails SC 2.1.1 |
| `<div role="button">` for Sign | Use `<button>` |
| Icon-only buttons | Fails SC 4.1.2 — wrap in `<span class="sr-only">` |
| `aria-live="assertive"` for non-emergencies | Use `polite` |
| `outline: none` on focus | Project tokens have `--ring` — never strip |
| `placeholder` as only label | Fails SC 3.3.2 |
| `tabindex` > 0 | Breaks natural Tab order |
| Auto-submit lang switcher | Fails SC 3.2.2 |

---

## 6. Effort estimate (built-in a11y, not bolted-on)

Total Phase 2 FE work: **~18 story points**.

| Story | Pts | Notes |
|---|---|---|
| F1.UI-1 Contract list + detail (new statuses OUT_FOR_SIGNATURE / PARTIALLY_SIGNED / DECLINED) | 2 | Status pill refactor + `<Badge>` |
| F1.UI-2 "Send for signature" dialog (signer rows + mode toggle + expiry) | 3 | New `<Dialog>` + form, signer-row array field |
| F1.UI-3 Public signing page chrome + PDF preview + cosigner status | 3 | Unauthed, lang switcher, mobile-first |
| F1.UI-4 Signature widget (canvas + typed-name tabs + PNG rasteriser) | **5** | The hard one. A11y-first adds ~1 pt vs naive `signature_pad`. |
| F1.UI-5 Decline flow (textarea + counter + confirm) | 1 | |
| F2.UI-1 Approval inbox `/app/approvals/inbox` — list + filters | 2 | Refactor existing `approvals.list.tsx` |
| F2.UI-2 Approval detail (multi-step list + decide form) | 3 | `<ol>` step list with `aria-current`, decide form |
| F2.UI-3 Policy editor multi-step (refactor `settings.approvals.page.tsx`) | 3 | Steps array, approverId XOR approverRole, max 10 |
| F2.UI-4 Inbox badge nav + Socket.IO sub | 1 | `aria-live` count update |
| F1.UI-6 Contract template editor (CRUD + variable picker + preview) | 4 | Markdown editor + `<CommandPalette>` + live preview |

A11y overhead is included — front-load is cheaper than retrofit (~30% rework saved).

## 7. Pre-shipping gate (`frontend-engineer` runs before re-audit)

```bash
pnpm --filter @amass/web build && pnpm --filter @amass/web preview
# OR staging URL

pa11y --standard WCAG2AA --reporter json <url> > /tmp/pa11y-phase2-$(date +%F).json
# Per page:
#   /p/sign/<sample-token>
#   /app/approvals/inbox
#   /app/approvals/requests/<id>
#   /app/settings/approval-policies
#   /app/settings/contract-templates
```

Plus manual VoiceOver pass (1 min/page) + keyboard-only pass + `prefers-reduced-motion`
toggle + dark mode contrast verify.

**Re-audit handoff:** ping `accessibility-auditor` with staging URL + pa11y JSON outputs.
