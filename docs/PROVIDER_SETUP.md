# Provider setup — step-by-step

Each external provider AMASS CRM integrates with is **disabled until you supply real credentials**. This file is the operator runbook to enable each one.

The order below is roughly: cheapest/fastest first. Skip any provider whose feature you don't need at launch.

---

## 1. Domain (~$10/year)

You need a domain for HTTPS, OAuth redirects, and Twilio webhooks. None of the production providers will accept Cloudflare quick tunnels long-term.

- **Buy at**: [Porkbun](https://porkbun.com), [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/), or [Namecheap](https://www.namecheap.com)
- **Recommend**: `amass-crm.ro` for branding, or any `.dev` / `.app` for tech feel
- **DNS**: point A/AAAA records to your VPS IP (or use Cloudflare proxied)

Once you have it, replace the Cloudflare quick tunnel URL in:
- `infra/.env` → `MINIO_PUBLIC_URL`, `CORS_ALLOWED_ORIGINS`
- `infra/.env.production` → all `*_BASE_URL` and `CORS_ALLOWED_ORIGINS`
- GitHub repo secret `DEMO_URL` for `perf-budget.yml`

---

## 2. SMTP (free–$15/mo)

For: outbound email (notifications, password reset, sequences). Without this, all email features are disabled.

### Recommended: [Resend](https://resend.com) (modern, generous free tier)

1. Sign up → verify domain (DNS records: MX, SPF, DKIM)
2. Generate API key
3. Set in `.env.production`:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=587
   SMTP_USER=resend
   SMTP_PASS=re_xxxxxxxxxxxxxxxxxx
   SMTP_FROM=hello@your-domain.ro
   ```
4. Verify: log in to AMASS, send a test password reset, check inbox

### Alternative: Mailgun, Postmark, SendGrid

Same flow. All offer 10k emails/month free or $10–15/month for SMB volume.

---

## 3. Anthropic API (pay-per-token, ~$5/month for SMB use)

For: deal AI suggestions, morning brief, email draft generation, call summaries.

Note: `GEMINI_API_KEY` is already set in your `.env` (free tier 1500 req/day). Anthropic only needed if you want fallback or higher quality.

1. Sign up at <https://console.anthropic.com>
2. Generate API key (`sk-ant-xxxx...`)
3. Set in `.env.production`:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxx...
   ```
4. Verify: log in, click "AI suggestions" on a deal — should return real text instead of placeholder

---

## 4. Stripe (1.4% + €0.30 per transaction)

For: subscription billing. Without this, the billing module is mock-only.

1. Sign up at <https://dashboard.stripe.com> → Developers → API keys
2. Create products + prices in Stripe (Starter, Growth, Enterprise)
3. Set in `.env.production`:
   ```
   STRIPE_SECRET_KEY=sk_live_xxxx
   STRIPE_WEBHOOK_SECRET=whsec_xxxx
   STRIPE_PRICE_STARTER=price_xxxx
   STRIPE_PRICE_GROWTH=price_xxxx
   STRIPE_PRICE_ENTERPRISE=price_xxxx
   ```
4. Add webhook in Stripe dashboard:
   - URL: `https://your-domain.ro/api/v1/billing/webhook`
   - Events: `customer.subscription.*`, `invoice.payment_*`, `checkout.session.completed`
5. Verify: subscribe a test tenant via `/app/settings/billing` → see Stripe dashboard event

---

## 5. Google OAuth (free)

For: Calendar sync + Gmail send (if you want it as alternative to SMTP).

1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
2. App type: Web application
3. Authorized redirect URI: `https://your-domain.ro/api/v1/calendar/callback/google`
4. Authorized scopes: `calendar.readonly`, `calendar.events`, `gmail.send`
5. Set in `.env.production`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   ```
6. Verify: log in to AMASS → Settings → Calendar → "Connect Google" → OAuth flow → events should appear

---

## 6. Microsoft Graph (free for SMB)

For: Outlook calendar + Microsoft 365 email integration.

1. Azure Portal → App registrations → New registration
2. Redirect URI (Web): `https://your-domain.ro/api/v1/calendar/callback/outlook`
3. API permissions: `Mail.Send`, `Calendars.ReadWrite` (Delegated)
4. Certificates & secrets → New client secret → copy value
5. Set in `.env.production`:
   ```
   OUTLOOK_CLIENT_ID=xxxx-xxxx-xxxx
   OUTLOOK_CLIENT_SECRET=xxxx
   ```
6. Verify same way as Google

---

## 7. Twilio ($1/month + per-use)

For: outbound calls, SMS, WhatsApp. Without this, the calls module is mock-only.

1. Sign up at <https://console.twilio.com>
2. Buy a Romanian phone number (~$1.15/month, +$0.013 per SMS, +$0.025 per minute call)
3. Get credentials: Account SID, Auth Token (from console dashboard)
4. Set in `.env.production`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxx
   TWILIO_AUTH_TOKEN=xxxx
   TWILIO_SMS_FROM=+40xxxxxxxxx
   TWILIO_WEBHOOK_BASE_URL=https://your-domain.ro
   ```
5. In Twilio number config → Voice webhook + SMS webhook:
   - `https://your-domain.ro/api/v1/calls/webhook/voice`
   - `https://your-domain.ro/api/v1/sms/webhook/inbound`
6. Verify: place a test outbound call from AMASS → status callback should arrive

For WhatsApp Business: separate setup via Twilio + Meta Business Manager. Skip until needed.

---

## 8. ANAF e-Factura (free, government)

For: e-invoice submission to Romanian tax authority. **Required** if you sell B2B in Romania.

1. Get a digital certificate from a Romanian provider (Trans Sped, certSIGN, DigiSign — ~€30-50/year)
2. Register the certificate at <https://logincert.anaf.ro>
3. Register an OAuth app → get `client_id` and `client_secret`
4. Set in `.env.production`:
   ```
   ANAF_CLIENT_ID=xxxx
   ANAF_CLIENT_SECRET=xxxx
   ANAF_SANDBOX=false        # true for testing first
   ANAF_VAT=RO12345678       # your company's VAT
   ANAF_COMPANY_NAME=...
   ANAF_ADDRESS=...
   ANAF_CITY=...
   ANAF_COUNTY=...
   ```
5. Verify: create an invoice in AMASS → Submit to ANAF → check status in `/app/invoices/<id>`

Test with sandbox first (`ANAF_SANDBOX=true`) — wrong fiscal data in production gets you flagged.

---

## What to do if you skip a provider

Each module gracefully degrades:

| Provider missing | Behavior |
|---|---|
| SMTP | Email features disabled; password reset uses console-printed token in dev |
| Anthropic | Falls back to Gemini (already set); if both empty, AI features show "AI not configured" |
| Stripe | `/app/settings/billing` shows mock data; checkout returns 503 |
| Google OAuth | Calendar tab shows "Connect to enable" button that 503s without creds |
| Microsoft Graph | Outlook tab same as above |
| Twilio | Calls module shows mock UI; webhook 401 if attempted |
| ANAF | Invoice "Submit to ANAF" button disabled |

So you can launch with **just SMTP + domain + VPS** if your first pilot doesn't need billing/calls/calendar.

---

## Verification checklist

After setting any provider's credentials, run:

```bash
# Restart the API to pick up new env
docker compose -f infra/docker-compose.yml restart api

# Check API boot logs for env validation errors
docker logs amass-api 2>&1 | tail -50

# Smoke test the affected endpoint (example for Stripe)
curl https://your-domain.ro/api/v1/billing/subscription \
  -H "Authorization: Bearer <jwt>"
```

Update `RELEASE_CHECKLIST.md` to check the corresponding integration row.
