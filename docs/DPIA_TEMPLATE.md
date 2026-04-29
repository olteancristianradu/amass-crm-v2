# Data Protection Impact Assessment (DPIA) — Template

**Per GDPR Art. 35 — required when processing is "likely to result in high risk to the rights and freedoms of natural persons", in particular when using new technologies, large-scale processing, or systematic monitoring.**

**This is a working template. Each tenant deploying AMASS-CRM should adapt it to their specific use case before signing the DPA. Review with legal counsel for binding commitments.**

Last updated: 2026-04-29 · v1.0

---

## 1. Why a DPIA is needed for AMASS-CRM

The Romanian Supervisory Authority (ANSPDCP) and Article 29 Working Party guidance identify several criteria that trigger DPIA. AMASS-CRM hits multiple:

| Criterion | AMASS-CRM relevance |
|---|---|
| Profiling / automated decision-making | YES — AI lead scoring, AI brief, deal probability inference |
| Systematic monitoring | YES — call recording + transcription + email tracking pixels |
| Large-scale processing | Depending on tenant size; default DPIA recommended for >1000 contacts |
| Sensitive data processing | YES — voice content (special category under some interpretations) |
| Innovative use of technology | YES — LLM processing of customer-facing content |

**Conclusion:** Every tenant SHOULD complete this DPIA before activating call-recording or AI-profiling features.

---

## 2. Description of processing

### 2.1 Nature, scope, context, and purposes

| Item | Specification |
|---|---|
| **Controller** | The customer organization deploying AMASS-CRM |
| **Processor** | AMASS-CRM (SaaS provider) |
| **Sub-processors** | See https://amass-crm.ro/legal/subprocessors |
| **Personal data categories** | Names, emails, phones, job titles, addresses, business communications, call recordings, call transcripts, AI-generated summaries, IP addresses, user agents |
| **Special categories** | Voice biometrics (in raw recordings); content of conversations may inadvertently include health/political/religious info if discussed |
| **Data subjects** | Customer's contacts (B2B + B2C), leads, employees, business partners |
| **Recipients** | Internal users (RBAC roles); sub-processors per documented list |
| **Retention** | Configurable per tenant; defaults: contacts (life of contract + 1y), recordings (90 days), audit logs (365 days), invoices (10 years per RO Fiscal Code) |
| **Geographic scope** | Primary: EU (Romania, broader EU). Secondary: USA (sub-processors for AI services) |

### 2.2 Processing operations

1. **Storage** of customer data (companies, contacts, deals, communications)
2. **Inference** — AI processing of communications:
   - Voice → text (Whisper / whisperX)
   - PII redaction (Presidio, optional)
   - Summary generation (Claude API)
   - Email draft generation (Claude / Gemini API)
   - Lead scoring (LLM-based or rule-based)
3. **Transmission** to sub-processors (encrypted in transit, contracted via SCC where applicable)
4. **Access** by authorized personnel based on RBAC

---

## 3. Necessity and proportionality

### 3.1 Lawful basis (GDPR Art. 6)

| Operation | Lawful basis | Notes |
|---|---|---|
| Customer relationship data storage | Art. 6(1)(b) — contract performance | Required to deliver CRM service |
| Audit logs | Art. 6(1)(c) — legal obligation + Art. 6(1)(f) — legitimate interest | Security + compliance |
| Marketing email/SMS/WhatsApp | Art. 6(1)(a) — consent | Recorded in consent_records |
| Call recording | Art. 6(1)(a) — consent | Two-party consent jurisdictions: BOTH parties must consent |
| Call transcription + AI summary | Art. 6(1)(a) — consent | Granular: CALL_TRANSCRIPTION purpose |
| AI lead scoring / profiling | Art. 6(1)(a) — consent | AI_PROFILING + AI_LEAD_SCORING purposes |

### 3.2 Necessity test

- **Storage:** essential for service. Could not be replaced.
- **AI processing:** opt-in. Tenants who decline AI features get a fully functional CRM without it.
- **Audit logs:** essential for security incident response and regulatory compliance.
- **Marketing:** opt-in only.

### 3.3 Proportionality

- Voice recordings: 90-day default retention is short relative to call-center industry norms (often 1-3 years). Configurable up if business needs justify.
- AI processing: data sent to sub-processors (Anthropic, Google, OpenAI) under SCC; PII redaction available.

---

## 4. Risk assessment

### 4.1 Risks to data subjects

