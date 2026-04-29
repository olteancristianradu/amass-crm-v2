import { useState } from 'react';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  Database,
  Loader2,
  PartyPopper,
  PhoneCall,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';

interface OnboardingStatus {
  onboardingCompletedAt: string | null;
  sampleDataLoadedAt: string | null;
}

interface SampleDataResult {
  companies: number;
  contacts: number;
  deals: number;
  alreadyLoaded: boolean;
}

/**
 * F1.9 — First-login welcome wizard. Shown to a tenant whose
 * onboardingCompletedAt is null. Completing the wizard sets that timestamp
 * via POST /onboarding/complete and the user lands on the dashboard.
 *
 * 4 steps:
 *   1. Greeting + features overview
 *   2. Quick capabilities tour
 *   3. Sample data (optional, OWNER-only — others see read-only state)
 *   4. Finish → mark complete → redirect to /app
 *
 * Route is gated server-side too: the OWNER-only POST endpoints will 403
 * a non-OWNER who somehow lands here.
 */
export const welcomeRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: 'welcome',
  beforeLoad: async () => {
    // If onboarding already done → bounce straight to dashboard
    try {
      const s = await api.get<OnboardingStatus>('/onboarding/status');
      if (s.onboardingCompletedAt) throw redirect({ to: '/app' });
    } catch (err) {
      // Network / 403 (rare) — let the page render and surface its own error
      if (err && typeof err === 'object' && 'to' in err) throw err;
    }
  },
  component: WelcomePage,
});

