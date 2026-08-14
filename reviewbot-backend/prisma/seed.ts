import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Starting database seed...');

  // Upsert sample project (idempotent)
  const project = await prisma.project.upsert({
    where: { githubRepoId: 1 },
    update: {},
    create: {
      githubRepoId: 1,
      name: 'Sample Project',
      namespace: 'sample-org',
      webhookSecret: 'sample_secret',
    },
  });

  // Upsert sample developer (idempotent)
  const developer = await prisma.developer.upsert({
    where: { githubUserId: 1 },
    update: {},
    create: {
      githubUserId: 1,
      username: 'test_developer',
      name: 'Test Developer',
    },
  });

  console.log('✓ Seed completed successfully');
  console.log('Seeded:', { project, developer });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
