import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Tenant', slug: 'demo' },
  });

  const passwordHash = await bcrypt.hash('admin123', 10);

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@demo.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@demo.local',
      passwordHash,
      fullName: 'Demo Admin',
      role: UserRole.OWNER,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`Seeded tenant=${tenant.slug}, admin=admin@demo.local / admin123`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
