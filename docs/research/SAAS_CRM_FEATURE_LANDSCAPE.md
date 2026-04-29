# SaaS CRM Feature Landscape 2026

Research conducted: April 2026
Audience: Romanian / EU SMB and mid-market (5-500 employees)
Author: Internal market research for Amass CRM

---

## Executive summary

The 2026 SaaS CRM market has bifurcated more sharply than ever between three layers:
**(1)** global all-in-one suites (Salesforce, HubSpot, Microsoft Dynamics 365), **(2)** sales-first
SMB tools (Pipedrive, Freshsales, Monday.com CRM, Zoho CRM, Bitrix24), and **(3)** local/regional
incumbents (SmartBill, MEFI, MiniCRM, SoftManager, Charisma). The price spread is enormous: a
3-seat SMB can pay anywhere from €0 (HubSpot Free, Bitrix24 Free, Zoho Free) to ~€300/mo
(Salesforce Pro Suite + Agentforce credits) for what is functionally the same pipeline.

**Common baseline (table stakes everywhere in 2026):** pipeline kanban, contact and company
records, email sync, basic activity logging, mobile app, REST API, custom fields, role-based
access, and at least one form of native automation builder. None of these are differentiators
anymore — they are check-the-box requirements.

**Where segmentation actually happens:** (a) AI agents (autonomous SDR-style agents that draft
emails, qualify leads, and update records) are now standard at the Pro/Enterprise tier of every
global CRM, but quality and trustworthiness varies wildly; (b) native call recording +
transcription is shipped by Bitrix24, Zoho (via Zoho Voice), Salesforce (Einstein Conversation
Insights), HubSpot (Call Intelligence), and Dynamics 365 (Copilot for Sales) — but Pipedrive,
Freshsales, Monday, and most RO-local CRMs require third-party VoIP add-ons for this; (c) deep
workflow automation, sandbox environments, custom modules, and SAML SSO are still gated behind
the Enterprise tier of every player.

**Romanian-market reality:** No global CRM has native e-Factura ANAF integration. Romania's
mandatory B2B/B2C e-invoicing regime (XML UBL 2.1, 5-working-day SPV submission deadline as of
2026-01-01) is solved either by local CRMs (MiniCRM, MEFI, SoftManager, CRMconnect, Zarina,
CRM AMC) that ship it natively, by SmartBill plus a CRM connector, or by a Premium Partner
custom build (Svennis for Zoho, similar for Salesforce/HubSpot). Romanian-language UI is
patchy: Zoho, MiniCRM, Bitrix24 (via partner), MEFI, SoftManager, and Charisma have it.
Salesforce and HubSpot are English/EN-EU only by default.

**Trends that matter for 2026 product positioning:** (1) AI is moving from "copilot suggestion"
to "autonomous agent that writes to the CRM during the call" — Salesforce Agentforce, HubSpot
Breeze Agents (Customer/Prospecting/Data), Monday's AI Sales Agent that calls/texts leads,
Zoho Zia generative AI; (2) Voice intelligence is the new battleground — Gong-style call
analytics is now table stakes for mid-market CRMs; (3) WhatsApp Business is becoming the
dominant channel in EE/RO/SE Europe for B2C sales but only Bitrix24, HubSpot Marketing Hub
($800+), and Salesforce ship it natively; (4) AI usage is metered (HubSpot AI credits,
Dynamics Copilot Credits, Monday AI credits) — buyers must now budget for AI consumption on
top of seat licensing.

**Romanian SMB gap that no global player solves:** end-to-end Romanian voice (call recording
+ Romanian-language transcription + RO-tuned AI summary) tied to a CRM that also handles
e-Factura ANAF, e-Transport, RO VAT registry lookups (`anaf.ro/PlatitorTvaRest`), Fan Courier
/ Cargus / GLS shipping, and SAGA/Winmentor accounting export. SoftManager and MEFI cover
parts of this stack, but neither has competitive AI/voice intelligence.

---

## Per-CRM matrix

