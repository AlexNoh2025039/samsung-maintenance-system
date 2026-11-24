import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CreateUserSchema, UserRole } from '@samsung-maintenance/shared';
import { prisma } from './db';
import { PrismaAuthStore } from './auth-store';
import { hashPassword } from './password';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function main(): Promise<void> {
  const parsed = CreateUserSchema.safeParse({
    email: process.env.INITIAL_ADMIN_EMAIL,
    name: process.env.INITIAL_ADMIN_NAME,
    password: process.env.INITIAL_ADMIN_PASSWORD,
    role: UserRole.ADMIN,
  });
  if (!parsed.success) {
    throw new Error(
      'Set valid INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME, and INITIAL_ADMIN_PASSWORD (at least 12 characters).',
    );
  }

  const store = new PrismaAuthStore(prisma);
  const password = await hashPassword(parsed.data.password);
  const user = await store.createInitialAdmin({
    email: parsed.data.email,
    name: parsed.data.name,
    password,
  });
  console.log(`Created initial administrator: ${user.email}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      'Could not create initial administrator:',
      error instanceof Error ? error.message : 'unknown error',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