function WelcomePage(): JSX.Element {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER';

  const status = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => api.get<OnboardingStatus>('/onboarding/status'),
  });

  const loadSample = useMutation({
    mutationFn: () => api.post<SampleDataResult>('/onboarding/load-sample-data'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['onboarding-status'] });
    },
  });

  const complete = useMutation({
    mutationFn: () => api.post('/onboarding/complete'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['onboarding-status'] });
      void navigate({ to: '/app' });
    },
  });

  const sampleLoaded = !!status.data?.sampleDataLoadedAt;

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="rounded-xl border border-border bg-card shadow-sm p-8">
        <ProgressBar current={step} total={4} />

        {step === 0 && <StepWelcome onNext={() => setStep(1)} userName={user?.fullName ?? user?.email ?? ''} />}
        {step === 1 && <StepFeatures onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && (
          <StepSampleData
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            isOwner={isOwner}
            sampleLoaded={sampleLoaded}
            onLoadSample={() => loadSample.mutate()}
            loadingSample={loadSample.isPending}
            sampleResult={loadSample.data ?? null}
            sampleError={loadSample.error}
          />
        )}
        {step === 3 && (
          <StepFinish
            onBack={() => setStep(2)}
            onComplete={() => complete.mutate()}
            completing={complete.isPending}
            completeError={complete.error}
            isOwner={isOwner}
          />
        )}
      </div>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }): JSX.Element {
  return (
    <div className="mb-8">
      <div className="flex justify-between text-xs text-muted-foreground mb-2">
        <span>Pasul {current + 1} din {total}</span>
        <span>{Math.round(((current + 1) / total) * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-foreground transition-all duration-300"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepWelcome({ onNext, userName }: { onNext: () => void; userName: string }): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <PartyPopper className="size-10 text-foreground" />
        <h1 className="text-2xl font-bold">Bine ai venit{userName ? `, ${userName.split(' ')[0]}` : ''}!</h1>
      </div>
      <p className="text-muted-foreground leading-relaxed">
        AMASS CRM e gata de folosit. În următorii 2 minute, îți arăt cele mai importante
        capabilități și îți dau opțiunea să adaugi date de demo ca să poți explora rapid.
      </p>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> Multi-tenant cu izolare la 3 straturi (RLS Postgres + Cedar + audit)</li>
        <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> Voice intelligence (transcripție + AI summary apeluri)</li>
        <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> ANAF e-Factura built-in (UBL 2.1)</li>
        <li className="flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500" /> GDPR-ready (consent tracking, audit log append-only)</li>
      </ul>
      <div className="flex justify-end pt-4">
        <Button onClick={onNext}>Începem →</Button>
      </div>
    </div>
  );
}

function StepFeatures({ onNext, onBack }: { onNext: () => void; onBack: () => void }): JSX.Element {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Capabilitățile principale</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard icon={Building2} title="Companii & Contacte" body="Gestionează firme și persoane cu istoric complet, embeddinguri AI pentru căutare semantică și polymorphic notes/reminders." />
        <FeatureCard icon={Users} title="Pipeline Deal-uri" body="Kanban drag-and-drop pe etape configurabile. Probabilități de win, valori multi-currency, închidere automată." />
        <FeatureCard icon={PhoneCall} title="Apeluri & Voice AI" body="Twilio + Whisper transcripție RO + Claude summary 3-puncte. Redactare PII automată cu Presidio (opt-in)." />
        <FeatureCard icon={Sparkles} title="Cmd-K Intent" body="Tastează ce vrei într-un text box (ex: «sună Acme mâine»), AI parsează în acțiune concretă cu draft pre-completat." />
        <FeatureCard icon={Zap} title="Workflows" body="Trigger pe events (deal_won, contact_created etc) → acțiuni automate (email, task, webhook outbound)." />
        <FeatureCard icon={Database} title="Audit & GDPR" body="Audit log append-only la nivel DB. Right to erasure (anonimizare), portabilitate (JSON export), consent granular." />
      </div>
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>← Înapoi</Button>
        <Button onClick={onNext}>Continuă →</Button>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-border p-4 bg-background/40">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-foreground/70" />
        <h3 className="font-medium text-sm">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function StepSampleData({
  onNext, onBack, isOwner, sampleLoaded, onLoadSample, loadingSample, sampleResult, sampleError,
}: {
  onNext: () => void;
  onBack: () => void;
  isOwner: boolean;
  sampleLoaded: boolean;
  onLoadSample: () => void;
  loadingSample: boolean;
  sampleResult: SampleDataResult | null;
  sampleError: unknown;
}): JSX.Element {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Date de demo (opțional)</h2>
      <p className="text-muted-foreground text-sm leading-relaxed">
        Dacă vrei să explorezi imediat fără să introduci date manual, pot adăuga
        <strong> 30 de companii, ~50 de contacte și ~20 de deal-uri</strong> demo
        scoped la tenant-ul tău. Datele sunt clar marcate (RO99000001+) ca să le poți
        identifica ulterior. Vor fi vizibile în liste alături de datele tale reale.
      </p>

      {sampleLoaded || sampleResult?.alreadyLoaded ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <CheckCircle2 className="size-5 text-emerald-500 inline mr-2" />
          Datele de demo au fost deja încărcate.
        </div>
      ) : sampleResult ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <CheckCircle2 className="size-5 text-emerald-500 inline mr-2" />
          Adăugat: <strong>{sampleResult.companies}</strong> companii,{' '}
          <strong>{sampleResult.contacts}</strong> contacte,{' '}
          <strong>{sampleResult.deals}</strong> deal-uri.
        </div>
      ) : null}

      {sampleError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Eroare la încărcare: {String((sampleError as Error).message ?? sampleError)}
        </div>
      ) : null}

      {!isOwner ? (
        <p className="text-xs text-muted-foreground italic">
          Doar OWNER-ul tenant-ului poate încărca date de demo. Continuă fără pentru a finaliza tour-ul.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>← Înapoi</Button>
        <div className="flex gap-2">
          {isOwner && !sampleLoaded && !sampleResult ? (
            <Button variant="outline" onClick={onLoadSample} disabled={loadingSample}>
              {loadingSample ? <><Loader2 className="size-4 animate-spin mr-2" />Se încarcă…</> : 'Încarcă date demo'}
            </Button>
          ) : null}
          <Button onClick={onNext}>{sampleLoaded || sampleResult ? 'Continuă →' : 'Sari peste'}</Button>
        </div>
      </div>
    </div>
  );
}

function StepFinish({
  onBack, onComplete, completing, completeError, isOwner,
}: {
  onBack: () => void;
  onComplete: () => void;
  completing: boolean;
  completeError: unknown;
  isOwner: boolean;
}): JSX.Element {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-10 text-emerald-500" />
        <h2 className="text-2xl font-bold">Gata!</h2>
      </div>
      <p className="text-muted-foreground leading-relaxed">
        Ești pregătit să folosești AMASS CRM. Apăsând <strong>„Finalizează"</strong>, marchezi
        onboarding-ul ca terminat și mergi direct la dashboard.
      </p>
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>📍 <strong>Dashboard</strong> e prima ta destinație — vezi KPI-uri în timp real.</li>
        <li>📍 <strong>Cmd-K</strong> oriunde îți deschide command palette cu AI intent parsing.</li>
        <li>📍 <strong>Setări</strong> găsești config-uri pentru email, telefon, calendar, billing.</li>
      </ul>
      {completeError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Eroare: {String((completeError as Error).message ?? completeError)}
          {!isOwner ? <p className="mt-2 text-xs">Notă: doar OWNER-ul tenant-ului poate finaliza wizard-ul.</p> : null}
        </div>
      ) : null}
      <div className="flex justify-between pt-4">
        <Button variant="outline" onClick={onBack}>← Înapoi</Button>
        <Button onClick={onComplete} disabled={completing}>
          {completing ? <><Loader2 className="size-4 animate-spin mr-2" />Se finalizează…</> : 'Finalizează →'}
        </Button>
      </div>
    </div>
  );
}