| CRM | Entry price (annual) | AI native (2026)? | Voice/call native? | RO market presence | Top 3 marketing-claimed features |
|---|---|---|---|---|---|
| **Salesforce Sales Cloud** | $25/seat/mo (Starter Suite) → $100/seat (Pro Suite) | Yes — Einstein + Agentforce SDR/Service agents | Yes — Einstein Conversation Insights (via Zoom/Teams/Meet) | Strong enterprise; weak SMB; no native e-Factura | "AI-first CRM"; Agentforce autonomous agents; AppExchange ecosystem (7,000+ apps) |
| **HubSpot Sales Hub** | $0 Free (5 seats) → $15 Starter → $100 Pro (+ $1,500 onboarding) | Yes — Breeze Assistant + 3 GA Breeze Agents (Customer, Prospecting, Data) | Yes — Call Intelligence with summaries (paid tiers) | Growing via partners; English UI only; no native e-Factura | "All-in-one platform"; Breeze AI; free-forever CRM |
| **Pipedrive** | $14/seat/mo (Essential) → $69/seat (Power) | Partial — AI Sales Assistant + Pipedrive Pulse, generative email | No — VoIP add-on or 3rd-party (Aircall, CloudTalk, Allo) | Modest; English UI; no native e-Factura | "Sales-first pipeline"; visual deal stages; AI Sales Assistant |
| **Zoho CRM** | $14/seat/mo (Standard) → $40/seat (Enterprise) | Yes — Zia AI (Enterprise+) for prediction, anomaly detection, generative | Yes — via Zoho Voice + PhoneBridge (50+ integrations); transcription EN/ES/DE/FR/IT/NL/RU | RO language UI yes; Premium Partner Svennis builds RO e-Factura via SmartBill + Factureaza.ro | Affordability; Zia AI; full Zoho One ecosystem |
| **Microsoft Dynamics 365 Sales** | ~$65/seat/mo (Sales Pro) → $135 (Sales Enterprise) + Copilot Credits | Yes — Copilot for Sales + agentic workflows ("Work IQ") | Yes — Teams-native conversation intelligence + collaborative deal rooms | Via partners (TotalSoft Charisma is RO Microsoft Gold); no native e-Factura | Copilot AI agents; deep M365 + Power Platform integration; enterprise scale |
| **Monday.com CRM** | $12/seat (Basic, 3-seat min) → $28 (Pro); 33% annual discount | Yes — AI Sidekick + AI Sales Agent (calls/SMS leads autonomously) | Partial — AI Sales Agent makes calls; no general native call recording | Modest; English UI; no native e-Factura | Visual workspace; AI Sales Agent; no-code customization |
| **Freshsales** | $0 Free (3 users) → $9 Growth → $39 Pro → $59 Enterprise | Yes — Freddy AI (lead scoring, generative email, auto-enrichment) | Built-in phone (Freshcaller) with recording; transcription on higher tiers | Modest in RO; English UI; no native e-Factura | Freddy AI; built-in phone; affordable AI tier |
| **Bitrix24** | $0 Free (unlimited users) → $49 Basic → $199 Pro (flat per org, not per seat) | Yes — CoPilot for CRM (call audio→text), tasks, chat, video | Yes — built-in telephony, call recording, AI transcription (Pro+) | Yes via TDACRM partner; Romanian UI not in default list but available; no native e-Factura | Free unlimited users; flat pricing; all-in-one (CRM+ERP+collab) |
| **SmartBill** (CRM-adjacent) | RON-based, billing-first | No (not a CRM) | No | Dominant — 165,000+ RO users; native e-Factura with 99.99% validation rate | Native ANAF e-Factura/e-Transport; auto-import partner data; 1-click submission |
| **MEFI CRM** | Per-user + per-module (online calculator); ~15% annual discount | Limited — automation + alerts; no GenAI agents | No native call recording | Yes — Romanian; 18 modules including ERP/BI/PM | All-in-one (CRM+ERP+BI+PM); 18 modules; transparent online price calculator |
| **MiniCRM (RO)** | €15/user/mo (Go) → €24 (Go BIG) → €45 (Pro) | Limited — automation/sequences; no AI agents | No native | Yes — Romanian UI; ANAF + SmartBill integration | Sales workflow + invoicing; web form sync; Romanian SMB focus |
| **SoftManager CRM** | €14/user/mo (Start) → €22 (Enterprise) | No GenAI; CRM Analytics module on Enterprise | No native call recording | Yes — Romanian; native e-Factura on Professional+ | E-Factura native; Fan Courier/Cargus/GLS/WhatsApp integrations; SAGA accounting |
| **Charisma (TotalSoft)** | Enterprise quote-only | Not advertised; Microsoft Dynamics-based AI available | Via Microsoft Dynamics integrations | Yes — Romanian; the largest RO ERP/CRM vendor (TotalSoft) | Full ERP+CRM+HCM suite; built on Microsoft Dynamics; Romanian Microsoft Gold Partner |

