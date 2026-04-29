# Incident Response Runbook

**Per GDPR Art. 33-34: data breach notification to ANSPDCP within 72 hours; notification to data subjects without undue delay if high risk.**

**Per SOC 2 CC7.3: incident response procedures must be documented, tested, and improved.**

Last updated: 2026-04-29 · v1.0

---

## 1. Severity classification

| Level | Definition | Response time | Notification |
|---|---|---|---|
| **P0 — CRITICAL** | Active data breach, total outage, cross-tenant data leak confirmed | Immediate (within 15 min) | All hands; ANSPDCP within 72h; affected data subjects |
| **P1 — HIGH** | Single-tenant breach, partial outage >30 min, security control failure | Within 1 hour | On-call; CEO; affected tenant(s) |
| **P2 — MEDIUM** | Minor security finding, performance degradation, near-miss | Within business day | On-call |
| **P3 — LOW** | Cosmetic bug, documentation gap, observability gap | Backlog | Tracked in TODOS.md |

---

## 2. Detection sources

Incidents may be detected via:

1. **Sentry** — uncaught exceptions, error spikes (>10× baseline within 5 min)
2. **Prometheus + Grafana** — latency p95 > 1s, error rate > 1%, queue depth > 1000
3. **Audit log anomaly** — unusual cross-tenant access attempts, repeated 403s, mass DELETE
4. **External report** — customer email, security researcher (security@amass-crm.ro)
5. **Routine /cso scan** — finds during periodic security review
6. **SIEM webhook** — when forwarded to tenant's own SOC

---

## 3. Response procedure

### Phase 1: TRIAGE (target: <15 min for P0/P1)

1. **Acknowledge** the alert (suppress duplicate notifications)
2. **Classify** severity using the table above
3. **Open** an incident ticket: title format `[YYYY-MM-DD] PN — short description`
4. **Notify**:
   - P0: WhatsApp/SMS + email + phone call to founder + on-call
   - P1: Slack/email to on-call within 5 min
   - P2/P3: Email to backlog inbox
5. **Assemble responders**: minimum one engineer + one decision-maker

### Phase 2: CONTAIN (target: <1 hour for P0)

1. **Stop the bleeding** without destroying evidence:
   - For credential leak: revoke compromised tokens via `auth/revoke`
   - For active exfiltration: block source IP via Cloudflare WAF
   - For app-level vulnerability: deploy hotfix or feature-flag the affected code path off
   - For database compromise: rotate DB password, kill suspicious sessions
2. **Preserve evidence**:
   - Snapshot Postgres at point-in-time (Railway/Hetzner backup)
   - Export relevant audit_logs to a separate location
   - Capture Cloudflare WAF logs for the incident window
   - DO NOT delete anything — investigation needs the trail
3. **Document** every action taken with timestamp

### Phase 3: INVESTIGATE (target: ongoing, until root cause known)

1. **Scope assessment**:
   - Which tenants affected?
   - Which personal data fields exposed?
   - Time window of exposure?
   - Who/what accessed the data?
2. **Root cause analysis** using audit log + application logs:
   - What was the entry point?
   - What controls failed?
   - Why didn't earlier defenses catch it?
3. **Variant analysis**: are there other instances of the same vulnerability pattern?

### Phase 4: NOTIFY (regulatory + customer)

#### 4.1 If personal data WAS breached

**ANSPDCP notification (within 72h of awareness, per Art. 33):**

Submit form via https://www.dataprotection.ro/?page=Notificare_breach with:
- Nature of breach + categories + approximate number of data subjects + records concerned
- Likely consequences of the breach
- Measures taken or proposed to address it and mitigate adverse effects
- Name and contact details of the DPO or other contact point

**Affected data subjects (without undue delay if HIGH risk to rights, per Art. 34):**

Email template skeleton in Appendix A. Required content:
- Description of the nature of the breach
- Name and contact of DPO/contact point
- Likely consequences
- Measures taken/proposed to address it
- Recommendations for the data subject (e.g., reset password, monitor accounts)

**EXEMPTIONS to data subject notification (Art. 34(3)):**
- Encrypted data with intact key (key not compromised)
- Subsequent measures rendered breach unlikely to result in high risk
- Disproportionate effort: public communication acceptable instead

#### 4.2 If personal data was NOT breached (but incident still happened)

- Notify affected tenants via in-app banner + email if their service was disrupted
- Update status page (when public status page is built)

### Phase 5: RECOVER (full service restoration)

1. **Verify** the fix is deployed AND working in production
2. **Confirm** all defenses re-engaged
3. **Monitor** for 24-48h post-incident for re-occurrence or related anomalies
4. **Restore** any data lost from backups (with PITR if needed)
5. **Communicate** "all clear" to stakeholders

### Phase 6: LEARN (postmortem within 7 days)

Write a postmortem in `docs/postmortems/YYYY-MM-DD-<slug>.md` covering:

- **Timeline** (UTC, all key events)
- **Impact** (who, what, how long)
- **Root cause(s)** — technical + organizational (5-Why)
- **What went well**
- **What went poorly**
- **Action items** (owner + deadline) — SHIP these
- **Lessons** added to `LESSONS.md`

