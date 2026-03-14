import { PrismaClient } from '@prisma/client';

// Singleton pattern for Prisma Client
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Helper to set tenant context for RLS
export async function setTenantContext(tenantId: string) {
  await prisma.$executeRaw`SELECT app.set_tenant_context(${tenantId}::uuid)`;
}

// Export Prisma namespace types for downstream typing helpers.
export type { Prisma } from '@prisma/client';