Notes: All prices are list price, billed annually unless noted. Prices verified April 2026 against vendor pricing pages and recent third-party pricing analyses.

---

## Feature × CRM matrix

Legend: ✓ = native, included in stated entry/Pro tier · △ = partial / paid add-on / 3rd-party · ✗ = not available · ? = unverified

| Feature | Salesforce | HubSpot | Pipedrive | Zoho | D365 Sales | Monday CRM | Freshsales | Bitrix24 | SmartBill | MEFI | MiniCRM | SoftManager | Charisma |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Pipeline kanban | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Email tracking & open notifications | ✓ Pro | ✓ | △ Adv+ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | △ | ? |
| Email sequences / drip | ✓ Pro | ✓ Pro | ✓ Adv+ | ✓ | ✓ | ✓ Pro | ✓ Pro | △ Pro+ | ✗ | △ | △ | △ | ? |
| AI lead scoring | ✓ Pro+ | ✓ Pro | ✓ Pulse | ✓ Zia | ✓ Copilot | ✓ Ultimate | ✓ Pro | △ Pro | ✗ | ✗ | ✗ | ✗ | △ via Dyn |
| Generative AI email drafts | ✓ Einstein | ✓ Breeze | ✓ AI Asst. | ✓ Zia | ✓ Copilot | ✓ Sidekick | ✓ Freddy | ✓ CoPilot | ✗ | ✗ | ✗ | ✗ | ? |
| Autonomous AI agents (SDR-style) | ✓ Agentforce | ✓ Breeze Agents | △ | ✓ Zia agents | ✓ Copilot agents | ✓ AI Sales Agent | △ | △ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Native call recording | ✗ (via Zoom/Teams) | ✓ Pro+ | ✗ (3rd party) | ✓ Zoho Voice | ✓ Teams | ✗ | ✓ Freshcaller | ✓ | ✗ | ✗ | ✗ | ✗ | △ |
| Voice transcription | ✓ ECI | ✓ Call Intel | △ via Fireflies/Allo | ✓ Zoho Voice (no RO) | ✓ Copilot | △ via integration | ✓ Pro+ | ✓ CoPilot | ✗ | ✗ | ✗ | ✗ | △ |
| Romanian voice transcription | ✗ | ✗ | △ via Whisper-based 3rd party | ✗ | △ via Azure Speech | △ | ✗ | △ (via 3rd party STT) | ✗ | ✗ | ✗ | ✗ | ✗ |
| Workflow automation builder | ✓ Pro+ | ✓ Pro | ✓ Adv+ | ✓ | ✓ | ✓ Std+ | ✓ Pro | ✓ Std+ | ✗ | ✓ | ✓ | △ | ✓ |
| Custom fields / modules | ✓ | ✓ | ✓ | ✓ Ent. (200) | ✓ | ✓ | ✓ Ent. | ✓ | △ | ✓ | ✓ | △ | ✓ |
| Multi-currency | ✓ Pro+ | ✓ Pro | ✓ | ✓ | ✓ | ✓ Std+ | ✓ Pro | ✓ Std+ | ✓ RON+EUR | ✓ | ✓ | ✓ EUR | ✓ |
| Native mobile app (iOS+Android) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ Android | ✓ | ✓ Android | ✓ |
| Public REST API | △ Ent.+ only | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | △ | △ | △ | ? |
| SSO / SAML | ✓ Ent.+ | ✓ Ent. | ✓ Ent. | ✓ Ent. | ✓ via Entra ID | ✓ Ent. | ✓ Ent. | ✓ Pro+ | ✗ | ? | ? | ? | ✓ |
| **e-Factura ANAF (RO)** | ✗ (custom dev) | ✗ (custom dev) | ✗ (3rd party) | △ via SmartBill partner | ✗ (custom dev) | ✗ | ✗ | ✗ | ✓✓ native | ✓ via ERP module | ✓ via SmartBill/ANAF | ✓ Pro+ | ✓ via TotalSoft |
| **WhatsApp Business** | ✓ via Marketing Cloud | △ via Marketing Hub ($800+) | ✗ (Marketplace add-on) | △ via Zoho integrator | ✓ via Dynamics chs | △ | ✓ | ✓ Std+ | ✗ | △ | △ | ✓ Pro+ | ? |
| Marketing automation (drip + nurture) | ✓ via Marketing Cloud | ✓ via Marketing Hub | △ | ✓ Zoho Marketing | ✓ via Customer Insights | ✓ Pro+ | ✓ Pro | ✓ Std+ | ✗ | ✓ | ✓ | ✓ Std+ | ✓ |
| Sales forecasting | ✓ Pro+ | ✓ Pro | ✓ Pro+ | ✓ Pro+ | ✓ | ✓ Pro | ✓ Pro | ✓ Std+ | ✗ | ✓ | △ | ✓ Ent. | ✓ |
| Reporting & dashboards | ✓ Pro+ | ✓ Pro | ✓ Adv+ | ✓ | ✓ | ✓ Std+ | ✓ Pro | ✓ Std+ | ✓ basic | ✓ BI | △ | ✓ Ent. | ✓ |
| Sandbox environment | ✓ Ent.+ | △ Ent. | ✗ | ✓ Ent. | ✓ | ✗ | ✓ Ent. | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| RO language UI | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | △ partner | ✓ | ✓ | ✓ | ✓ | ✓ |
| Fan Courier / Cargus / GLS shipping | ✗ | ✗ | ✗ | △ via partner | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | △ | ✓ Pro+ | ✓ |
| SAGA / Winmentor / Ciel accounting export | ✗ | ✗ | ✗ | △ via partner | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | △ | ✓ Pro+ | ✓ |