| # | Risk | Likelihood | Severity | Score |
|---|---|---|---|---|
| R1 | Cross-tenant data leak (multi-tenant isolation failure) | Low | Critical | High |
| R2 | Sub-processor breach exposes EU data to US authorities | Medium | High | High |
| R3 | AI sub-processor (Anthropic/Google) re-uses content for model training | Medium | Medium | Medium |
| R4 | Call recording captures sensitive personal info beyond customer expectations | Medium | High | High |
| R5 | Email open/click tracking enables behavioral profiling without consent | Medium | Low-Medium | Medium |
| R6 | Audit log forwarding to SIEM exposes to operator | Low | Medium | Low |
| R7 | Backup/restore exposes plaintext data during transit | Low | High | Medium |
| R8 | PII leaks via verbose error logs | Low | Medium | Low |
| R9 | Stale credentials (revoked employee) retain access | Low | High | Medium |
| R10 | LLM prompt injection via customer-supplied content alters AI behavior | Low | Low | Low |

### 4.2 Mitigations in place

| Risk | Mitigation |
|---|---|
| R1 (cross-tenant leak) | Defense in depth: ALS middleware + Prisma extension auto-injects tenantId + Postgres RLS forced + tenant_isolation policy on every table. Verified by /cso security audit. |
| R2 (sub-processor breach) | Standard Contractual Clauses (SCC 2021/914) with all US sub-processors. Encryption in transit + at rest. |
| R3 (AI training reuse) | Anthropic and Google API ToS explicitly disclaim training on API customer content. Reviewed annually. |
| R4 (call recording sensitive content) | Granular consent (CALL_RECORDING + CALL_TRANSCRIPTION separate). Presidio PII redaction optional. 90-day default retention. |
| R5 (tracking pixels) | Honest disclosure in privacy policy. Strict-by-default no marketing tracking; only essential cookies without consent. |
| R6 (SIEM forward) | Per-tenant SIEM URL config (siemWebhookUrl); falls back to global only with explicit env config. |
| R7 (backup exposure) | Encrypted backups with separate KMS-managed key. Network transit over TLS. |
| R8 (PII in logs) | Structured logging (Pino) with field-level redaction for known sensitive fields. |
| R9 (stale credentials) | JWT 15-min access + refresh rotation + revocation jti table. SSO (when enabled) provides immediate revocation via IdP. |
| R10 (prompt injection) | System prompt is static const; user content enters in user-message position only. Per OWASP LLM Top 10 / FP rule #13: not exploitable injection. |

### 4.3 Residual risk

After mitigations, residual risk for each item is **LOW** to **MEDIUM-LOW**. The most material residual risk is **R4** (call recording sensitive content) which depends on tenant operational discipline (e.g., training salespeople not to ask about health/religion).

---

## 5. Recommendations and approval

### 5.1 Mandatory before processing starts

- [ ] DPA signed between Controller and AMASS-CRM
- [ ] Per-tenant retention policy reviewed and configured
- [ ] Privacy notice updated to mention AI processing if used
- [ ] Sub-processor consent obtained (or relied on prior general authorization in DPA)
- [ ] Data Subject Request workflow assigned to a named person at the Controller

### 5.2 Recommended

- [ ] Quarterly review of sub-processor list
- [ ] Annual re-execution of this DPIA if processing changes materially
- [ ] DPO appointment if Controller exceeds Art. 37 thresholds (large-scale monitoring or special-category data)
- [ ] Staff training on what NOT to record/transcribe (sensitive personal info)
- [ ] Incident response drill at least once per year

### 5.3 Approval signatures

This DPIA was reviewed and approved by:

**Controller:**

DPO / Privacy Officer: __________________

Date: __________________

**Processor (AMASS-CRM):**

Name: __________________

Date: __________________

---

## Appendix A: Sub-processor risk assessment

| Sub-processor | Service | Location | Risk profile | Mitigation |
|---|---|---|---|---|
| Anthropic | LLM API | USA | Medium (US jurisdiction) | SCC; no training on API content per ToS |
| Google (Gemini) | LLM API | USA | Medium | SCC; no training on API content per ToS |
| OpenAI | Embeddings | USA | Low (no PII content, just text vectors) | SCC |
| Twilio | Voice/SMS | USA + EU | Medium | SCC; data minimization (only what's needed) |
| Stripe | Payment | USA + IE | Low (PCI scope handled by Stripe) | SCC; no card numbers stored by AMASS |
| Cloudflare | CDN/DNS | Global | Low | EU edge preferred; no application content cached |
| Railway | Hosting | EU (Frankfurt) | Low | EU-only data residency |

## Appendix B: Periodic review log

| Date | Reviewer | Changes |
|---|---|---|
| 2026-04-29 | Initial draft | First version |

