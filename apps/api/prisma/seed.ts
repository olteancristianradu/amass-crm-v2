/**
 * Seed script — creates demo tenant + test accounts for QA / onboarding.
 *
 * Idempotent (upsert). Safe to run multiple times.
 *
 * CONTURI CREATE:
 *   OWNER  admin@amass-demo.ro  / AmassCRM2026!
 *   AGENT  agent@amass-demo.ro  / AmassCRM2026!
 */

import { PrismaClient, UserRole } from '@prisma/client';
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
  const existingPipeline = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, isDefault: true },
  });
  if (!existingPipeline) {
    const pipeline = await prisma.pipeline.create({
      data: { tenantId: tenant.id, name: 'Vânzări', isDefault: true, order: 0 },
    });
    await prisma.pipelineStage.createMany({
      data: [
        { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Nou', type: 'OPEN', order: 0, probability: 10 },
        { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Calificat', type: 'OPEN', order: 10, probability: 30 },
        { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Negociere', type: 'OPEN', order: 20, probability: 60 },
        { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Câștigat', type: 'WON', order: 30, probability: 100 },
        { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Pierdut', type: 'LOST', order: 40, probability: 0 },
      ],
    });
    // eslint-disable-next-line no-console
    console.log('✓ Pipeline default setat (5 etape)');
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  for (const acc of ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: acc.email } },
      update: { passwordHash, fullName: acc.fullName, role: acc.role, isActive: true },
      create: { tenantId: tenant.id, ...acc, passwordHash, isActive: true },
    });
    // eslint-disable-next-line no-console
    console.log(`✓ User [${user.role}]: ${user.email}`);
  }

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

  for (const { company, contact } of demoCompanies) {
    const existing = await prisma.company.findFirst({
      where: { tenantId: tenant.id, vatNumber: company.vatNumber },
    });
    if (!existing) {
      const c = await prisma.company.create({
        data: { tenantId: tenant.id, ...company, country: 'RO' },
      });
      await prisma.contact.create({
        data: { tenantId: tenant.id, companyId: c.id, ...contact },
      });
      // eslint-disable-next-line no-console
      console.log(`✓ Companie demo: ${c.name}`);
    }
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
