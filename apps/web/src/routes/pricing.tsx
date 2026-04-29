import { createRoute, Link } from '@tanstack/react-router';
import { Check, Mic, Sparkles, Star, X } from 'lucide-react';
import { rootRoute } from './root';

export const pricingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pricing',
  component: PricingPage,
});

interface Plan {
  id: 'starter' | 'growth' | 'pro' | 'enterprise';
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  notIncluded?: string[];
  cta: string;
  ctaHref: string;
  highlighted?: boolean;
  badge?: string;
}

const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    price: '€19',
    period: '/utilizator/lună',
    tagline: 'Pentru SMB-uri 5-15 utilizatori',
    features: [
      'Companii, contacte, deal-uri unlimited',
      'Pipeline kanban configurabil',
      '100 transcripturi voice AI / lună',
      'ANAF e-Factura built-in',
      'Email + reminders + tasks',
      'Export GDPR (Art. 17 + 20)',
      'Audit log append-only',
      'Suport email standard',
    ],
    notIncluded: ['Workflows automatizate', 'Reports advanced'],
    cta: 'Începe trial 14 zile',
    ctaHref: '/register?plan=starter',
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '€39',
    period: '/utilizator/lună',
    tagline: 'Pentru SMB-uri 15-50 utilizatori',
    badge: 'Cel mai popular',
    features: [
      'Tot ce e în Starter',
      'Voice AI nelimitat (transcripție + AI summary)',
      'AI brief zilnic (Cmd-K natural language intent)',
      'Workflows + sequence automation',
      'Reports advanced + report builder',
      'Custom fields',
      'WhatsApp Business + SMS Twilio',
      'Suport prioritate (răspuns 4h business hours)',
    ],
    notIncluded: ['SSO/SAML', 'SLA garantat', 'Dedicated CSM'],
    cta: 'Începe trial 14 zile',
    ctaHref: '/register?plan=growth',
    highlighted: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '€69',
    period: '/utilizator/lună',
    tagline: 'Pentru organizații 50+ utilizatori',
    features: [
      'Tot ce e în Growth',
      'SSO / SAML (Okta, Azure AD, Google Workspace)',
      'SCIM 2.0 auto-provisioning',
      'SLA 99.9% uptime',
      'Backup encrypted geo-redundant',
      'API access nelimitat',
      'Webhooks outbound',
      'Custom integrations',
      'Suport dedicat (răspuns 1h, telefon)',
    ],
    cta: 'Începe trial 14 zile',
    ctaHref: '/register?plan=pro',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: 'negociat',
    tagline: 'Organizații 500+ utilizatori',
    features: [
      'Tot ce e în Pro',
      'On-premise option (self-hosted)',
      'Data residency (EU / RO / multi-region)',
      'Dedicated infrastructure',
      'Custom SLA (până la 99.99%)',
      'Customer Success Manager dedicat',
      'Training + onboarding personalizat',
      'Audit-ready (SOC 2, ISO 27001 — în roadmap)',
    ],
    cta: 'Programează demo',
    ctaHref: 'mailto:sales@amass-crm.ro?subject=Cerere demo Enterprise',
  },
];

const COMPARISON_ROWS: Array<{ label: string; values: Record<Plan['id'], string | boolean> }> = [
  { label: 'Utilizatori incluși', values: { starter: 'min 5', growth: 'min 15', pro: 'min 50', enterprise: '500+' } },
  { label: 'Voice transcripts AI / lună', values: { starter: '100', growth: 'Nelimitat', pro: 'Nelimitat', enterprise: 'Nelimitat' } },
  { label: 'Pipeline kanban', values: { starter: true, growth: true, pro: true, enterprise: true } },
  { label: 'ANAF e-Factura', values: { starter: true, growth: true, pro: true, enterprise: true } },
  { label: 'Workflows automatizate', values: { starter: false, growth: true, pro: true, enterprise: true } },
  { label: 'Reports advanced + builder', values: { starter: false, growth: true, pro: true, enterprise: true } },
  { label: 'WhatsApp + SMS', values: { starter: false, growth: true, pro: true, enterprise: true } },
  { label: 'SSO / SAML', values: { starter: false, growth: false, pro: true, enterprise: true } },
  { label: 'SCIM auto-provisioning', values: { starter: false, growth: false, pro: true, enterprise: true } },
  { label: 'SLA garantat', values: { starter: false, growth: false, pro: '99.9%', enterprise: 'Custom' } },
  { label: 'Backup geo-redundant', values: { starter: false, growth: false, pro: true, enterprise: true } },
  { label: 'On-premise option', values: { starter: false, growth: false, pro: false, enterprise: true } },
  { label: 'Suport', values: { starter: 'Email', growth: 'Prioritate', pro: 'Dedicat', enterprise: 'CSM' } },
];

function PricingPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/login" className="font-semibold flex items-center gap-2">
            <Sparkles className="size-5" />
            AMASS CRM
          </Link>
          <div className="flex gap-3 text-sm">
            <Link to="/privacy" className="hover:underline">Confidențialitate</Link>
            <Link to="/login" className="hover:underline">Conectează-te</Link>
            <Link to="/register" className="rounded-md bg-foreground text-background px-3 py-1.5 hover:opacity-90">
              Cont nou
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-4 pt-16 pb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Prețuri simple, transparente</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          14 zile trial gratuit pe orice plan. Fără card la înregistrare. Anulezi oricând.
          Discount <strong>20% anual</strong>.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-2 text-xs">
          <Mic className="size-4" />
          <span>Voice intelligence nativ — transcripție automată + AI summary la fiecare apel</span>
        </div>
      </section>

      {/* Plan cards */}
      <section className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-6 text-center">Compară planurile</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium">Feature</th>
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className="px-4 py-3 text-center font-medium">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-muted-foreground">{row.label}</td>
                  {PLANS.map((p) => (
                    <td key={p.id} className="px-4 py-3 text-center">
                      <CellValue value={row.values[p.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-6 text-center">Întrebări frecvente</h2>
        <div className="space-y-6">
          <FaqItem
            q="Cum funcționează trial-ul de 14 zile?"
            a="Te înregistrezi gratuit, nu ceri card la signup. La final de 14 zile alegi un plan și introduci datele de plată sau contul intră în pauză (datele se păstrează 90 zile pentru reactivare)."
          />
          <FaqItem
            q="Pot schimba planul mai târziu?"
            a="Da, oricând. Upgrade prorate-uit pe ziua curentă. Downgrade activ de la următoarea facturare."
          />
          <FaqItem
            q='Ce înseamnă "voice intelligence"?'
            a="Fiecare apel telefonic prin Twilio e automat transcris în română (Whisper / whisperX), redactat de date personale (Presidio, opțional), și rezumat în 3 puncte de Claude (interes / obiecție / pas următor) cu draft de email follow-up automat. Salesperson primește totul în maxim 60 secunde post-apel."
          />
          <FaqItem
            q="Cine deține datele?"
            a="Tu, mereu. Export complet JSON (GDPR Art. 20 — portabilitate) e accesibil oricând din UI. Ștergerea contului anonimizează datele PII conform Art. 17, păstrând integritatea fiscală pentru facturi (10 ani — obligație Cod Fiscal RO)."
          />
          <FaqItem
            q="Puteți face găzduire în RO / EU?"
            a="Da. Default e EU (Hetzner Germania / Olanda). Pentru Enterprise putem face găzduire dedicată RO sau on-premise pe infrastructura ta."
          />
          <FaqItem
            q="Ce se întâmplă dacă scădem sub utilizatorii minimi pe plan?"
            a="Minimul e doar la sign-up. Dacă pe parcurs scădeți sub minim, puteți downgrada gratuit la planul potrivit numărului real de utilizatori."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-wrap justify-between items-center gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} AMASS CRM. Construit în România.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:underline">Confidențialitate</Link>
            <Link to="/legal/subprocessors" className="hover:underline">Sub-procesatori</Link>
            <a href="mailto:hello@amass-crm.ro" className="hover:underline">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PlanCard({ plan }: { plan: Plan }): JSX.Element {
  const isCustom = plan.id === 'enterprise';
  return (
    <div
      className={`relative rounded-xl border bg-card p-6 flex flex-col ${
        plan.highlighted ? 'border-foreground shadow-lg ring-2 ring-foreground/10' : 'border-border'
      }`}
    >
      {plan.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground text-background px-3 py-0.5 text-xs font-semibold whitespace-nowrap flex items-center gap-1">
          <Star className="size-3" /> {plan.badge}
        </span>
      )}
      <h3 className="text-lg font-bold">{plan.name}</h3>
      <p className="text-xs text-muted-foreground mt-1 mb-4">{plan.tagline}</p>
      <div className="mb-4">
        <span className="text-4xl font-bold">{plan.price}</span>
        <span className="text-muted-foreground text-sm ml-1">{plan.period}</span>
      </div>
      <ul className="space-y-2 text-sm flex-1 mb-6">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="size-4 text-emerald-500 shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
        {plan.notIncluded?.map((f) => (
          <li key={f} className="flex items-start gap-2 text-muted-foreground">
            <X className="size-4 text-muted-foreground/60 shrink-0 mt-0.5" />
            <span className="line-through opacity-60">{f}</span>
          </li>
        ))}
      </ul>
      {isCustom ? (
        <a
          href={plan.ctaHref}
          className={`block text-center rounded-md py-2.5 text-sm font-medium transition-colors ${
            plan.highlighted
              ? 'bg-foreground text-background hover:opacity-90'
              : 'border border-border hover:bg-muted'
          }`}
        >
          {plan.cta}
        </a>
      ) : (
        <Link
          to={plan.ctaHref}
          className={`block text-center rounded-md py-2.5 text-sm font-medium transition-colors ${
            plan.highlighted
              ? 'bg-foreground text-background hover:opacity-90'
              : 'border border-border hover:bg-muted'
          }`}
        >
          {plan.cta}
        </Link>
      )}
    </div>
  );
}

function CellValue({ value }: { value: string | boolean }): JSX.Element {
  if (value === true) return <Check className="size-4 text-emerald-500 inline" />;
  if (value === false) return <X className="size-4 text-muted-foreground/40 inline" />;
  return <span className="text-foreground">{value}</span>;
}

function FaqItem({ q, a }: { q: string; a: string }): JSX.Element {
  return (
    <details className="group rounded-lg border border-border p-4 cursor-pointer">
      <summary className="font-medium text-sm list-none flex items-center justify-between">
        {q}
        <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{a}</p>
    </details>
  );
}