Postmortem must be **blameless** — focus on systems and processes, not individuals.

---

## 4. Specific scenarios with playbooks

### 4.1 Leaked secret in git history

1. **Revoke** the credential immediately at the issuing service (Stripe, AWS, etc.)
2. **Rotate** — generate a new credential
3. **Scrub git history** — `git filter-repo` or BFG Repo-Cleaner
4. **Force-push** the cleaned history (coordinate with all collaborators)
5. **Audit exposure**: when committed? When removed? Was repo public during that window?
6. **Check provider's logs** for any abuse of the leaked credential
7. **Rotate dependent secrets** if the leaked one was used to encrypt others

### 4.2 SQL injection (defense-in-depth failure)

1. Identify the injection point (usually Prisma `$queryRawUnsafe` — banned by CLAUDE.md rule #13)
2. Patch with parameterized query
3. Audit all `$queryRaw*` and `executeRaw*` usages for similar patterns (variant analysis)
4. Add lint rule blocking `$queryRawUnsafe` in pre-commit hook

### 4.3 Cross-tenant data exposure

This is THE worst-case scenario for AMASS-CRM. Defense in depth (3 layers) is designed to make this impossible.

1. **Immediately disable** the affected endpoint via feature flag if isolatable
2. **Determine** which layer failed:
   - Layer 1 (middleware): TenantContextMiddleware bypass?
   - Layer 2 (Prisma extension): missing `runWithTenant`?
   - Layer 3 (RLS): policy mistake or app_user grant escalation?
3. **Audit** all queries done in the affected window — list cross-tenant access in audit_logs
4. **Notify each affected tenant** within 24h (more aggressive than 72h regulatory minimum)
5. Consider **offering credit / extension** for trust restoration
6. **Write detailed postmortem** — this is reputational + legal critical

### 4.4 Compromised JWT signing key

1. **Rotate JWT_SECRET** immediately
2. All existing access tokens become invalid (will fail jwt.verify)
3. All users forced to re-login
4. Refresh tokens stay valid (separate cookie) — but next refresh will sign with new key
5. Monitor for repeated 401s spike — expected for ~30 min as caches expire

### 4.5 Webhook outbound abused for SSRF

Already mitigated: `webhooks.service.ts:135` re-validates URL via `validateUrl()` before each delivery (DNS rebinding defense). Residual TOCTOU window is microseconds — accepted risk.

If exploited despite this:
1. Disable webhook delivery globally (env: `WEBHOOKS_DISABLED=true` — TODO: implement)
2. Audit `webhookDeliveries.responseBody` for last 30 days for internal IPs / metadata service responses
3. Patch the gap (likely add IP pinning at fetch time)

---

## 5. Drills and testing

This runbook is **untested theater** unless we drill it.

### Quarterly drill

Pick one scenario at random. Run through it end-to-end with a colleague (or solo if no team yet). Time each phase. Find what's missing in the runbook. Update the runbook.

### Annual tabletop

External party (security consultant or trusted advisor) walks through 2-3 scenarios with the team. Record gaps. Add to runbook.

---

## Appendix A: Email template — data subject notification

```
Subject: Important security notice regarding your data

Dear [name],

On [date], we detected a security incident involving the AMASS-CRM service
that may have affected your personal data.

What happened:
[1-2 sentence factual description]

What data may have been involved:
[List exactly: name, email, phone, etc.]

What we have done:
[Concrete actions: contained the breach, rotated credentials, deployed fixes,
notified ANSPDCP]

What you should do:
[Specific recommendations: change your password, review recent activity, etc.]

We deeply regret this incident. If you have questions, please contact our
Data Protection Officer at privacy@amass-crm.ro.

Sincerely,
[Founder]
AMASS-CRM
```

## Appendix B: Contact list

| Role | Contact |
|---|---|
| Founder / CEO (incident commander) | Cristian Radu Oltean — cristian.raduoltean@gmail.com / +40 [phone] |
| ANSPDCP | https://www.dataprotection.ro · anspdcp@dataprotection.ro · +40 31 805 9211 |
| Hosting provider — Railway | https://railway.com/help · support@railway.com |
| External legal counsel | TBD — engage before Faza 2 launch |

---

## Appendix C: Postmortem template

```markdown
# Postmortem: <short title>

**Date of incident:** YYYY-MM-DD HH:MM UTC
**Date of postmortem:** YYYY-MM-DD
**Severity:** P0 / P1 / P2
**Authors:** <names>

## Summary

[2-3 sentence what happened, who was affected, total impact]

## Timeline (all UTC)

- HH:MM — [event]
- HH:MM — [event]

## Impact

- [Who was affected, how many, what data, duration]

## Root cause

[5-Why analysis: technical + organizational]

## What went well

- [Things to keep doing]

## What went poorly

- [Things to fix in process / tools]

## Action items

| Owner | Action | Deadline |
|---|---|---|
| | | |

## Lessons (added to LESSONS.md)

- [Specific learnings transferable to other situations]
```

