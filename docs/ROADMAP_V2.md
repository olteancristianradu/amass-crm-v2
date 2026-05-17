# ROADMAP V2 — Drum spre paritate Pipedrive (și diferențiere vs Salesforce)

> Versiune: 1.1 · Creat: 2026-05-17 · Owner: Radu (solo dev) · Status: **aprobat pentru execuție** (regula "wait for approval" suspendată pentru acest plan la cererea user-ului)

## 0. Sumar executiv

Acest document e planul de execuție pentru a închide gap-ul față de Pipedrive (realist, 3-6 luni) și pentru a începe selectiv pe Tier 2 față de Salesforce (12-18 luni). Tier 3 este **explicit out of scope** — nu se atinge solo.

**Principii directoare:**

1. **Niciun feature nou fără migration + service + controller + spec + e2e + audit security + docs.** Definition of Done (DoD) e identic cu sprint-urile S0-S20.
2. **Multi-tenant isolation e legea #1.** Orice query nou trece prin `runWithTenant()` + RLS. Nicio excepție.
3. **Diferențiere > paritate.** Voice intelligence + ANAF + RO-native sunt moat-ul real. Tier 1 features doar îi închid gap-ul vs Pipedrive ca SMB-urile să nu aibă motiv să plece.
4. **Phase gate strict.** O fază nu începe până faza precedentă n-are: tests verde, security audit OK, docs updated, CHANGELOG bumped.
5. **Solo dev = parallelization via sub-agenți.** 8 sub-agenți specializați rulează tasks independente în paralel; orchestrarea o fac eu (main session).

## 1. Echipe (sub-agenți) — org chart (22 agenți, 6 departamente)

Sub-agenții sunt definițiile din `.claude/agents/*.md`. Fiecare are rol clar, tools restrânse la ce-i trebuie, și descriere care declanșează auto-invocare când taskul matchează.

### 🧪 ENGINEERING (5)
- `backend-engineer` — NestJS + Prisma services, controllers, migrations
- `frontend-engineer` — React 19 + TanStack + shadcn
- `mobile-engineer` — React Native + Expo (Phase 4)
- `database-architect` — Postgres schema, RLS, indexes, query plans
- `devops-engineer` — Docker, Caddy, CI/CD, Prometheus, observability

### 🎨 DESIGN & UX (4)
- `ux-designer` — Token-first design, audit vizual, polish
- `design-system-lead` — Design tokens, shadcn lib, light/dark parity
- `ux-researcher` — Heuristic eval, user testing, feedback synthesis
- `accessibility-auditor` — WCAG 2.1 AA, screen reader, keyboard nav

### 🛡️ SECURITY (4)
- `security-architect` — STRIDE, AUTHZ matrix, audit schema, key management
- `security-red-team` — OWASP per PR, multi-tenant breakout attempts
- `pentest-specialist` — Quarterly deep pentest, full-stack adversarial
- `security-blue-team` — Audit log drift, RLS verification, SIEM health

### ✅ QA (3)
- `qa-automation` — Vitest unit + e2e, testcontainers Postgres
- `qa-manual` — Live browser smoke + regression sweep
- `interactive-feedback` — A/B testing, feature flags, behavior analytics

### 📊 PRODUCT & DATA (3)
- `product-manager` — Scope, acceptance criteria, RICE, user-facing comms
- `data-analyst` — SQL reports, KPIs, funnels, cohort analysis
- `i18n-localization` — Translation extraction, locale catalogs, formatting

### 🚨 OPERATIONS (3)
- `incident-response` — Production incident commander, ICS-style
- `code-reviewer` — Pre-merge diff review (CLAUDE.md compliance)
- `docs-writer` — README, CHANGELOG, ADRs, runbooks (Diataxis)

> Notă: `database-architect` separat de `backend-engineer` pentru că majoritatea bug-urilor multi-tenant vin din migrations greșite. `pentest-specialist` separat de `security-red-team` — primul rulează quarterly deep, al doilea per PR. Org chart complet în `.claude/agents/README.md`.

**Cum se invocă în execuție:**
- Auto: agentul cu descriere matching e ales automat (de mine, main session).
- Manual: la cerere explicită din prompt (ex: "trimite la `security-red-team`").
- Parallel: când task-urile sunt independente, multiple Agent calls în același message.

## 2. Faze și milestones

### Phase 0 — Fundamente (3 săptămâni)

**Scop:** Layer-uri necesare pentru tot ce vine după. Risk mic, valoare mare.

| Feature | Effort | Sub-agenți alocați |
|---|---|---|
| **i18n EN** (acum doar RO) | 7 zile | frontend, backend, qa-automation |
| **Multi-currency cu rates daily** | 4 zile | backend, database-architect, qa-automation |
| **Saved searches + custom views per user** | 5 zile | backend, frontend, qa-automation |

**Acceptance criteria Phase 0:**
- [ ] Toate stringurile UI extrăse în `apps/web/src/i18n/{ro,en}.json`, lazy-load per limbă, language switcher în settings.
- [ ] FX rates job zilnic 06:00 RO (BullMQ), tabela `exchange_rate` cu (from, to, rate, asOf), `Deal.amount` păstrează `currency` + opt `amountBase`.
- [ ] Endpoint `POST /saved-views` + `GET /saved-views?entity=...`; FE: dropdown "Vederile mele" în list pages.
- [ ] Coverage ≥80% pe modulele atinse (regulile CLAUDE.md #8).
- [ ] Security audit `security-red-team`: nicio breșă de tenant isolation pe noile endpoints.
- [ ] Docs: `docs/FEATURES.md` actualizat.

**Risk register Phase 0:**
- i18n: cache invalidation pe SW (PWA serve old strings). Mitigare: bust cache pe build hash.
- Multi-currency: float precision. Mitigare: `Decimal` din `decimal.js`, nu `number` în Prisma.

---

### Phase 1 — Engagement (4 săptămâni)

**Scop:** Sales people văd ce face prospect-ul după ce le trimit email.

| Feature | Effort | Sub-agenți alocați |
|---|---|---|
| **Email open/click tracking** | 7 zile | backend, frontend, security-red-team |
| **Drag-drop email campaign builder** | 14 zile | frontend (lead), backend, ux-designer |
| **Webhooks marketplace** (zapier-style) | 7 zile | backend, security-red-team, qa-automation |

**Acceptance criteria Phase 1:**
- [ ] Tracking pixel 1x1 cu HMAC signed token pe `{campaignId, recipientId}`, click via redirect `/r/<token>` ce loguiește înainte de 302.
- [ ] Privacy: opt-out per tenant (GDPR — Art. 6.1.f legitimate interest cu opt-out vizibil).
- [ ] Campaign builder: shadcn Form + JSON schema persistat, preview live, send test la 1 email înainte de batch.
- [ ] Webhooks: outbox pattern existent → endpoint configurabil per tenant, retry exponential, signature HMAC, dead letter queue, UI panel cu logs.
- [ ] **Security-red-team OK:** SSRF protection pe webhook URL (block private IPs), tracking pixel rate limit.

**Risk register Phase 1:**
- Tracking pixel = potențial GDPR issue. Mitigare: consent capture la opt-in, opt-out one-click în footer email.
- Webhook URL = SSRF vector. Mitigare: whitelist HTTPS + block 127.0.0.0/8 + 10.0.0.0/8 + 169.254.169.254 + 192.168.0.0/16.

---

### Phase 2 — Closing the deal (3 săptămâni)

**Scop:** End-to-end deal close în CRM, fără să sari pe DocuSign separat.

| Feature | Effort | Sub-agenți alocați |
|---|---|---|
| **E-sign pe contracts** | 7 zile | backend, frontend, security-red-team |
| **Approval workflows multi-step** | 7 zile | backend, frontend, qa-automation |
| **Polish + bug bash** | 7 zile | qa-manual, ux-designer, code-reviewer |

**Acceptance criteria Phase 2:**
- [ ] E-sign: PDF generat din contract template → ceremony URL trimisă semnatarului → callback verifică signature + stores audit trail.
  - **Decizie deschisă:** in-house (PDF + draw signature canvas + audit hash) vs DocuSign API (cost ~$0.10/envelope). În-house e $0 dar 5-7 zile extra. **Recommand in-house pentru MVP, integration DocuSign în Phase 3 dacă clients cer.**
- [ ] Approval: graph state machine `pending → approver1 → approver2 → approved/rejected`, audit trail pe fiecare step, notificare email + in-app.
- [ ] Tot Phase 0 + Phase 1 trecut prin `qa-manual` regression suite.

**Risk register Phase 2:**
- E-sign signature audit trail = legal requirement (eIDAS UE). Trebuie verificat de avocat dacă "drawn signature + hash" e SES valid. **Block:** consult avocat înainte de prod release.
- Approval workflow state machine = source of subtle bugs. Mitigare: property-based testing cu fast-check (există în deps?).

---

### Phase 3 — Automation power (4 săptămâni)

**Scop:** Non-tech users construiesc workflow-uri vizual fără cod.

| Feature | Effort | Sub-agenți alocați |
|---|---|---|
| **Visual workflow designer** (React Flow + existing workflows module) | 21 zile | frontend (lead), backend, ux-designer, qa-automation |
| **Workflow templates** (10 pre-built: lead nurture, deal stale, etc.) | 5 zile | backend, frontend |

**Acceptance criteria Phase 3:**
- [ ] React Flow canvas cu trigger nodes (deal created, email opened, time elapsed) + action nodes (send email, create task, update field, webhook) + condition nodes (if/else).
- [ ] Workflow validation: detect infinite loops, unreachable nodes, missing required fields.
- [ ] Workflow versioning: edit publishes new version, old runs continue cu vechea.
- [ ] Templates marketplace UI: 10 templates + "duplicate to my account".

**Risk register Phase 3:**
- Visual editor + multi-step backend = complexitate. Mitigare: hard scope-cap la 10 trigger types + 10 action types pentru v1.
- Infinite loop detection în engine. Mitigare: max 100 steps per workflow run + circuit breaker.

---

### Phase 4 — Mobile native (4 săptămâni)

**Scop:** Sales people pe drum își văd dealurile, log-uiesc apeluri, primesc push.

| Feature | Effort | Sub-agenți alocați |
|---|---|---|
| **React Native shell** (Expo SDK 52) | 14 zile | mobile-engineer (lead), backend |
| **Push notifications** (Expo Push) | 5 zile | mobile-engineer, backend |
| **Biometric login** (Face ID / fingerprint) | 3 zile | mobile-engineer, security-red-team |
| **Offline read-only mode** (cache critical data) | 6 zile | mobile-engineer |

**Acceptance criteria Phase 4:**
- [ ] App publishable pe TestFlight + Play Store internal track.
- [ ] Touches existing REST API — no parallel mobile-API.
- [ ] Biometric login uses existing passkey infrastructure (din B-batch B2).
- [ ] Offline: companies + contacts + deals (top 100) cached în SQLite, read-only fallback când offline.

**Risk register Phase 4:**
- App Store review = 1-3 săpt extra. Mitigare: submit cu 2 săpt înainte de planned launch.
- Apple developer account: $99/an cost real.

---

### Phase 5 — Tier 2 selective (6-12 luni, opțional)

Phase 5 nu e committed încă. Decizia se ia după ce Phase 0-4 sunt în prod și ai feedback real de la 5-10 clients plătitori.

**Candidates ranked by ROI (când reluăm planul în 2026-08):**

1. **Pipeline analytics** (cohort, funnel, conversion) — 2-3 luni. Mare valoare per sale, low integration risk.
2. **AI lead scoring** — 3 luni. Diferențiator real dacă ai 6+ luni date training. Folosește deal history existent.
3. **Forecasting avansat** (roll-up + linear regression baseline) — 2 luni.
4. **Customer portal** (Experience Cloud equivalent) — 3-4 luni. Doar dacă clients cer explicit.
5. **CPQ engine** — 4-6 luni. Skip până ai client B2B mare cu need real.

**Out of scope acum** (re-evaluate la v1.5):
- Marketing Cloud equivalent
- Field Service
- Customizable home pages per role
- Industry packs

---

### Tier 3 — Explicit OUT OF SCOPE

Documentat aici ca să nu fie scope creep accidental:

| Feature | De ce nu |
|---|---|
| AppExchange marketplace | Necesită ecosystem developer + revenue share + review board — nu solo |
| Apex/Lightning custom programming | Salesforce a construit 15+ ani — nu se replic |
| 100+ language localization | 100k+ traduceri × 4 update/an — bugetare imposibilă |
| SOC2 + ISO27001 + HIPAA + PCI-DSS toate | $50-200k anual + audit time — pick UNUL când ai revenue |
| 24/7 support cu SLA | Necesită echipă de 5-10 oameni |
| Industry clouds (Health, Financial, Gov) | Domain experts dedicați per vertical |

## 3. Dependencies graph (cine blochează pe cine)

```
Phase 0 ─┬─ i18n ──────────────┐
         ├─ Multi-currency ────┤
         └─ Saved views ───────┤
                               ▼
Phase 1 ─┬─ Email tracking ────────────┐
         ├─ Campaign builder ──────────┤
         └─ Webhooks ──────────────────┤
                                       ▼
Phase 2 ─┬─ E-sign ────────────────────────┐
         ├─ Approvals ─────────────────────┤
         └─ Polish/regression ─────────────┤
                                           ▼
Phase 3 ─── Visual workflow designer ──────┤
                                           ▼
Phase 4 ─── React Native shell ────────────┤
                                           ▼
Phase 5 ─── Tier 2 selective ──────────────►
```

**Critical dependencies cross-phase:**
- i18n (Phase 0) este blocker pentru orice email template (Phase 1) — campanii trebuie să suporte EN.
- Multi-currency (Phase 0) este blocker pentru e-sign contract amounts (Phase 2).
- Approvals (Phase 2) este blocker pentru workflow approval nodes (Phase 3).
- Webhooks (Phase 1) este blocker pentru workflow webhook action nodes (Phase 3).

## 4. Operating rhythm

**Per feature (3-7 zile cycle):**

1. **Plan** — main session propune ≤15 lines plan, user approves.
2. **Schema** — `database-architect` review migration, `backend-engineer` writes Prisma diff.
3. **Implementation parallel:**
   - `backend-engineer` → service + controller + spec
   - `frontend-engineer` → UI + form + integration test
   - `qa-automation` → e2e test scaffold
4. **Pre-merge gate:**
   - `code-reviewer` → diff review
   - `security-red-team` → if touches auth/billing/RLS/external integration
   - `qa-manual` → live smoke pe staging URL
5. **Merge** — direct la `main` (rule #15), CHANGELOG bumped, version slot claimed.
6. **Post-merge:**
   - `security-blue-team` → audit log shows expected events
   - Docs updated dacă API public schimbat
   - LESSONS.md updated dacă ceva surprize

**Per săptămână:**
- Luni: planificare fază curentă, review burndown.
- Vineri: retro scurtă (`/retro`), `/cso` daily audit, `pnpm audit` deps.

**Per fază (end of phase):**
- `security-red-team` comprehensive audit pe tot ce a fost shipped.
- `qa-manual` full regression pe golden paths.
- Decision: continue to next phase OR pause for stabilization.

## 5. Risk register (cross-phase)

| Risk | Likelihood | Impact | Mitigare |
|---|---|---|---|
| Solo dev burnout pe 4-luni-marathon | High | High | Phase gates obligatorii cu pause 1 săpt între faze |
| Multi-tenant regression la features noi | Medium | Critical | Sub-agent dedicat `security-red-team` audit pe fiecare PR sensitive |
| Scope creep ("cât ești la asta, fă și X") | High | Medium | Rule #6 CLAUDE.md, plus `code-reviewer` flag în PR |
| E-sign legal compliance UE | Medium | High | Avocat consult înainte de Phase 2 prod |
| App Store rejection | Medium | Medium | Submit early, în paralel cu Phase 4 dezvoltare |
| Cost cloud creep (multi-currency rates API, push, e-sign) | Low | Medium | Budget cap monthly în .env, alert la 80% |
| Database performance regression la i18n + multi-currency queries | Medium | Medium | `database-architect` query plan review pe orice query nou cu >2 joins |

## 6. Definition of Done (universal)

Un feature e "done" doar dacă:

- [ ] Migration SQL aplicată local + e idempotent
- [ ] Service + controller cu Zod input validation
- [ ] `*.spec.ts` cu ≥80% coverage pe service (rule #8)
- [ ] E2E test în `test/*.e2e.spec.ts` care hits real Postgres prin testcontainers
- [ ] UI integrated dacă feature e user-facing
- [ ] `pnpm lint && pnpm test` verde
- [ ] Curl smoke test paste-uit în PR description (rule #2)
- [ ] Security audit dacă feature atinge auth/billing/RLS/external
- [ ] `docs/FEATURES.md` updated dacă public API schimbat
- [ ] `CHANGELOG.md` entry
- [ ] `LESSONS.md` updated dacă surprize/bug
- [ ] Conventional commit message

## 7. Cum se urmărește progresul

- **Issue tracking:** GitHub issues per feature, labeled `phase-0`, `phase-1`, etc.
- **Milestone:** un GitHub milestone per fază.
- **Burndown:** un raport săptămânal `gh issue list --milestone "Phase X" --json state` agregat în CHANGELOG.
- **Health:** `/health` skill weekly pentru composite score.
- **Retro:** `/retro` weekly pentru pattern detection.

## 8. Re-evaluation gates

Plan-ul ăsta NU e bătut în cuie. Revizuim la:

- **End of Phase 0:** Decide dacă scope Phase 1 rămâne 3 features sau e doar 2 (cut dacă i18n a luat mai mult decât estimat).
- **End of Phase 2:** Decide dacă Phase 3 e Visual Workflow sau Mobile (în funcție de feedback clients).
- **End of Phase 4:** Phase 5 decision — pe ce Tier 2 feature plonjăm, sau focus on bug bash + GA launch.

## 9. Decizii pendinte (răspunsuri default dacă user nu specifică altfel)

Acestea NU blochează start — au default decisions care pot fi schimbate ulterior:

| Decizie | Default | Cost dacă schimbi mai târziu |
|---|---|---|
| **E-sign approach** (Phase 2) | In-house (PDF + drawn signature + audit hash) | Mediu — migration la DocuSign ~5 zile |
| **i18n EN scope** (Phase 0) | UI strings + email templates + system notifications | Mic dacă extinzi după ce-ai shipped UI |
| **Mobile platform** (Phase 4) | iOS + Android simultan via Expo EAS (cost același) | N/A |
| **Exchange rates source** (Phase 0) | ECB gratuit (RO, EUR, USD, GBP, CHF, PLN, etc.) | Trecere la Fixer $10/lună dacă e nevoie de exotice |
| **Apple Developer** | Cont individual $99/an la kickoff Phase 4 | N/A |
| **Expo EAS** | Free tier până la 30 builds/lună, apoi $29/lună | N/A |
| **A/B testing platform** | In-house (existing feature-flags + analytics) | Migration la PostHog/LaunchDarkly ~3 zile |

Dacă vrei override pe oricare, spune-mi înainte de respectiva fază.

## 10. Sprint 1 — acțiuni imediate (start direct)

**Săptămâna 1 — Phase 0 kickoff:**

Parallel batch (3-4 zile):
1. `security-architect` → STRIDE threat model pentru i18n + multi-currency + saved views (output: `docs/threat-models/phase-0.md`)
2. `product-manager` → acceptance criteria în Gherkin pentru toate 3 features (output: `docs/specs/phase-0.md`)
3. `database-architect` → review schema pentru 3 migrations (translation, exchange_rate, saved_view)
4. `backend-engineer` → migration files + service skeletons
5. `frontend-engineer` → language switcher component + currency display utilities
6. `i18n-localization` → extract toate stringurile RO din `apps/web/src` (grep + JSON catalog)
7. `qa-automation` → e2e test scaffolds (`test/i18n.e2e.spec.ts`, `test/multi-currency.e2e.spec.ts`, `test/saved-views.e2e.spec.ts`)

**Săptămâna 2 — Phase 0 build:**

Sequential pe fiecare feature, paralelizate features:
- i18n: backend + frontend implement, i18n-localization translates EN, qa-automation green
- Multi-currency: backend + database implement, qa-automation green
- Saved views: backend + frontend implement, qa-automation green

**Săptămâna 3 — Phase 0 review + ship:**

Parallel batch:
1. `security-red-team` → OWASP audit pe noile endpoints
2. `accessibility-auditor` → WCAG check pe language switcher + currency input
3. `ux-researcher` → heuristic eval pe "switch limbă → toate strings update fără refresh"
4. `qa-manual` → live smoke pe staging URL
5. `code-reviewer` → final diff review

Apoi:
- `main session` → push to main, bump CHANGELOG, bump VERSION
- `docs-writer` → update FEATURES.md, ARCHITECTURE.md
- `interactive-feedback` → instrument events (`locale_switched`, `currency_changed`, `view_saved`)
- `security-blue-team` → verify RLS pe noile tables, audit log drains

## 11. Cum dau drumul la execuție

User-ul rulează (după ce a citit planul ăsta):

```
Începe Phase 0 sprint 1 — execută toți pașii paralel batch.
```

Eu (main session) orchestrez toți cei 7 sub-agenți în paralel într-un singur message, monitorizez progresul, recap la final. Tu confirmi că fiecare check-point e OK înainte să avansăm la sprint următor.
