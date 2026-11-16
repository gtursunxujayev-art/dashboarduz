import { systemPrisma } from '@dashboarduz/db';

import { ingestFaceIdEvent } from '../../services/attendance/faceid';

export async function processFaceIdWebhook(event: any, tenantId: string) {
  const integration = await systemPrisma.integration.findFirst({
    where: {
      tenantId,
      type: 'faceid_attendance',
      status: 'active',
    },
    select: {
      config: true,
    },
  });

  if (!integration) {
    throw new Error('No active Face ID integration found');
  }

  await ingestFaceIdEvent({
    tenantId,
    integrationConfig: integration.config,
    payload: event.rawPayload,
  });
}
