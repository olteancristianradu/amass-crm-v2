# Data Processing Agreement (DPA) — Template

**This is a template under GDPR Art. 28. Validate with a Romanian/EU data protection lawyer before signing with real customers.**

Last updated: 2026-04-29 · v1.0

---

## Parties

**Controller** ("Customer"): __________________
- Legal entity: __________________
- Registered office: __________________
- VAT/CUI: __________________
- Represented by: __________________

**Processor** ("AMASS-CRM"):
- Legal entity: AMASS-CRM (Cristian Radu Oltean PFA / SRL — TBD)
- Registered office: Romania
- VAT/CUI: __________________
- Represented by: Cristian Radu Oltean

This DPA is entered into in connection with the Master Services Agreement (the "MSA") between the parties dated __________________.

---

## 1. Subject matter and duration

The Processor shall process Personal Data on behalf of the Controller in connection with the SaaS CRM service provided under the MSA. This DPA remains in effect for the duration of the MSA and any agreed post-termination data return/deletion period.

## 2. Nature and purpose of processing

| Item | Specification |
|---|---|
| Subject matter | Provision of cloud-based CRM service with voice intelligence features |
| Duration | Term of the MSA |
| Nature | Hosting, storage, processing, transmission of Personal Data submitted by Controller via the CRM service |
| Purpose | Enabling Controller to manage customer relationships, sales, support |
| Type of personal data | Names, emails, phone numbers, job titles, addresses, call recordings, transcripts, notes, business communications |
| Categories of data subjects | Controller's contacts, clients, leads, employees, business partners |

## 3. Sub-processors

The Controller authorizes the use of sub-processors listed at https://amass-crm.ro/legal/subprocessors. The Processor shall provide at least 30 days' prior notice of any intended changes to sub-processors, allowing the Controller to object on reasonable grounds.

## 4. Processor's obligations (Art. 28(3))

The Processor shall:

(a) Process Personal Data only on documented instructions from the Controller, including transfers to third countries.

(b) Ensure persons authorized to process the Personal Data are bound by confidentiality obligations.

(c) Implement technical and organizational measures per Art. 32 GDPR (see Annex 2).

(d) Engage sub-processors only with prior general written authorization (per section 3) and impose the same data protection obligations.

(e) Assist the Controller in fulfilling data subject requests (Arts. 15-22).

(f) Assist the Controller in ensuring compliance with Arts. 32-36 GDPR (security, breach notification, DPIAs).

(g) At Controller's choice, delete or return all Personal Data after end of services and delete existing copies, unless EU/Member-State law requires retention.

(h) Make available to the Controller all information necessary to demonstrate compliance with Art. 28 and allow audits, including inspections (subject to confidentiality and reasonable scheduling).

## 5. International data transfers

For transfers of Personal Data outside the EEA, the parties incorporate the EU Standard Contractual Clauses (Implementing Decision (EU) 2021/914, Module Two: Controller to Processor) by reference. Specific sub-processors and transfer mechanisms are listed in section 3.

## 6. Personal data breach notification

The Processor shall notify the Controller without undue delay (and in any case within 48 hours) after becoming aware of a Personal Data breach affecting Controller's data. Notification shall include nature of the breach, categories and approximate number of data subjects and records concerned, likely consequences, and measures taken or proposed.

## 7. Liability and indemnification

Liability of each party is governed by the MSA, subject to any applicable data protection law mandates that override contractual limitations.

## 8. Audit rights

The Controller may request, no more than once per calendar year (unless required by a regulator or following a breach), an audit by a mutually agreed independent auditor under reasonable terms of access and confidentiality. Costs borne by the Controller unless the audit reveals material non-compliance.

## 9. Term and termination

This DPA terminates automatically upon termination of the MSA. Upon termination, the Processor shall, at the Controller's choice:

(a) Return all Personal Data to the Controller in a structured, commonly used, machine-readable format (JSON export available via the CRM); OR
(b) Securely delete all Personal Data within 30 days, and certify deletion in writing.

Backup copies will be retained for up to 90 additional days for disaster recovery purposes only and then deleted on a rolling basis.

## 10. Governing law

This DPA is governed by Romanian law and the GDPR (Regulation (EU) 2016/679). Disputes shall be resolved by the courts of Bucharest, Romania.

---

## Annex 1: Description of processing

(Filled in per customer engagement.)

## Annex 2: Technical and organizational measures (Art. 32)

The Processor implements the following measures:

### Encryption
- TLS 1.3 for all data in transit
- AES-256-GCM at rest for sensitive secrets (TOTP seeds, OAuth tokens, SMTP passwords)
- Disk-level encryption on hosting infrastructure

### Access control
- Role-based access control (RBAC) with 5-tier roles: OWNER / ADMIN / MANAGER / AGENT / VIEWER
- Cedar policy engine for fine-grained authorization
- Two-factor authentication (TOTP) available for all accounts
- Tenant isolation enforced at 3 layers: middleware, ORM, database (Postgres Row-Level Security)

### Audit and accountability
- Append-only audit logs for all administrative and security-relevant actions
- Logs retained 365 days minimum (configurable per tenant)
- Real-time alerting for suspicious activity

### Resilience
- Daily encrypted backups with off-site replication
- RPO ≤ 24 hours, RTO ≤ 4 hours target
- Multi-region failover capability (when subscribed to Enterprise tier)

### Personnel
- Background checks for employees with production access
- Mandatory security awareness training annually
- Confidentiality obligations in employment contracts

### Vendor management
- Sub-processor security review prior to engagement
- Annual review of sub-processor security posture

---

**Signed:**

Controller:                                           Processor:

________________________                              ________________________

Name:                                                 Name: Cristian Radu Oltean
Title:                                                Title: Founder, AMASS-CRM
Date:                                                 Date:
