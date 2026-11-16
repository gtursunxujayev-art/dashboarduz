import { systemPrisma } from '@dashboarduz/db';

import { logger } from '../../lib/logger';

export async function processExport(exportId: string) {
  logger.info({ exportId }, 'Processing export');
}

export async function processIntegrationSync(integrationType: string, tenantId: string) {
  const integration = await systemPrisma.integration.findFirst({
    where: {
      tenantId,
      type: integrationType,
      status: 'active',
    },
  });

  if (!integration) {
    throw new Error(`Active integration not found for type=${integrationType}, tenant=${tenantId}`);
  }

  await systemPrisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  await systemPrisma.auditLog.create({
    data: {
      tenantId,
      action: 'integration_sync',
      resource: 'integration',
      resourceId: integration.id,
      metadata: { type: integrationType },
    },
  });
}