Caveats: feature gating changes frequently and some "✓ Pro+" rows mean "available but requires upgrade." Always confirm against the vendor's current pricing page before adoption.

---

## Romanian market gaps (where ALL global players fail)

These are concrete gaps observed in April 2026. Every global CRM listed above either fails the test
entirely or solves it only via a custom build / paid Premium Partner / 3rd-party connector:

1. **e-Factura ANAF native, in-tenant submission.** Mandatory since 2024 (B2B) and 2025 (B2C).
   2026 deadline: 5 working days from invoice issuance to SPV upload, or fines apply. No global
   CRM ships native UBL 2.1 XML generation tied to ANAF SPV authentication. The default solution
   in Romania is "use SmartBill as the billing layer + push CRM data to it" or "build it
   yourself against the ANAF API with OAuth2." Salesforce, HubSpot, Pipedrive, Monday, and
   Freshsales all require partner work.

2. **e-Transport ANAF integration.** Mandatory for goods > 500 kg or > 10,000 RON value. Even
   most local CRMs (MiniCRM, MEFI) defer this to SmartBill; only SoftManager and Charisma cover
   it as a first-class feature.

3. **Romanian-language voice transcription with diarization, PII redaction, and AI summary.**
   Whisper supports RO well (large-v3, ~10% WER on Common Voice RO). Zoho Voice's transcription
   does NOT include Romanian (only English variants, ES/DE/FR/IT/NL/RU). Salesforce, HubSpot,
   and Dynamics conversation intelligence rely on the underlying meeting platform's STT (Zoom
   Whisper-based, Teams Azure Speech) — Romanian quality is acceptable but not tuned for sales
   vocabulary and post-processing happens in English by default.

4. **RO VAT registry / CIF lookup (anaf.ro/PlatitorTvaRest).** Auto-fill company data from
   Romanian fiscal code is standard in MEFI, MiniCRM, SoftManager, SmartBill. Not natively
   present in any global CRM.

5. **D-411 / D-394 informative declaration export, intrastat, GDPR DPA in Romanian.** Local
   CRMs cover the first two; no global CRM does. GDPR DPAs are routine on global CRMs but not
   localised to Romanian legal language by default.

6. **Romanian-language UI with proper Romanian date/number formatting and diacritics.** Zoho is
   the strongest global player here. Salesforce, HubSpot, Pipedrive, Monday, Freshsales: not
   supported.

7. **Local payment gateways (Netopia, EuPlatesc, PayU RO).** No global CRM has these as
   first-class billing integrations; Stripe / Adyen are the defaults. SmartBill, MiniCRM, and
   MEFI integrate with the local rails.

8. **WhatsApp Business as the primary B2C channel.** Used heavily in RO retail, beauty,
   automotive. Bitrix24 ships native; HubSpot requires Marketing Hub ($800+); Pipedrive needs
   3rd party; Salesforce requires Marketing Cloud licensing. Local CRMs like SoftManager have
   it built-in.

9. **Romanian holiday / working-day calendars for follow-ups, reminders, SLA timers.** No
   global CRM auto-loads RO public holidays. Local CRMs (MiniCRM, MEFI) do.

10. **Retail GestCom-style SKU / inventory / multi-warehouse tied to CRM.** SoftManager,
    Charisma, and SmartBill integrate inventory movements tightly with sales orders. No
    global CRM does this without a separate ERP investment.

---

## Most valued features per segment (SMB vs mid-market)

### SMB (5-50 employees)

**What they praise (per G2/Capterra reviews, April 2026):**
- Visual pipeline kanban with drag-and-drop deal stages (Pipedrive, Monday, HubSpot Free).
- Free or near-free entry tier (HubSpot Free ~228k customers; Bitrix24 Free unlimited users).
- Speed of mobile app for field reps (Pipedrive 4.6+/5, HubSpot 4.6+/5).
- Email sync + inbox notifications without per-feature add-ons.
- Quick-start templates and 14-day free trial without credit card (MiniCRM, Pipedrive, Zoho).
- Single transparent pricing without "contact sales" gates (Pipedrive, Zoho, Monday Basic).

**What they complain about:**
- "Everything I actually want is in the next tier up." Cited against HubSpot ($20 Starter →
  $100 Pro jump + $1,500 onboarding), Monday (3-seat minimum + Pro tier needed for forecasting),
  and Salesforce (real automation gated at Enterprise).
- AI features feel "thrown in to keep up" rather than genuinely useful (cited across HubSpot,
  Monday, and Salesforce reviews).
- Hidden onboarding fees (HubSpot Pro $1,500; Enterprise $3,500).
- Per-user pricing penalising small teams who need many viewer seats — Bitrix24's flat
  per-org model is a notable counter-example praised by RO/EE buyers.
- AI consumption metering (HubSpot AI credits, Dynamics Copilot Credits) makes monthly
  costs unpredictable.

### Mid-market (50-500 employees)

**What they praise:**
- Workflow automation depth + Blueprint builders (Zoho Enterprise, Salesforce Process Builder,
  HubSpot Workflows, Pipedrive Automations).
- Sandbox environments for safe customisation (Salesforce Pro+, Zoho Enterprise, Charisma).
- Custom modules and per-team layouts (Zoho Enterprise: 200 custom modules; Salesforce
  Enterprise: full metadata access).
- Native voice intelligence on customer calls (Salesforce Einstein Conversation Insights,
  HubSpot Call Intelligence, Dynamics Copilot for Sales).
- Public REST API with rate limits high enough for 2-way sync (HubSpot, Zoho, Pipedrive
  excellent; Salesforce only at Enterprise).
- SSO/SAML and SCIM provisioning (gated to Enterprise tier across all global players).
- Granular RBAC with field-level permissions (Salesforce strongest; Zoho close second).

**What they complain about:**
- Onboarding cost and time-to-value (Salesforce implementations 6-12 months; mid-market HubSpot
  needs a partner if marketing+sales+service Hubs are all enabled).
- Lock-in via proprietary metadata formats (Salesforce, Microsoft Dataverse).
- Lead routing / dedup rules are still surprisingly weak across most platforms (cited against
  HubSpot and Pipedrive).
- AI agents that "make things up" — autonomous SDR agents writing inaccurate emails to live
  prospects is the most-cited 2026 complaint, especially against early Agentforce and Breeze
  Prospecting Agent rollouts.
- Per-tenant data residency (EU vs US) requires Enterprise tier on Salesforce and HubSpot;
  Zoho EU is more permissive.

### Romanian SMB specifically

**Praised about local players:**
- Native e-Factura ANAF without integration work (SmartBill, SoftManager, MEFI, MiniCRM).
- Romanian-language UI and Romanian phone support (MEFI: "Suport 100% în română" cited
  by Bitrix24 RO partner TDACRM as a competitive selling point).
