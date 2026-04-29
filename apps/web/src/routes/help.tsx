import { useState } from 'react';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BookOpen,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Compass,
  ExternalLink,
  KanbanSquare,
  Keyboard,
  Lock,
  Mail,
  PartyPopper,
  PhoneCall,
  PlayCircle,
  Sparkles,
  Zap,
} from 'lucide-react';
import { authedRoute } from './authed';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { TOUR_REGISTRY } from '@/lib/tours/registry';
import { toursApi } from '@/lib/tours/api';

export const helpRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/help',
  component: HelpPage,
});

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  body: { heading: string; content: string }[];
}

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Începe aici (recap welcome wizard)',
    icon: PartyPopper,
    body: [
      {
        heading: 'Ce e AMASS CRM',
        content: 'CRM multi-tenant cu izolare la 3 straturi (middleware ALS → Prisma extension → Postgres RLS), construit pentru SMB-uri B2B+B2C din RO/EU. Diferențiator principal: voice intelligence (transcripție automată + AI summary la fiecare apel) + ANAF e-Factura built-in.',
      },
      {
        heading: 'Primul pas: explorează cu date demo',
        content: 'Mergi la /app/welcome și apasă „Încarcă date demo" la pasul 3 (doar OWNER). Vei avea instant 30 companii din verticale relevante (heating, IT, retail, construct), ~50 contacte, 20 deal-uri în diverse stages. Toate marcate cu CUI RO99000001+ ca să le poți identifica vs datele tale reale.',
      },
      {
        heading: 'Re-rulează wizard-ul',
        content: 'Welcome wizard apare automat o singură dată per tenant. Dacă vrei să-l vezi din nou (ex: să arăți unui coleg), poți reseta din DB sau Settings → Avansate (când va fi implementat).',
      },
    ],
  },
  {
    id: 'crm-basics',
    title: 'CRM Basics — Companii, Contacte, Clienți',
    icon: Building2,
    body: [
      {
        heading: 'Diferența Company vs Contact vs Client',
        content: 'Company = entitate juridică (firmă cu CUI). Contact = persoană (poate aparține unei companii sau standalone). Client = un tip special de Contact pentru flow-ul B2C (consumatori finali, nu reprezentanți de firmă). Toate au polymorphic notes/reminders/attachments — adaugi aceeași notă pe oricare.',
      },
      {
        heading: 'Companii decision-maker',
        content: 'Pe Contact ai flag-ul „isDecider". Marchează cine ia decizia de cumpărare în firmă — ajutor pentru qualified leads. Toate câmpurile (companie, jobTitle, email) sunt căutabile semantic via embedding-uri OpenAI (semantic search în /search).',
      },
      {
        heading: 'Importer CSV (GestCom)',
        content: 'În /app/imports poți face upload CSV cu CLIENTS / COMPANIES / CONTACTS. Format compatibil GestCom RO. Limit 50 MB. Procesare async via BullMQ; poți închide tab-ul, primești notificare când e gata.',
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline & Deal-uri',
    icon: KanbanSquare,
    body: [
      {
        heading: 'Kanban drag-and-drop',
        content: 'Deal-urile au statusuri OPEN / WON / LOST și parcurg etape configurabile (Nou, Calificat, Negociere, Câștigat, Pierdut by default). Poți drag-and-drop între etape; ordinea în coloană e persistată.',
      },
      {
        heading: 'Probabilitate de win',
        content: 'Fiecare etapă are o probabilitate (10% / 30% / 60% / 100% / 0% by default). Forecast-ul total = suma deal value × probabilitate. Poți override per-deal cu un câmp probability custom.',
      },
      {
        heading: 'Multi-currency',
        content: 'Default RON; poți seta pe deal alt currency. Reports și dashboard convertesc automat (la rate FX configurate în Settings → Billing).',
      },
    ],
  },
  {
    id: 'voice',
    title: 'Voice Intelligence — Apeluri AI',
    icon: PhoneCall,
    body: [
      {
        heading: 'Cum funcționează un apel transcript',
        content: '1) Twilio rutează apelul prin numărul tău. 2) Recording-ul e salvat în MinIO (S3-compatible). 3) AI worker (Python + FastAPI) descarcă recording-ul, rulează Whisper / whisperX pentru transcripție Romanian. 4) Optional, Presidio redactează PII (CNP, IBAN, CUI). 5) Claude generează summary 3-puncte (interes / obiecție / pas următor) + draft email follow-up. 6) Totul e disponibil în <60 secunde post-apel pe contact.',
      },
      {
        heading: 'Consimțământ pentru transcripție',
        content: 'Transcripția e GATED de consent — tenant-ul trebuie să marcheze contactul cu consent explicit pentru CALL_TRANSCRIPTION purpose (vezi /app/consents/...). Conform GDPR Art. 6, voice este date sensibile — nu se procesează fără bază legală clară.',
      },
      {
        heading: 'Cmd-K AI Intent',
        content: 'Apasă ⌘K (Mac) sau Ctrl+K (Windows) oriunde și scrie ce vrei în natural language: „sună Acme mâine 14:00", „trimite ofertă către Maria de la Beta", „adaugă reminder follow-up Cosmin". AI parsează intenția și pre-completează acțiunea.',
      },
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows & Automatizări',
    icon: Zap,
    body: [
      {
        heading: 'Trigger → Action',
        content: 'În /app/workflows definești trigger-e (deal_won, contact_created, deal_stage_changed, invoice_paid etc.) cu condiții (ex: deal value > 10000) și actions (send email, create task, fire webhook outbound, update contact field).',
      },
      {
        heading: 'Email sequences',
        content: 'În /app/email-sequences faci drip campaigns: pe enrollment al unui contact, trimit email 1 → așteaptă 3 zile → email 2 → așteaptă 7 zile → email 3 etc. Stop conditions: contact replied, deal won, manually unsubscribed.',
      },
    ],
  },
  {
    id: 'email',
    title: 'Email, SMS, WhatsApp',
    icon: Mail,
    body: [
      {
        heading: 'Email tracking',
        content: 'Fiecare email trimis are pixel de open + click tracking. Vezi statisticile pe /app/email/:id/tracking. URL-urile click sunt HMAC-semnate ca să prevenim phishing prin domeniul tău (open redirect defense).',
      },
      {
        heading: 'WhatsApp Business',
        content: 'Conectează un WABA account din Meta și primești inbox la /app/whatsapp.inbox. Conversațiile inbound + outbound, cu signature verification pe webhook X-Hub-Signature-256.',
      },
      {
        heading: 'SMS prin Twilio',
        content: 'Inbox la /app/sms.inbox. Trimit SMS din contact detail page. Suport pentru două-direcții.',
      },
    ],
  },
  {
    id: 'billing',
    title: 'Facturi, Abonamente, Plăți',
    icon: CircleDollarSign,
    body: [
      {
        heading: 'ANAF e-Factura built-in',
        content: 'Factură generată în UBL 2.1 (CIUS-RO) și submisă automat la ANAF SPV (test sau prod, în funcție de env). Status sincronizat în /app/invoices.',
      },
      {
        heading: 'Tier-uri și pricing',
        content: 'Vezi /pricing pentru cele 4 tier-uri (Starter €19 / Growth €39 / Pro €69 / Enterprise custom). Plata via Stripe Checkout self-serve până la Pro; Enterprise se negociază.',
      },
      {
        heading: 'Comisioane agenți',
        content: '/app/commissions calculează automat comisia pe deal-uri închise WON, conform reglilor configurate per agent.',
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy, GDPR, Securitate',
    icon: Lock,
    body: [
      {
        heading: 'Drepturile data subject (GDPR Art. 15-22)',
        content: 'Pentru orice contact, poți: exporta JSON portabil (/app/gdpr/contacts/:id/export), anonimiza („dreptul la a fi uitat" — DELETE /app/gdpr/contacts/:id). Audit log append-only păstrează istoricul tuturor acțiunilor.',
      },
      {
        heading: 'Consent tracking',
        content: '/app/consents/subject/:type/:id arată full audit trail pentru o persoană (toate consimțămintele granted/revoked, cu sursă și timestamp). Înainte de orice operațiune consent-gated (email marketing, transcripție etc.), system-ul verifică automat status-ul.',
      },
      {
        heading: 'Multi-tenant isolation',
        content: 'Defense in depth la 3 straturi: (1) middleware seteaza tenantId în AsyncLocalStorage, (2) Prisma extension auto-injectează tenantId în toate query-urile, (3) Postgres RLS forțează la nivel SQL. Chiar dacă code-ul are bug, RLS te protejează.',
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: Keyboard,
    body: [
      {
        heading: 'Globale',
        content: '⌘K / Ctrl+K = Command palette + AI intent parsing.\n⌘/ / Ctrl+/ = Search global semantic.\nEsc = Close modal / dialog.\n? = Show keyboard shortcuts (în orice listă).',
      },
      {
        heading: 'În liste',
        content: 'j / k = Next / previous row.\nEnter = Open detail.\n/ = Focus search.\nf = Focus filter.\nN = New item (where applicable).',
      },
      {
        heading: 'În forme',
        content: '⌘S / Ctrl+S = Save.\n⌘Enter / Ctrl+Enter = Submit.\nEsc = Cancel + close.',
      },
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Cum invit un nou utilizator?',
    a: 'Mergi la /app/settings/users → buton „Invită utilizator". Trimit email invitație cu link de activare. Ales rolul (OWNER / ADMIN / MANAGER / AGENT / VIEWER) controlează ce poate vedea și face.',
  },
  {
    q: 'Pot reseta wizard-ul welcome?',
    a: 'Momentan: doar prin DB direct (UPDATE tenants SET "onboardingCompletedAt" = NULL). În Settings → Avansate va apărea un buton „Resetează tour" în versiunile viitoare.',
  },
  {
    q: 'Datele de demo pot fi șterse?',
    a: 'Da, individual din lista de companii / contacte / deal-uri. Sau în masa via butonul „Șterge tot ce e marked demo" (în Settings → Avansate, când va fi implementat).',
  },
  {
    q: 'Cum schimb planul?',
    a: 'OWNER: /app/settings/billing → buton „Upgrade plan" (te duce la Stripe Customer Portal). Schimbarea e prorate-uită pe ziua curentă pentru upgrade, activă de la următoarea facturare pentru downgrade.',
  },
  {
    q: 'Pot exporta toate datele?',
    a: 'Da. /app/exports oferă export CSV/JSON pe entitate (companii, contacte, deal-uri etc.). Export GDPR per data subject (full personal data) se face din /app/gdpr.',
  },
  {
    q: 'Ce limbi sunt suportate în UI?',
    a: 'Momentan românește. Englezul vine în Faza 2 (toggle în Settings → Aspect).',
  },
  {
    q: 'Funcționează offline?',
    a: 'Parțial. PWA installable și cache-uri SW pentru shell-ul UI. Citirea datelor cache-uite funcționează offline; scrierea cere conexiune (cu retry automat).',
  },
  {
    q: 'Unde raportez un bug?',
    a: 'Email la support@amass-crm.ro sau direct din UI: butonul „?" din colțul dreapta-jos (în implementare).',
  },
];

function HelpPage(): JSX.Element {
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0]!.id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  /**
   * Re-launch a tour: mark incomplete in DB so it auto-fires when user
   * lands on the target page, invalidate the query cache, then navigate.
   */
  const relaunchTour = async (tourId: string, page: string) => {
    await toursApi.markIncomplete(tourId).catch(() => {
      // Non-fatal: even if API fails, navigation still happens
    });
    await qc.invalidateQueries({ queryKey: ['tour-progress'] });
    void navigate({ to: page });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centru de ajutor"
        subtitle="Ghiduri, tutoriale și răspunsuri la întrebări frecvente"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Sidebar nav */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <GlassCard className="p-2">
            <nav className="space-y-1">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveSection(s.id);
                    document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    activeSection === s.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <s.icon className="size-4 shrink-0" />
                  <span className="line-clamp-1">{s.title}</span>
                </a>
              ))}
              <a
                href="#tours"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('tours');
                  document.getElementById('tours')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeSection === 'tours' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Compass className="size-4 shrink-0" />
                <span>Tour-uri interactive</span>
              </a>
              <a
                href="#faq"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('faq');
                  document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeSection === 'faq' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <BookOpen className="size-4 shrink-0" />
                <span>Întrebări frecvente</span>
              </a>
              <a
                href="#contact"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('contact');
                  document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  activeSection === 'contact' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Sparkles className="size-4 shrink-0" />
                <span>Contact suport</span>
              </a>
            </nav>
          </GlassCard>
        </aside>

        {/* Content */}
        <div className="space-y-8">
          {SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-4">
              <GlassCard className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="rounded-lg bg-secondary p-2">
                    <section.icon className="size-5" />
                  </span>
                  <h2 className="text-xl font-semibold">{section.title}</h2>
                </div>
                <div className="space-y-5">
                  {section.body.map((b, i) => (
                    <div key={i}>
                      <h3 className="font-medium mb-1.5">{b.heading}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{b.content}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </section>
          ))}

          {/* Interactive tours */}
          <section id="tours" className="scroll-mt-4">
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="rounded-lg bg-secondary p-2">
                  <Compass className="size-5" />
                </span>
                <h2 className="text-xl font-semibold">Tour-uri interactive</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Apasă „Re-vezi tour-ul" pe oricare din variante de mai jos ca să-ți ghidăm
                din nou pas-cu-pas prin pagina respectivă. Tour-urile pornesc automat
                doar prima oară când vizitezi pagina, dar le poți declanșa din nou oricând.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TOUR_REGISTRY.map((tour) => (
                  <div
                    key={tour.id}
                    className="rounded-lg border border-border p-4 flex flex-col gap-2"
                  >
                    <h3 className="font-medium text-sm">{tour.title}</h3>
                    <p className="text-xs text-muted-foreground flex-1">{tour.description}</p>
                    <p className="text-xs text-muted-foreground/70">
                      {tour.steps.length} pași · pagina {tour.page}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void relaunchTour(tour.id, tour.page);
                      }}
                      className="self-start"
                    >
                      <PlayCircle className="size-4 mr-1.5" />
                      Re-vezi tour-ul
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4 italic">
                Tour-uri suplimentare vin în curând pentru fiecare modul (contacte,
                deal-uri, apeluri, oferte, facturi etc.).
              </p>
            </GlassCard>
          </section>

          {/* FAQ */}
          <section id="faq" className="scroll-mt-4">
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="rounded-lg bg-secondary p-2">
                  <BookOpen className="size-5" />
                </span>
                <h2 className="text-xl font-semibold">Întrebări frecvente</h2>
              </div>
              <div className="space-y-3">
                {FAQ.map((f, i) => (
                  <details key={i} className="group rounded-lg border border-border p-4 cursor-pointer">
                    <summary className="font-medium text-sm list-none flex items-center justify-between gap-3">
                      <span>{f.q}</span>
                      <ChevronRight className="size-4 group-open:rotate-90 transition-transform shrink-0" />
                    </summary>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                  </details>
                ))}
              </div>
            </GlassCard>
          </section>

          {/* Contact */}
          <section id="contact" className="scroll-mt-4">
            <GlassCard className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="rounded-lg bg-secondary p-2">
                  <Sparkles className="size-5" />
                </span>
                <h2 className="text-xl font-semibold">Contact suport</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Nu găsești răspunsul aici? Suntem aproape:
              </p>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="mailto:support@amass-crm.ro" className="inline-flex items-center gap-2 underline">
                    <Mail className="size-4" />
                    support@amass-crm.ro
                  </a>
                </li>
                <li>
                  <Link to="/privacy" className="inline-flex items-center gap-2 underline">
                    <Lock className="size-4" />
                    Politica de confidențialitate
                  </Link>
                </li>
                <li>
                  <Link to="/legal/subprocessors" className="inline-flex items-center gap-2 underline">
                    <Activity className="size-4" />
                    Lista sub-procesatori
                  </Link>
                </li>
                <li>
                  <a href="/pricing" className="inline-flex items-center gap-2 underline">
                    <CircleDollarSign className="size-4" />
                    Planuri și prețuri
                    <ExternalLink className="size-3" />
                  </a>
                </li>
                <li>
                  <Link to="/app/welcome" className="inline-flex items-center gap-2 underline">
                    <PartyPopper className="size-4" />
                    Re-vezi welcome wizard-ul
                  </Link>
                </li>
              </ul>
            </GlassCard>
          </section>
        </div>
      </div>
    </div>
  );
}
