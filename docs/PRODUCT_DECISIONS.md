# Product decisions — recommended defaults

This file records the product/business decisions for AMASS CRM that an agent can act on without asking. Override any of them by editing this file and the agent will pick up the new default at the start of the next session.

Last reviewed: 2026-05-06

---

## Pricing tier

**Default**: First user free up to 100 entities (companies + contacts + clients, summed). Beyond that, **$15/user/month** billed monthly via Stripe (annual discount: 20%).

**Why**: 100-entity threshold is generous enough to evaluate without paying, restrictive enough that any real SMB hits it within a month. $15 is half of HubSpot Starter, undercuts Pipedrive Essential ($14) by feature parity, lands well above Folk and Attio.

**Tier matrix** (when we activate):

| Tier | Monthly per user | Entity cap | Storage | Calls | AI |
|---|---:|---:|---:|---:|---|
| Starter | $15 | 1000 | 1GB | 100 min | Gemini free tier |
| Growth | $39 | 10000 | 10GB | 500 min | Gemini + Claude fallback |
| Enterprise | quote | unlimited | unlimited | metered | Claude prio + custom models |

---

## Distribution model

**Default**: Open source AGPL-3.0 + hosted SaaS.

- **Self-hosted** (free): clone repo, run `docker compose up`, no support, no SLA.
- **Hosted SaaS** (paid): we run it on Hetzner Cloud (Frankfurt + Bucharest), automatic backups, support email, 99.5% SLA.
- **Commercial dual licensing** (custom): for SaaS competitors who want to fork without AGPL obligations. Email for quote.

**Why**: AGPL keeps competitors honest. Hosted is the revenue path. Self-hosted brings stars/credibility/users we can convert.

---

## Target geographic order

1. **Romania** (months 0-6) — UI românească by default, English fallback. ANAF e-Factura native is the wedge nobody else has.
2. **EU SMB** (months 6-18) — UK, DE, FR, IT, NL, ES, PL. GDPR-ready out of the box, multi-currency, EU VAT.
3. **Global English-speaking** (months 18+) — only after EU stabilizes.

**Don't go US.** Salesforce + HubSpot dominate, marketing cost prohibitive, no compliance edge.

---

## Target verticals (first 100 customers)

In order of fit:

1. **Servicii IT / agenții software** — they understand the value, easy to sell, give good feedback
2. **Agenții marketing & PR** — multi-client management, lots of comms, importer fits well
3. **Comerț online (eMag/Shopify shops)** — clear ROI from CRM + ANAF integration

**Don't target** (yet): healthcare (regulated), banking (regulated), retail chains (need POS), real estate (different workflow).

---

## Beta strategy

**Default**: Open beta. Anyone can sign up. Free during beta (no Stripe gate). Collect feedback aggressively, fix what hurts.

**Beta exit criteria**: 100 daily active users OR 10 paying customers (whichever first), then close to invite-only for 30 days while we polish, then re-open with the paid tier.

**Why open**: closed beta wastes time gatekeeping. Romanian SMB CRM market is small enough that we'll find the right users by being open.

---

## Open source contributor strategy

- Label easy issues `good first issue` — assign me 5/week to maintain.
- Respond to issues/PRs within **48 hours** (weekday) or **96 hours** (weekend).
- For drive-by PRs: merge if quality, ignore if low-quality. Don't engage flame wars.
- Sponsor button on the repo (Stripe Connect or GitHub Sponsors) for individual donors.

---

## Monetization order

1. Self-serve subscriptions (Stripe Checkout) — first revenue stream, low touch
2. Annual contracts for >10 user accounts — direct outreach, sales call required
3. Custom dual licensing for SaaS forks — high margin, manual quote
4. Professional services (data migration, integrations) — only if asked, don't push

**Not doing**:
- Ads inside the product
- "Lead gen" sales of customer data
- Affiliate programs that compromise UX

---

## Support SLA

- **Free / self-hosted**: best-effort, GitHub issues only
- **Starter**: 48h email response (business days)
- **Growth**: 24h email + chat (business days)
- **Enterprise**: 4h business hours, 24h after-hours, dedicated Slack channel

---

## Acceptance criteria for "v1 launch"

We can call ourselves "v1" when:

- [ ] 100% of P0 in `UNFINISHED.md` is closed
- [ ] At least 3 paying customers
- [ ] 99.5% uptime over rolling 30 days
- [ ] CI green for ≥30 consecutive pushes
- [ ] At least 200 GitHub stars
- [ ] Romanian Twitter/LinkedIn presence with content cadence

If we hit those, we go from "alpha" to "v1.0" + announce on HN, ProductHunt, Reddit, Romanian dev communities.
