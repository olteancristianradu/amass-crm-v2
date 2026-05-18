# Phase 2 — Review Findings (Consolidated)

> **Date:** 2026-05-18 · **Last review commit:** `5d91c0d`
> **Reviewers:** `code-reviewer` (BLOCK_MERGE), `security-red-team` (CRITICAL), `accessibility-auditor` (PRE_SPEC_ONLY)
> **Total:** 5 CRITICAL + 7 BLOCKER + 18 HIGH/IMPORTANT + 13 MEDIUM + 5 LOW + nits

## Consolidated cross-review overlaps

| Finding | code-reviewer | security-red-team | Severity (max) |
|---|---|---|---|
| Audit chain cross-tx race | B-4, B-5 | CRIT-5 | CRITICAL |
| Multi-step notification gap | B-2 | HIGH-3 | BLOCKER |
| Role-based approver privilege escalation | (none) | CRIT-4 | CRITICAL |

## CRITICAL (security-red-team) — block CONTRACT_ESIGN_ENABLED flip

- **CRIT-1**: `pdf-generator.service.ts:153` + `ceremony.service.ts:158` + `signing.service.ts:226-243` — signed PDF artifact is the DRAFT-watermarked preview. No re-render with `isFinal=true` after completion. No embedded signature images. No distinct `signed/<ceremonyId>.pdf` key. Legal evidentiary value broken.
- **CRIT-2**: `ceremony.service.ts` no OTP collection, no SMS/email verification of signer identity. Ceremony URL alone authenticates the signer → BEC/mail-forward attacker can sign as legitimate signer.
- **CRIT-3**: `contracts.service.ts:76-95` `update()` accepts arbitrary `status`/`signedAt`/`storageKey`/`pdfHash` PATCH from MANAGER/ADMIN/OWNER. ACTIVE contract can be rewritten to DRAFT post-signing.
- **CRIT-4**: `approvals.service.ts:405-410` — `if (currentStep.approverId && currentStep.approverId !== userId)` skips role check when `approverId` is null. Any MANAGER can decide an OWNER-role step.
- **CRIT-5**: `audit-chain.service.ts:63-100` — `findFirst` then `create` without per-contract lock. Concurrent appends produce same `prevEntryHash` → chain fork → tamper-evidence broken.

## BLOCKERS (code-reviewer) — functional defects

- **B-1**: `applySubjectSideEffects` lacks CONTRACT handler — every `sendForSignature` retry creates a new approval request → infinite 409 loop.
- **B-2**: `decide()` activates `nextStep.status='ACTIVE'` in-tx, `advanceUntilHumanStep` early-returns on ACTIVE → next approver never notified.
- **B-3**: Self-approval skip only handles PENDING; ACTIVE step with requester as approver stalls chain forever.
- **B-4 + B-5**: see CRIT-5 above.
- **B-6**: `.env.example` missing all 6 new Phase 2 vars (`CONTRACT_ESIGN_ENABLED`, `ESIGN_LEGAL_APPROVED`, `CONTRACT_HMAC_KEY`, `CONTRACT_REMINDER_OFFSETS_DAYS`, `CONTRACT_CEREMONY_BASE_URL`, `DATABASE_URL_WORKER`).
- **B-7**: `CHANGELOG.md` `[Unreleased]` empty — no Phase 2 entry.

## HIGH (security-red-team)

- **HIGH-1**: `view()` does not check signer status → signed PDF re-mintable via `presignGet` indefinitely. GDPR Art. 5(1)(c).
- **HIGH-2**: `loadSignerByToken` raw prisma read = single failure mode (HMAC verify regression). Need integration test pinning behaviour.
- **HIGH-3**: Role-based step + zero matching users → silent stall (no notification, no fail-closed). Combined with CRIT-4 = exploit.
- **HIGH-4**: MinIO no WORM. Operator with creds can rewrite signed PDF bytes; only sign-time hash check, no nightly verifier.
- **HIGH-5**: `ceremony.service.ts:481-484` logs `email=$EMAIL url=...token...` at INFO. GDPR Art. 5(1)(f) + leaks first 12/64 of token.
- **HIGH-6**: `UpdateContractSchema` accepts `storageKey` → PATCH can re-point post-signing PDF to attacker MinIO key.