- All-in-one CRM + invoicing + ERP + project tracking (MEFI 18 modules; SoftManager Sales +
  Financial + Technical + Marketing modules; Charisma full ERP suite).
- Transparent local-currency pricing (MEFI online calculator; SoftManager fixed EUR tiers).

**Complained about:**
- Limited or no AI / voice intelligence — local CRMs lag global on this by 2-3 years.
- UI looks dated compared to HubSpot / Monday / Pipedrive.
- Mobile apps less polished (MEFI/SoftManager Android-only or Android-first).
- Smaller integration ecosystems vs HubSpot AppExchange / Salesforce Marketplace.
- Vendor lock-in concerns for SMBs that may IPO / expand internationally — global CRMs
  perceived as more "exit-ready."

---

## Trends to watch (for Amass CRM positioning)

1. **Voice intelligence is now table stakes for mid-market.** Any CRM competing for 50+ seat
   accounts in 2026 needs native call recording + transcription + AI summary. The bar is set
   by Gong / Salesforce ECI / Dynamics Copilot for Sales. Romanian-language quality is the gap.

2. **Agentic AI is the new pricing axis.** Salesforce Agentforce, HubSpot Breeze Agents,
   Microsoft Copilot, and Monday AI Sales Agent all monetise per-action / per-credit. Buyers
   are confused about TCO. A flat-rate AI offering is a wedge.

3. **e-Factura is a moat in RO.** From January 2026 the 5-working-day SPV deadline makes
   "submit it for me" automation valuable. Native, no-extra-config e-Factura is a real product
   differentiator local CRMs already enjoy.

4. **Free tier is a wedge but not a destination.** HubSpot Free has 228k+ customers; conversion
   to paid is the actual business model. Bitrix24 Free unlimited-user is unique and praised.
   Free-forever-with-AI is the next move.

5. **WhatsApp + voice are converging.** Both are async customer channels for RO/EE SMBs.
   Whichever CRM ships unified omnichannel inbox + voice intelligence + WhatsApp B2B/B2C wins
   the southern Europe SMB.

