import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';

export const subprocessorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/legal/subprocessors',
  component: SubprocessorsPage,
});

interface Subprocessor {
  name: string;
  purpose: string;
  dataType: string;
  location: string;
  scc?: string;
  websiteUrl: string;
}

const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Anthropic (Claude API)',
    purpose: 'AI processing — call summaries, email drafts, lead scoring',
    dataType: 'Call transcripts (PII redacted), email drafts, deal context',
    location: 'United States',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://www.anthropic.com/legal/privacy',
  },
  {
    name: 'Google (Gemini API)',
    purpose: 'AI processing — alternative provider for AI features',
    dataType: 'Same as Anthropic when used as fallback',
    location: 'United States',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://policies.google.com/privacy',
  },
  {
    name: 'OpenAI',
    purpose: 'Vector embeddings for semantic search',
    dataType: 'Text content from contacts/companies/deals (no raw PII)',
    location: 'United States',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://openai.com/policies/privacy-policy',
  },
  {
    name: 'Twilio',
    purpose: 'Voice calls (SIP), SMS, WhatsApp Business API',
    dataType: 'Phone numbers, call recordings, SMS/WhatsApp message content',
    location: 'United States / EU (depending on number)',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://www.twilio.com/legal/privacy',
  },
  {
    name: 'Stripe',
    purpose: 'Payment processing for SaaS subscriptions',
    dataType: 'Billing details, payment method (no card numbers stored by us)',
    location: 'United States / Ireland',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://stripe.com/privacy',
  },
  {
    name: 'SendGrid (Twilio)',
    purpose: 'Transactional email delivery',
    dataType: 'Email recipient addresses and message content',
    location: 'United States',
    scc: 'EU SCC 2021/914',
    websiteUrl: 'https://www.twilio.com/legal/privacy',
  },
  {
    name: 'Cloudflare',
    purpose: 'CDN, DDoS protection, DNS',
    dataType: 'IP addresses, request metadata (caching/security)',
    location: 'Global edge network (EU servers preferred)',
    websiteUrl: 'https://www.cloudflare.com/privacypolicy/',
  },
  {
    name: 'Railway',
    purpose: 'Application and database hosting',
    dataType: 'All application data (encrypted at rest)',
    location: 'European Union (Frankfurt / Amsterdam region)',
    websiteUrl: 'https://railway.com/legal/privacy',
  },
];

function SubprocessorsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link to="/login" className="font-semibold">AMASS CRM</Link>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Sub-processors</h1>
        <p className="text-muted-foreground mb-6">
          Last updated: 2026-04-29 · We will notify customers via email at least 30 days before adding any new sub-processor.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full border border-border rounded-lg text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Purpose</th>
                <th className="px-3 py-2 text-left">Data type</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Transfer mechanism</th>
                <th className="px-3 py-2 text-left">Privacy policy</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2">{s.purpose}</td>
                  <td className="px-3 py-2">{s.dataType}</td>
                  <td className="px-3 py-2">{s.location}</td>
                  <td className="px-3 py-2">{s.scc ?? 'N/A (EU only)'}</td>
                  <td className="px-3 py-2">
                    <a href={s.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Link
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 text-sm">
          <Link to="/privacy" className="underline">← Back to privacy policy</Link>
        </p>
      </main>
    </div>
  );
}
