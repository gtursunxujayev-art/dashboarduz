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
  await prisma.$executeRawUnsafe(`SET app.current_tenant = '${tenantId}'`);
}

// Export types
export type { Tenant, User, Integration, Lead, Contact, Call, Notification, WebhookEvent, AuditLog } from '@prisma/client';
