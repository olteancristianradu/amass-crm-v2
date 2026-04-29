import { createRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { rootRoute } from './root';

export const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy',
  component: PrivacyPage,
});

type Lang = 'ro' | 'en';

/**
 * Public privacy policy page. Bilingual RO/EN — required for any EU SMB
 * audience. Content kept editable inline by Cristian; for changes, touch
 * the strings below and ship.
 *
 * Compliance scope: GDPR Art. 12-14 (transparency), Romanian Law 506/2004,
 * Law 190/2018 (national GDPR implementation).
 */
function PrivacyPage(): JSX.Element {
  const [lang, setLang] = useState<Lang>('ro');
  const t = lang === 'ro' ? RO : EN;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/login" className="font-semibold">AMASS CRM</Link>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setLang('ro')}
              className={`px-3 py-1 rounded ${lang === 'ro' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
            >RO</button>
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1 rounded ${lang === 'en' ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
            >EN</button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-12 prose prose-sm md:prose-base dark:prose-invert">
        <h1>{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.lastUpdated}: 2026-04-29 · v1.0</p>

        {t.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body.split('\n\n').map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </section>
        ))}

        <hr />
        <p className="text-sm">
          <Link to="/login" className="underline">← {t.backToLogin}</Link>
        </p>
      </main>
    </div>
  );
}

const RO = {
  title: 'Politica de confidențialitate',
  lastUpdated: 'Ultima actualizare',
  backToLogin: 'Înapoi la autentificare',
  sections: [
    {
      heading: '1. Operator de date și DPO',
      body: `Operatorul de date pentru această aplicație este AMASS-CRM (denumit în continuare „noi" sau „Operatorul"), reprezentat prin Cristian Radu Oltean.

Pentru orice întrebare legată de prelucrarea datelor personale, contactați-ne la: privacy@amass-crm.ro

Responsabilul cu protecția datelor (DPO): se va desemna înainte de a depăși 100 de clienți business sau de a procesa date sensibile la scară largă.`,
    },
    {
      heading: '2. Ce date colectăm',
      body: `Colectăm următoarele categorii de date personale, exclusiv în scopul furnizării serviciului CRM:

• Date de identificare ale utilizatorilor finali (administratorii contului): nume, prenume, email profesional, număr telefon, rol în firmă.

• Date introduse de clienții noștri (organizații care folosesc CRM-ul) despre propriii lor contacte/clienți: nume, email, telefon, funcție, companie, note, istoric apeluri/email-uri/întâlniri.

• Date tehnice: adresa IP, tipul de browser, jurnale de acces și activitate (necesare pentru securitate, audit și debug).

• Date de transcripție apeluri (opțional, doar dacă sunteți de acord): conținutul apelurilor cu clienții este transcris automat și rezumat de inteligență artificială pentru a asista vânzătorul.

Nu colectăm date sensibile (sănătate, religie, politică, date biometrice) decât dacă clientul nostru le introduce explicit în câmpurile de note, situație în care responsabilitatea legalității aparține Operatorului-Client (a se vedea secțiunea Sub-procesare).`,
    },
    {
      heading: '3. Baza legală a prelucrării (GDPR Art. 6)',
      body: `Pentru fiecare scop, baza legală este una dintre următoarele:

• Executarea contractului (Art. 6(1)(b)): pentru oferirea serviciului CRM contractat de Clientul-Operator.

• Interes legitim (Art. 6(1)(f)): pentru securizarea aplicației, prevenirea fraudei, păstrarea jurnalelor de audit, comunicări tehnice esențiale.

• Consimțământ (Art. 6(1)(a)): pentru transcripția apelurilor, profiling AI, marketing direct, analytics neesențial. Consimțământul poate fi revocat oricând prin email sau direct din interfața CRM.

• Obligație legală (Art. 6(1)(c)): pentru păstrarea facturilor și documentelor fiscale (10 ani conform Codul Fiscal RO).`,
    },
    {
      heading: '4. Cât timp păstrăm datele',
      body: `Perioada de păstrare diferă în funcție de tipul datei:

• Date contact/lead (CRM principal): pe durata contractului + 1 an după (configurabil per tenant).
• Înregistrări apeluri și transcripții: 90 zile implicit (configurabil per tenant).
• Jurnale de audit (security): 365 zile.
• Facturi și documente fiscale: 10 ani (obligație Cod Fiscal RO).
• Date marcate pentru ștergere prin GDPR Art. 17: anonimizate imediat (PII înlocuit cu valori anonimizate; integritate fiscală păstrată).`,
    },
    {
      heading: '5. Drepturile dumneavoastră (GDPR Art. 15-22)',
      body: `Aveți dreptul să:

• Cereți acces la datele dumneavoastră (Art. 15) — răspuns în maxim 30 zile.
• Cereți rectificarea datelor inexacte (Art. 16) — direct din interfața CRM sau prin email.
• Cereți ștergerea datelor („dreptul la a fi uitat", Art. 17) — implementat ca anonimizare pentru a păstra integritatea fiscală.
• Cereți limitarea prelucrării (Art. 18).
• Primiți datele într-un format portabil JSON (Art. 20) — endpoint dedicat în CRM.
• Vă opuneți prelucrării (Art. 21).
• Retrageți consimțământul oricând (Art. 7(3)) — fără efect asupra prelucrărilor anterioare retragerii.

Pentru exercitarea oricărui drept: privacy@amass-crm.ro

Aveți de asemenea dreptul de a depune plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro.`,
    },
    {
      heading: '6. Sub-procesatori',
      body: `Pentru furnizarea serviciului folosim următorii sub-procesatori, fiecare cu propriul DPA semnat:

Lista completă, actualizată la zi: vezi /legal/subprocessors

Pentru transferuri în afara Uniunii Europene (în special SUA pentru servicii AI), folosim Standard Contractual Clauses (SCC) ale Comisiei Europene.`,
    },
    {
      heading: '7. Securitate',
      body: `Aplicăm măsuri tehnice și organizatorice de securitate (GDPR Art. 32):

• Criptare în tranzit (TLS 1.3) și la rest (AES-256-GCM pentru secrete sensibile).
• Izolare strictă multi-tenant la 3 niveluri: middleware, ORM, baza de date (RLS Postgres).
• Controlul accesului bazat pe roluri (RBAC) cu politici de privilegiu minim.
• Autentificare cu doi factori (TOTP) disponibilă pentru toate conturile.
• Jurnale de audit append-only pentru toate acțiunile administrative.
• Monitorizare 24/7 cu alerting automat pentru anomalii de securitate.
• Backup zilnic criptat off-site.

În caz de breach, vă vom notifica în maxim 72 ore conform Art. 33-34 GDPR.`,
    },
    {
      heading: '8. Cookies',
      body: `Folosim doar cookies strict necesare pentru funcționarea aplicației (autentificare, sesiune, preferințe UI). Nu folosim cookies de tracking sau marketing fără consimțământul dumneavoastră explicit.

Pentru detalii și control, vedeți banner-ul de cookies afișat la prima vizită.`,
    },
    {
      heading: '9. Modificări ale acestei politici',
      body: `Putem actualiza această politică. Veți fi notificat prin email pentru modificări semnificative, cu cel puțin 30 zile înainte de intrarea în vigoare. Versiunea curentă și data ultimei actualizări sunt menționate la începutul acestui document.`,
    },
  ],
};

const EN = {
  title: 'Privacy Policy',
  lastUpdated: 'Last updated',
  backToLogin: 'Back to login',
  sections: [
    {
      heading: '1. Data Controller and DPO',
      body: `The data controller for this application is AMASS-CRM (hereinafter "we" or the "Controller"), represented by Cristian Radu Oltean.

For any questions regarding personal data processing, contact us at: privacy@amass-crm.ro

Data Protection Officer (DPO): to be appointed before exceeding 100 business customers or processing sensitive data at large scale.`,
    },
    {
      heading: '2. What data we collect',
      body: `We collect the following categories of personal data, solely for providing the CRM service:

• Identification data of end users (account administrators): first name, last name, business email, phone number, role.

• Data entered by our customers (organizations using the CRM) about their own contacts/clients: name, email, phone, job title, company, notes, history of calls/emails/meetings.

• Technical data: IP address, browser type, access logs and activity (needed for security, audit and debugging).

• Call transcription data (optional, only if you consent): call content with customers is automatically transcribed and summarized by AI to assist the salesperson.

We do not collect sensitive data (health, religion, politics, biometrics) unless our customer explicitly enters them in note fields, in which case the legality is the responsibility of the Customer-Controller (see Sub-processing section).`,
    },
    {
      heading: '3. Lawful basis (GDPR Art. 6)',
      body: `For each purpose, the lawful basis is one of the following:

• Performance of contract (Art. 6(1)(b)): for delivering the CRM service contracted by the Customer-Controller.

• Legitimate interest (Art. 6(1)(f)): for application security, fraud prevention, audit log retention, essential technical communications.

• Consent (Art. 6(1)(a)): for call transcription, AI profiling, direct marketing, non-essential analytics. Consent can be revoked at any time via email or directly from the CRM interface.

• Legal obligation (Art. 6(1)(c)): for retention of invoices and tax documents (10 years per Romanian Fiscal Code).`,
    },
    {
      heading: '4. Data retention period',
      body: `Retention period varies by data type:

• Contact/lead data (main CRM): for the contract duration + 1 year after (configurable per tenant).
• Call recordings and transcripts: 90 days default (configurable per tenant).
• Audit logs (security): 365 days.
• Invoices and tax documents: 10 years (Romanian Fiscal Code obligation).
• Data marked for erasure under GDPR Art. 17: immediately anonymized (PII replaced with anonymized values; fiscal integrity preserved).`,
    },
    {
      heading: '5. Your rights (GDPR Art. 15-22)',
      body: `You have the right to:

• Request access to your data (Art. 15) — response within 30 days max.
• Request rectification of inaccurate data (Art. 16) — directly from the CRM interface or via email.
• Request erasure ("right to be forgotten", Art. 17) — implemented as anonymization to preserve fiscal integrity.
• Request restriction of processing (Art. 18).
• Receive your data in a portable JSON format (Art. 20) — dedicated endpoint in CRM.
• Object to processing (Art. 21).
• Withdraw consent at any time (Art. 7(3)) — without affecting prior processing.

To exercise any right: privacy@amass-crm.ro

You also have the right to lodge a complaint with the Romanian National Supervisory Authority for Personal Data Processing (ANSPDCP), www.dataprotection.ro.`,
    },
    {
      heading: '6. Sub-processors',
      body: `For service delivery we use the following sub-processors, each with their own signed DPA:

Full up-to-date list: see /legal/subprocessors

For transfers outside the European Union (specifically to the US for AI services), we use Standard Contractual Clauses (SCC) of the European Commission.`,
    },
    {
      heading: '7. Security',
      body: `We apply technical and organizational security measures (GDPR Art. 32):

• Encryption in transit (TLS 1.3) and at rest (AES-256-GCM for sensitive secrets).
• Strict multi-tenant isolation at 3 layers: middleware, ORM, database (Postgres RLS).
• Role-based access control (RBAC) with least-privilege policies.
• Two-factor authentication (TOTP) available for all accounts.
• Append-only audit logs for all administrative actions.
• 24/7 monitoring with automatic alerting for security anomalies.
• Daily encrypted off-site backups.

In case of a breach, we will notify you within 72 hours per Art. 33-34 GDPR.`,
    },
    {
      heading: '8. Cookies',
      body: `We only use strictly necessary cookies for application operation (authentication, session, UI preferences). We do not use tracking or marketing cookies without your explicit consent.

For details and controls, see the cookie banner displayed on first visit.`,
    },
    {
      heading: '9. Changes to this policy',
      body: `We may update this policy. You will be notified by email for significant changes, at least 30 days before they take effect. The current version and last update date are mentioned at the beginning of this document.`,
    },
  ],
};