## IMPORTANT (code-reviewer)

- **I-1**: Misleading "subtract 1" comment in `signing.service.ts:209-210`.
- **I-2**: Path divergence — comment says "/p/sign exempt from CSRF" but actual mount is `/api/v1/p/sign` due to global prefix.
- **I-3**: `withdraw()` lacks SELECT FOR UPDATE; duplicate decisions on parallel browser tabs.
- **I-4**: `view()` first-view race in PARALLEL mode (duplicate VIEWED event).
- **I-5**: `TEMPLATE_IN_USE` check TOCTOU (count + update in separate tx).
- **I-6**: Reminder cron `offsetIdx` out-of-bounds if `CONTRACT_REMINDER_OFFSETS_DAYS` shrinks between runs.
- **I-7**: Co-signer-declined UX: signer's PNG accepted, then 409 with no clear "ceremony voided" message.
- **I-8**: Docstring references WITHDRAWN status that doesn't exist in enum (CANCELLED is what migration shipped).
- **I-9**: Notification cooldown query may not use JSONB GIN index — seq scan at 100k+ rows.
- **I-10**: Cron schedulers fire in every app replica — Redis roundtrip on every instance.
- **I-12**: Mixed `$queryRaw` template literal vs `$queryRawUnsafe` style — rule #13 prefers template.

## MEDIUM (security-red-team)

- **MED-1**: Approval gate becomes deadlock once APPROVED request exists for subject (no positive cache).
- **MED-2**: `approval_decisions` no UPDATE/DELETE trigger guard — only `contract_audit_entries` is append-only at DB.
- **MED-3**: `contract_signature_events` GRANT UPDATE/DELETE to app_user; documented as append-only.
- **MED-4**: `notifyInitialSigners` does NOT send email (only writes DB events) — flag-flip without email config = unsignable contracts.
- **MED-5**: `ceremony_token` stored plaintext VARCHAR(64); threat model required SHA-256 hash. Pattern departure (PasswordReset/InviteToken/EmailVerification all hash).
- **MED-6**: `current_step_id` FK uses `ON DELETE SET NULL` — silent detachment if step deleted.
- **MED-7**: ~~withdrawn~~
- **MED-8**: `signing_mode` VARCHAR+CHECK instead of Prisma enum → future mode-add silently treated as PARALLEL.

## LOW (security-red-team)

- **LOW-1**: 96-bit HMAC tail below 128-bit best-practice (bump to 32 hex).
- **LOW-2**: `assertPng` accepts magic+IHDR only (no IDAT/IEND validation).
- **LOW-3**: `audit-chain.service.ts:75` uses `new Date()` outside tx — ms-clock-skew ordering issue.
- **LOW-4**: DECLINED reason truncated to 256 in audit-chain but column allows 2048.
- **LOW-5**: 5/min/IP throttle on `/decline` insufficient — distributed attacker (1k IPs) can void a contract.

## Coverage gaps (code-reviewer §6)

- `ceremony.service.ts` 517 LoC — NO spec (above 200 LoC threshold per CLAUDE.md #8)
- `contract-sweeper.service.ts` 297 LoC — NO spec
- `approvals.state-machine.spec.ts` 205 LoC — tests a LOCAL reference machine, NOT the real service → doesn't catch B-2/B-3

## CLAUDE.md compliance (code-reviewer §5)

- Rule #2 (no done without proof): **FAIL** — CHANGELOG entry missing (B-7)
- Rule #8 (coverage ≥80% on security-critical): **PARTIAL FAIL** — 2 services ≥200 LoC without spec
- All other rules PASS

## CVE check (security-red-team §CVE)

- Phase 2 deps clean (pdfkit, fontkit, png-js — no advisories)
- Pre-existing moderate: `brace-expansion@5.0.5` (GHSA-jxxr-4gwj-5jf2), `ws@8.18.3` (GHSA-58qx-3vcg-4xpx) — not Phase 2 regressions

## A11y pre-spec (separate doc)

See [`phase-2-a11y-pre-spec.md`](./phase-2-a11y-pre-spec.md). Phase 2 backend-only, FE work pending (~18 story points across 4 UI surfaces).
