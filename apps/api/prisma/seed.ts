/**
 * Seed script — creates demo tenant + test accounts for QA / onboarding.
 *
 * Idempotent (upsert). Safe to run multiple times.
 *
 * CONTURI CREATE:
 *   OWNER  admin@amass-demo.ro  / AmassCRM2026!
 *   AGENT  agent@amass-demo.ro  / AmassCRM2026!
 *
 * DATE DEMO:
 *   - 3 companii + contacte
 *   - 4 deal-uri în etape diferite ale pipeline-ului
 *   - 1 apel pe Alfa Tech SRL cu transcript complet + PII redactat
 *   - 1 politică de aprobare: oferte peste 5.000 EUR cer semnătura managerului
 */

import {
  PrismaClient,
  UserRole,
  ApprovalPolicyTrigger,
  CallDirection,
  CallStatus,
  TranscriptionStatus,
  SubjectType,
  TaskStatus,
  TaskPriority,
  InvoiceStatus,
  InvoiceCurrency,
  LeadStatus,
  LeadSource,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_SLUG = 'demo';
const TENANT_NAME = 'AMASS Demo SRL';
const PASSWORD = 'AmassCRM2026!';

const ACCOUNTS: { email: string; fullName: string; role: UserRole }[] = [
  { email: 'admin@amass-demo.ro', fullName: 'Administrator Demo', role: UserRole.OWNER },
  { email: 'agent@amass-demo.ro', fullName: 'Agent Vanzari Demo', role: UserRole.AGENT },
  { email: 'danarulea@test.ro', fullName: 'Dana Rulea', role: UserRole.OWNER },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ── Tenant ─────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME },
    create: { name: TENANT_NAME, slug: TENANT_SLUG },
  });
  // eslint-disable-next-line no-console
  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})`);

  // ── Default pipeline ───────────────────────────────────────────────────────
  let pipeline = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, isDefault: true },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  if (!pipeline) {
    const created = await prisma.pipeline.create({
      data: { tenantId: tenant.id, name: 'Vânzări', isDefault: true, order: 0 },
    });
    await prisma.pipelineStage.createMany({
      data: [
        { tenantId: tenant.id, pipelineId: created.id, name: 'Nou', type: 'OPEN', order: 0, probability: 10 },
        { tenantId: tenant.id, pipelineId: created.id, name: 'Calificat', type: 'OPEN', order: 10, probability: 30 },
        { tenantId: tenant.id, pipelineId: created.id, name: 'Negociere', type: 'OPEN', order: 20, probability: 60 },
        { tenantId: tenant.id, pipelineId: created.id, name: 'Câștigat', type: 'WON', order: 30, probability: 100 },
        { tenantId: tenant.id, pipelineId: created.id, name: 'Pierdut', type: 'LOST', order: 40, probability: 0 },
      ],
    });
    pipeline = await prisma.pipeline.findFirst({
      where: { tenantId: tenant.id, isDefault: true },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    // eslint-disable-next-line no-console
    console.log('✓ Pipeline default setat (5 etape)');
  } else {
    // eslint-disable-next-line no-console
    console.log('✓ Pipeline default existent');
  }

  const stages = pipeline!.stages;
  const stageNou = stages[0];
  const stageCalificat = stages[1];
  const stageNegociere = stages[2];

  // ── Users ──────────────────────────────────────────────────────────────────
  const users: Record<string, { id: string }> = {};
  for (const acc of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: acc.email } },
      update: { passwordHash, fullName: acc.fullName, role: acc.role, isActive: true },
      create: { tenantId: tenant.id, ...acc, passwordHash, isActive: true },
    });
    users[acc.role] = { id: user.id };
    // eslint-disable-next-line no-console
    console.log(`✓ User [${user.role}]: ${user.email}`);
  }

  const agentId = users[UserRole.AGENT]?.id;

  // ── Demo companies + contacts ──────────────────────────────────────────────
  const demoCompanies = [
    {
      company: { name: 'Alfa Tech SRL', vatNumber: 'RO12345678', industry: 'Tehnologie IT', city: 'Cluj-Napoca', relationshipStatus: 'ACTIVE' as const, leadSource: 'REFERRAL' as const },
      contact: { firstName: 'Andrei', lastName: 'Ionescu', jobTitle: 'Director General', email: 'andrei.ionescu@alfatech.ro', isDecider: true },
    },
    {
      company: { name: 'Beta Construct SA', vatNumber: 'RO87654321', industry: 'Construcții', city: 'București', relationshipStatus: 'PROSPECT' as const, leadSource: 'WEB' as const },
      contact: { firstName: 'Maria', lastName: 'Popescu', jobTitle: 'Director Financiar', email: 'maria.popescu@betaconstruct.ro', isDecider: true },
    },
    {
      company: { name: 'Gamma Logistics SRL', vatNumber: 'RO11223344', industry: 'Logistică', city: 'Timișoara', relationshipStatus: 'LEAD' as const, leadSource: 'COLD_CALL' as const },
      contact: { firstName: 'Cosmin', lastName: 'Radu', jobTitle: 'Manager Achiziții', email: 'cosmin.radu@gammalogistics.ro', isDecider: false },
    },
  ];

  const companyIds: Record<string, string> = {};
  for (const { company, contact } of demoCompanies) {
    let existing = await prisma.company.findFirst({
      where: { tenantId: tenant.id, vatNumber: company.vatNumber },
    });
    if (!existing) {
      existing = await prisma.company.create({
        data: { tenantId: tenant.id, ...company, country: 'RO' },
      });
      await prisma.contact.create({
        data: { tenantId: tenant.id, companyId: existing.id, ...contact },
      });
      // eslint-disable-next-line no-console
      console.log(`✓ Companie demo: ${existing.name}`);
    }
    companyIds[company.vatNumber] = existing.id;
  }

  const alfaTechId = companyIds['RO12345678'];
  const betaConstructId = companyIds['RO87654321'];
  const gammaLogisticsId = companyIds['RO11223344'];

  // ── Demo deals (4 deal-uri în etape diferite) ──────────────────────────────
  const existingDeals = await prisma.deal.count({ where: { tenantId: tenant.id } });
  if (existingDeals === 0 && stageNou && stageCalificat && stageNegociere) {
    await prisma.deal.createMany({
      data: [
        {
          tenantId: tenant.id,
          pipelineId: pipeline!.id,
          stageId: stageNou.id,
          companyId: gammaLogisticsId,
          ownerId: agentId,
          title: 'Sistem ERP Logistică',
          value: 8500,
          currency: 'EUR',
          probability: 10,
          expectedCloseAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
          orderInStage: 0,
        },
        {
          tenantId: tenant.id,
          pipelineId: pipeline!.id,
          stageId: stageCalificat.id,
          companyId: betaConstructId,
          ownerId: agentId,
          title: 'Software Devize Construcții',
          value: 3200,
          currency: 'EUR',
          probability: 30,
          expectedCloseAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          orderInStage: 0,
        },
        {
          tenantId: tenant.id,
          pipelineId: pipeline!.id,
          stageId: stageNegociere.id,
          companyId: alfaTechId,
          ownerId: agentId,
          title: 'Licențe Software Enterprise 50 utilizatori',
          value: 12000,
          currency: 'EUR',
          probability: 60,
          expectedCloseAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          orderInStage: 0,
        },
        {
          tenantId: tenant.id,
          pipelineId: pipeline!.id,
          stageId: stageNegociere.id,
          companyId: betaConstructId,
          ownerId: agentId,
          title: 'Modul CRM Teren (mobil)',
          value: 1800,
          currency: 'EUR',
          probability: 65,
          expectedCloseAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          orderInStage: 1,
        },
      ],
    });
    // eslint-disable-next-line no-console
    console.log('✓ 4 deal-uri demo create (pipeline Kanban populat)');
  } else {
    // eslint-disable-next-line no-console
    console.log(`✓ Deal-uri demo existente (${existingDeals})`);
  }

  // ── Demo call cu transcript + PII redactat (Alfa Tech SRL) ─────────────────
  const existingCall = await prisma.call.findFirst({
    where: { tenantId: tenant.id, subjectType: SubjectType.COMPANY, subjectId: alfaTechId },
  });
  if (!existingCall && alfaTechId) {
    const callStartedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // acum 2 zile
    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        subjectType: SubjectType.COMPANY,
        subjectId: alfaTechId,
        userId: agentId,
        direction: CallDirection.OUTBOUND,
        status: CallStatus.COMPLETED,
        fromNumber: '+40312000001',
        toNumber: '+40712345678',
        startedAt: callStartedAt,
        answeredAt: new Date(callStartedAt.getTime() + 8000),
        endedAt: new Date(callStartedAt.getTime() + 8 * 60 * 1000),
        durationSec: 7 * 60 + 52,
        transcriptionStatus: TranscriptionStatus.COMPLETED,
      },
    });

    // Transcript cu segmente care conțin PII redactat ca pill-uri
    await prisma.callTranscript.create({
      data: {
        tenantId: tenant.id,
        callId: call.id,
        language: 'ro',
        rawText: 'Bună ziua, mă numesc Andrei Ionescu, CNP: 1850412123456, și v-am trimis oferta pe email andrei.ionescu@alfatech.ro. Contul nostru IBAN RO49AAAA1B31007593840000.',
        redactedText: 'Bună ziua, mă numesc Andrei Ionescu, CNP: [CNP_REDACTAT], și v-am trimis oferta pe email [EMAIL_REDACTAT]. Contul nostru IBAN [IBAN_REDACTAT].',
        segments: [
          { start: 0, end: 4, speaker: 'agent', text: 'Bună ziua, domnule Ionescu! Am verificat oferta dumneavoastră și sunt gata să discutăm condițiile.' },
          { start: 4, end: 12, speaker: 'customer', text: 'Da, vă mulțumesc că ați sunat. CNP-ul meu este [CNP_REDACTAT] pentru contract. Și emailul meu de facturare este [EMAIL_REDACTAT].' },
          { start: 12, end: 22, speaker: 'agent', text: 'Perfect, am notat. Referitor la prețul de 12.000 EUR pentru 50 de licențe — puteți confirma că bugetul este aprobat la dumneavoastră?' },
          { start: 22, end: 35, speaker: 'customer', text: 'Da, e aprobat. Plata ar fi virament bancar. IBAN-ul nostru este [IBAN_REDACTAT]. Termenul de plată 30 de zile.' },
          { start: 35, end: 45, speaker: 'agent', text: 'Înțeleg. Vom trimite factura cu IBAN-ul dumneavoastră notat. Termenul de livrare licențe este 3 zile lucrătoare de la semnare.' },
          { start: 45, end: 58, speaker: 'customer', text: 'Sună bine. Puteți trimite contractul pe email și îl semnăm digital?' },
          { start: 58, end: 68, speaker: 'agent', text: 'Desigur, îl trimit azi. O zi bună!' },
        ],
        summary: 'Client confirmat buget 12.000 EUR pentru 50 licențe enterprise. A furnizat date de facturare (IBAN și email redactate). Solicitat contract digital pentru semnare. Termen plată 30 zile. Acțiuni: trimitere contract, confirmare IBAN intern.',
        actionItems: [
          'Trimite contractul digital pe email clientului',
          'Înregistrează IBAN-ul clientului în sistemul de facturare',
          'Urmărire semnare contract — termen 3 zile',
        ],
        sentiment: 'positive',
        topics: ['contract', 'facturare', 'licente', 'plata'],
        scriptComplianceScore: 73,
        scriptMissedItems: [
          'Nu a menționat garanția de 12 luni',
          'Nu a obținut o dată fermă de semnare a contractului',
        ],
        model: 'claude-sonnet-4-6',
        processedAt: new Date(callStartedAt.getTime() + 10 * 60 * 1000),
      },
    });
    // eslint-disable-next-line no-console
    console.log('✓ Apel demo cu transcript + PII redactat creat (Alfa Tech SRL)');
  } else {
    // eslint-disable-next-line no-console
    console.log('✓ Apel demo existent');
  }

  // ── Approval policy: oferte peste 5.000 EUR cer aprobare manager ───────────
  const existingPolicy = await prisma.approvalPolicy.findFirst({
    where: { tenantId: tenant.id, trigger: ApprovalPolicyTrigger.QUOTE_ABOVE_VALUE, deletedAt: null },
  });
  if (!existingPolicy) {
    await prisma.approvalPolicy.create({
      data: {
        tenantId: tenant.id,
        name: 'Aprobare oferte > 5.000 EUR',
        trigger: ApprovalPolicyTrigger.QUOTE_ABOVE_VALUE,
        config: { threshold: 5000, currency: 'EUR' },
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log('✓ Politică aprobare: oferte > 5.000 EUR');
  } else {
    // eslint-disable-next-line no-console
    console.log('✓ Politică aprobare existentă');
  }

  // ── Demo tags ──────────────────────────────────────────────────────────────
  const existingTagCount = await prisma.tag.count({ where: { tenantId: tenant.id } });
  if (existingTagCount === 0) {
    const tagDefs = [
      { name: 'VIP', color: '#f59e0b' },
      { name: 'Urgent', color: '#ef4444' },
      { name: 'Enterprise', color: '#6366f1' },
      { name: 'Partener', color: '#10b981' },
    ];
    const createdTags: { id: string; name: string }[] = [];
    for (const t of tagDefs) {
      const tag = await prisma.tag.create({ data: { tenantId: tenant.id, ...t } });
      createdTags.push({ id: tag.id, name: t.name });
    }
    const vipTag = createdTags.find((t) => t.name === 'VIP')!;
    const enterpriseTag = createdTags.find((t) => t.name === 'Enterprise')!;
    const urgentTag = createdTags.find((t) => t.name === 'Urgent')!;
    await prisma.entityTag.createMany({
      data: [
        { tenantId: tenant.id, tagId: vipTag.id, entityType: 'COMPANY', entityId: alfaTechId },
        { tenantId: tenant.id, tagId: enterpriseTag.id, entityType: 'COMPANY', entityId: alfaTechId },
        { tenantId: tenant.id, tagId: urgentTag.id, entityType: 'COMPANY', entityId: betaConstructId },
        { tenantId: tenant.id, tagId: vipTag.id, entityType: 'COMPANY', entityId: betaConstructId },
      ],
      skipDuplicates: true,
    });
    console.log('✓ 4 tag-uri demo create + asociate cu companii');
  }

  // ── Demo notes ─────────────────────────────────────────────────────────────
  const existingNoteCount = await prisma.note.count({ where: { tenantId: tenant.id } });
  if (existingNoteCount === 0) {
    await prisma.note.createMany({
      data: [
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: alfaTechId,
          authorId: agentId,
          body: 'Director Ionescu a confirmat verbal că bugetul de 12.000 EUR este aprobat de board. Solicitat contract digital. Prioritate maximă.',
        },
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: betaConstructId,
          authorId: agentId,
          body: 'Discuție inițiată cu Maria Popescu. Interesată de modulul de devize integrat. Programat demo tehnic pentru săptămâna viitoare.',
        },
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: gammaLogisticsId,
          authorId: agentId,
          body: 'Contact rece identificat la expo logistică. Cosmin Radu manager achiziții, caută soluție ERP cu modul transport. Follow-up planificat.',
        },
      ],
    });
    console.log('✓ 3 note demo create');
  }

  // ── Demo tasks ─────────────────────────────────────────────────────────────
  const existingTaskCount = await prisma.task.count({ where: { tenantId: tenant.id } });
  if (existingTaskCount === 0) {
    const deals = await prisma.deal.findMany({ where: { tenantId: tenant.id }, take: 2 });
    await prisma.task.createMany({
      data: [
        {
          tenantId: tenant.id,
          title: 'Trimite contractul Alfa Tech pentru semnare digitală',
          priority: TaskPriority.HIGH,
          status: TaskStatus.OPEN,
          assigneeId: agentId,
          dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          ...(deals[2] ? { dealId: deals[2].id } : { subjectType: SubjectType.COMPANY, subjectId: alfaTechId }),
        },
        {
          tenantId: tenant.id,
          title: 'Pregătire demo tehnic Beta Construct',
          priority: TaskPriority.NORMAL,
          status: TaskStatus.OPEN,
          assigneeId: agentId,
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          subjectType: SubjectType.COMPANY,
          subjectId: betaConstructId,
        },
        {
          tenantId: tenant.id,
          title: 'Verificare documente onboarding Gamma Logistics',
          priority: TaskPriority.LOW,
          status: TaskStatus.OPEN,
          assigneeId: agentId,
          dueAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          subjectType: SubjectType.COMPANY,
          subjectId: gammaLogisticsId,
        },
        {
          tenantId: tenant.id,
          title: 'Review raport lunar vânzări',
          priority: TaskPriority.NORMAL,
          status: TaskStatus.DONE,
          assigneeId: agentId,
          completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    console.log('✓ 4 task-uri demo create');
  }

  // ── Demo reminders ─────────────────────────────────────────────────────────
  const existingReminderCount = await prisma.reminder.count({ where: { tenantId: tenant.id } });
  if (existingReminderCount === 0) {
    await prisma.reminder.createMany({
      data: [
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: alfaTechId,
          actorId: agentId,
          title: 'Follow-up semnare contract Alfa Tech',
          body: 'Verifică dacă contractul a fost semnat și trimite copie la contabilitate.',
          remindAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: betaConstructId,
          actorId: agentId,
          title: 'Apel de calificare Beta Construct',
          body: 'Sunați Maria Popescu să confirmați participarea la demo tehnic.',
          remindAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        },
        {
          tenantId: tenant.id,
          subjectType: SubjectType.COMPANY,
          subjectId: gammaLogisticsId,
          actorId: agentId,
          title: 'Re-contact Gamma Logistics',
          body: 'A trecut 2 săptămâni de la primul contact. Reactivare lead.',
          remindAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        },
      ],
    });
    console.log('✓ 3 reminder-uri demo create');
  }

  // ── Demo leads ─────────────────────────────────────────────────────────────
  const existingLeadCount = await prisma.lead.count({ where: { tenantId: tenant.id } });
  if (existingLeadCount === 0) {
    await prisma.lead.createMany({
      data: [
        {
          tenantId: tenant.id,
          firstName: 'Ioana',
          lastName: 'Mihalache',
          email: 'ioana.mihalache@deltasoft.ro',
          company: 'Delta Software SRL',
          jobTitle: 'CEO',
          source: LeadSource.WEB,
          status: LeadStatus.NEW,
          score: 85,
          ownerId: agentId,
          notes: 'Completat formularul de contact pentru demo. Companie 80 angajați.',
        },
        {
          tenantId: tenant.id,
          firstName: 'Vlad',
          lastName: 'Constantin',
          email: 'vlad.constantin@epsilonmed.ro',
          company: 'Epsilon Medical SA',
          jobTitle: 'Director IT',
          source: LeadSource.EVENT,
          status: LeadStatus.CONTACTED,
          score: 72,
          ownerId: agentId,
          notes: 'Întâlnit la Health Tech Summit. Caută soluție CRM pentru echipa de vânzări medicamente.',
        },
        {
          tenantId: tenant.id,
          firstName: 'Roxana',
          lastName: 'Stoica',
          email: 'roxana.stoica@zetaretail.ro',
          company: 'Zeta Retail Group',
          jobTitle: 'Manager Operațional',
          source: LeadSource.REFERRAL,
          status: LeadStatus.QUALIFIED,
          score: 91,
          ownerId: agentId,
          notes: 'Referată de Alfa Tech. Rețea de 12 magazine, buget confirmat 8-10k EUR/an.',
        },
      ],
    });
    console.log('✓ 3 lead-uri demo create');
  }

  // ── Demo invoices ──────────────────────────────────────────────────────────
  const existingInvoiceCount = await prisma.invoice.count({ where: { tenantId: tenant.id } });
  if (existingInvoiceCount === 0) {
    const deals = await prisma.deal.findMany({ where: { tenantId: tenant.id }, take: 4 });
    const alfaDeal = deals.find((d) => d.companyId === alfaTechId);
    const betaDeal = deals.find((d) => d.companyId === betaConstructId);

    const inv1 = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        companyId: alfaTechId,
        dealId: alfaDeal?.id,
        series: 'FC',
        number: 1,
        issueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        subtotal: 12000,
        vatAmount: 2280,
        total: 14280,
        currency: InvoiceCurrency.EUR,
        status: InvoiceStatus.ISSUED,
        notes: 'Licențe software enterprise 50 utilizatori — contract semnat 2026-04-23',
      },
    });
    await prisma.invoiceLine.create({
      data: {
        tenantId: tenant.id,
        invoiceId: inv1.id,
        position: 0,
        description: 'Licențe software enterprise (50 utilizatori × 240 EUR)',
        quantity: 50,
        unitPrice: 240,
        vatRate: 19,
        subtotal: 12000,
        vatAmount: 2280,
        total: 14280,
      },
    });

    if (betaDeal) {
      const inv2 = await prisma.invoice.create({
        data: {
          tenantId: tenant.id,
          companyId: betaConstructId,
          dealId: betaDeal.id,
          series: 'FC',
          number: 2,
          issueDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
          dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          subtotal: 3200,
          vatAmount: 608,
          total: 3808,
          currency: InvoiceCurrency.EUR,
          status: InvoiceStatus.OVERDUE,
          notes: 'Software devize construcții — licență anuală',
        },
      });
      await prisma.invoiceLine.create({
        data: {
          tenantId: tenant.id,
          invoiceId: inv2.id,
          position: 0,
          description: 'Software Devize Construcții — licență anuală',
          quantity: 1,
          unitPrice: 3200,
          vatRate: 19,
          subtotal: 3200,
          vatAmount: 608,
          total: 3808,
        },
      });
    }
    console.log('✓ 2 facturi demo create (1 emisă, 1 restantă)');
  }

  // eslint-disable-next-line no-console
  console.log('\n══════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  console.log('  CONTURI TEST AMASS CRM');
  // eslint-disable-next-line no-console
  console.log('══════════════════════════════════════════════════');
  for (const acc of ACCOUNTS) {
    // eslint-disable-next-line no-console
    console.log(`  ${acc.role.padEnd(8)} │ ${acc.email}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  Parolă   │ ${PASSWORD}`);
  // eslint-disable-next-line no-console
  console.log('══════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