6. **Multi-tenant isolation + auditability matters more.** With AI agents writing to records
   autonomously, audit logs and tenant-level data isolation become buyer questions, not just
   security questions. (Per CLAUDE.md rule #3 — Amass already has this nailed.)

---

## Sources

### Salesforce
- [Salesforce Pricing 2026 (saascrmreview.com)](https://saascrmreview.com/salesforce-pricing/)
- [Salesforce Pricing — Tech.co 2026](https://tech.co/crm-software/salesforce-pricing-how-much-does-salesforce-cost)
- [Salesforce Pricing — official](https://www.salesforce.com/pricing/)
- [Salesforce Pricing Tiers — Redress Compliance](https://redresscompliance.com/salesforce-pricing-tiers.html)
- [Einstein Conversation Insights guide — Phenoble](https://phenoble.com/blogs/einstein-conversation-insights-complete-guide)
- [Salesforce Call Recording 2026 guide — Girikon](https://cti.girikon.ai/blogs/salesforce-call-recording/)
- [Agentforce — Salesforce official](https://www.salesforce.com/agentforce/)

### HubSpot
- [HubSpot Sales Hub pricing — official](https://blog.hubspot.com/sales/hubspot-sales-hub-pricing)
- [HubSpot Pricing 2026 — engagebay analysis](https://www.engagebay.com/blog/hubspot-pricing/)
- [HubSpot Sales Hub Pricing 2026 — Docket](https://docket.io/resources/research/hubspot-sales-hub-pricing)
- [HubSpot Sales Hub Pricing 2026 — Cloudtalk](https://www.cloudtalk.io/blog/hubspot-calling-pricing/)
- [HubSpot Breeze AI Agents — official](https://www.hubspot.com/products/artificial-intelligence/breeze-ai-agents)
- [HubSpot Breeze AI Agents 2026 — onthefuze](https://www.onthefuze.com/hubspot-insights-blog/hubspot-breeze-ai-agents-2026)
- [HubSpot Breeze 2026 — eesel AI](https://www.eesel.ai/blog/what-is-hubspot-breeze-ai)
- [HubSpot Market Share 2026 — Resonate](https://www.resonatehq.com/blog/hubspot-market-share)

### Pipedrive
- [Pipedrive Pricing 2026 — SmartProcessFlow](https://smartprocessflow.com/pipedrive-pricing)
- [Pipedrive Pricing 2026 — Lindy](https://www.lindy.ai/blog/pipedrive-pricing)
- [Pipedrive Pricing 2026 — MarketBetter](https://www.marketbetter.ai/blog/pipedrive-pricing-breakdown-2026/)
- [Pipedrive Pricing 2026 — G2](https://www.g2.com/products/pipedrive/pricing)
- [Pipedrive call recording 2026 — Hardware Secrets](https://hardwaresecrets.com/best-ai-voice-agent-for-sales-teams-using-pipedrive-crm-in-2026/)
- [Pipedrive phone integrations 2026 — Allo](https://www.withallo.com/blog/best-phone-system-integrations-for-pipedrive)
- [Pipedrive Marketplace — Fireflies](https://www.pipedrive.com/en/marketplace/app/fireflies-ai-recording-transcription/4ab9e5f57e197843)

### Zoho CRM
- [Zoho CRM Pricing 2026 — getaiperks](https://www.getaiperks.com/en/articles/zoho-crm-pricing)
- [Zoho CRM Q1 2026 update — official](https://www.zoho.com/blog/crm/q1-2026-update.html)
- [Zoho CRM Pricing 2026 — Method](https://www.method.me/blog/zoho-crm-cost/)
- [Zoho CRM Review — AI CMO](https://ai-cmo.net/tools/zoho-crm)
- [Zoho Voice Call Transcription — official](https://help.zoho.com/portal/en/kb/zoho-voice/call-intelligence/articles/c-all-transcription)
- [Zoho CRM Telephony / PhoneBridge — official](https://www.zoho.com/voice/help/zoho-crm-telephony-integration.html)
- [Zoho Voice features — official](https://www.zoho.com/voice/features.html)
- [Svennis Zoho RO Premium Partner](https://www.svennis.ro/blog/ce-este-zoho)

### Microsoft Dynamics 365 Sales
- [Microsoft Dynamics 365 Sales Pricing — official](https://www.microsoft.com/en-us/dynamics-365/products/sales/pricing)
- [Microsoft 365 Copilot pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing)
- [Dynamics 365 Copilot 2026 guide — IES Group](https://www.iesgp.com/blog/microsoft-dynamics-365-copilot-complete-guide)
- [Dynamics 2026 update — WinCentral](https://thewincentral.com/microsoft-dynamics-2026-copilot-update/)
- [Copilot for Dynamics 365 Sales 2026 — ERP Software Blog](https://erpsoftwareblog.com/2025/08/copilot-for-dynamics-365-sales/)

### Monday.com CRM
- [Monday Sales CRM pricing — official](https://monday.com/crm/pricing)
- [Monday CRM Review 2026 — CRM.org](https://crm.org/news/monday-crm-review)
- [Monday CRM Review 2026 — Decision Circuit](https://www.decisioncircuit.com/crm/reviews/monday-crm-review/)
- [Monday CRM AI Sales Agent — official blog](https://monday.com/blog/crm-and-sales/crm-with-ai/)

### Freshsales
- [Freshsales Pricing — official](https://www.freshworks.com/crm/pricing/)
- [Freshsales review 2026 — OnePageCRM](https://www.onepagecrm.com/crm-reviews/freshsales/)
- [Freshsales 2026 review — Authencio](https://www.authencio.com/blog/freshsales-crm-guide-ai-features-pricing-pros-cons-integrations-best-alternatives-877655)
- [Freshsales review 2026 — MarketBetter](https://marketbetter.ai/blog/freshsales-review-2026/)

### Bitrix24
- [Bitrix24 plans and pricing — official](https://www.bitrix24.com/prices/)
- [Bitrix24 Plans 2026 — CloudTalk](https://www.cloudtalk.io/blog/bitrix24-pricing/)
- [Bitrix24 Review 2026 — CRM.org](https://crm.org/news/bitrix24-crm-review)
- [Bitrix24 free CRM call recording — official](https://www.bitrix24.com/uses/free-crm-with-call-recording-voice.php)
- [Bitrix24 RO partner — TDACRM](https://tdacrm.ro/)

### SmartBill
- [SmartBill e-Factura — official](https://www.smartbill.ro/e-factura)
- [SmartBill totul-despre-efactura](https://www.smartbill.ro/totul-despre-efactura)
- [SmartBill — homepage](https://www.smartbill.ro/)
- [SmartBill Review 2026 — Research.com](https://research.com/software/reviews/smartbill)

### MEFI
- [MEFI pret CRM calculator — official](https://mefi.ro/calculator-pret-crm/)
- [MEFI new platform — official](https://mefi.ro/noul-mefi/)
- [MEFI CRM Romania — official](https://mefi.ro/crm/)
- [MEFI Software CRM Romanesc IMM 2025](https://mefi.ro/software-crm-romanesc-mefi/)

### MiniCRM (Romania)
- [MiniCRM Reviews 2026 — G2](https://www.g2.com/products/minicrm/reviews)
- [MiniCRM 2026 — GetApp](https://www.getapp.com/all-software/a/minicrm/)
- [MiniCRM facturare module — official](https://www.minicrm.ro/tur/facturare/)
- [MiniCRM Romania — official](https://www.minicrm.ro/)
- [group.one acquires MiniCRM (2024)](https://www.group.one/news/group-one-to-acquire-minicrm-expanding-its-saas-suite-with-a-purpose-built-crm-for-smb-success)

### SoftManager
- [SoftManager pricing — official](https://www.softmanager.ro/en/Prices.html)
- [SoftManager about — official](https://www.softmanager.ro/en/About.html)

### Charisma (TotalSoft)
- [Charisma official site](https://www.charisma.ro/en)
- [Charisma CRM by Microsoft Dynamics](https://www.charisma.ro/en/software-system/charisma-nivel-3/charisma-crm-by-microsoft-dynamics)
- [Charisma 2026 features — TEC](https://www3.technologyevaluation.com/solutions/15947/charisma)

### Romanian e-Factura / ANAF context
- [ANAF e-Factura — official](https://www.anaf.ro/anaf/internet/ANAF/despre_anaf/strategii_anaf/proiecte_digitalizare/e.factura)
- [Romania e-Invoicing 2026 — Marosa VAT](https://marosavat.com/vat-news/romania-e-invoicing-e-reporting)
- [Romania B2B/B2C e-Invoicing 2025 update — DDD Invoices](https://dddinvoices.com/learn/e-invoicing-romania)
- [Romania e-Invoicing — EDICOM](https://edicomgroup.com/blog/romania-moves-towards-electronic-invoicing-ro-efactura-platform)
- [Top RO programe facturare 2026 — TaxDome](https://taxdome.com/ro-ro/blog/top-programe-de-facturare-2026-comparatii-e-factura-si-integrarea-cu-contabilitatea)
- [Romania e-invoicing 2025 — VATupdate briefing](https://www.vatupdate.com/2025/12/02/briefing-document-romanian-e-invoicing-and-e-transport-regulations/)

### CRM market 2026 / AI agents / voice
- [CRM AI shift to autonomous agents — Klover.ai 2026](https://www.klover.ai/crm_ai_shift_to_autonomous_agents_and_self_driving_software_indepth_analysis_2026/)
- [Future of AI agents 2026 — Salesmate](https://www.salesmate.io/blog/future-of-ai-agents/)
- [Best AI Voice Agents 2026 — Salesforce](https://www.salesforce.com/agentforce/voice/ai-voice-agents/best/)
- [The Rise of Autonomous Sales Agents 2026 — Medium](https://medium.com/activated-thinker/the-rise-of-autonomous-sales-agents-inside-your-crm-81452f93f853)
- [Best CRM Software April 2026 — G2](https://www.g2.com/categories/crm)
- [CRM Statistics 2026 — Demandsage](https://www.demandsage.com/crm-statistics/)
- [CRM Comparison 2026 — Salesflare](https://blog.salesflare.com/compare-salesforce-zoho-hubspot-pipedrive)
- [Best CRM with WhatsApp 2026 — Folk](https://www.folk.app/articles/best-whatsapp-crm)
- [Best Call Transcription Software 2026 — CloudTalk](https://www.cloudtalk.io/blog/best-call-transcription-software/)
- [Romanian Speech-to-Text — Speechmatics](https://www.speechmatics.com/speech-to-text/romanian)
- [Whisper supported languages](https://whisper-api.com/docs/languages/)

---

Date: 2026-04-28 — 70 sources cited
