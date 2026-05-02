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
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TENANT_SLUG = 'demo';
const TENANT_NAME = 'AMASS Demo SRL';
const PASSWORD = 'AmassCRM2026!';

const ACCOUNTS: { email: string; fullName: string; role: UserRole }[] = [
  { email: 'admin@amass-demo.ro', fullName: 'Administrator Demo', role: UserRole.OWNER },
  { email: 'agent@amass-demo.ro', fullName: 'Agent Vanzari Demo', role: UserRole.AGENT },
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
