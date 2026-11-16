import { normalizeDigits } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { isAllowedUtelManagerExtension } from '../../../lib/utel';
import { amocrmService } from '../../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { listTelegramRecipients } from '../../../services/integrations/telegram-recipient-store';
import { extractUtelManagerFromMetadata, toNormalizedText } from '../../../services/users/accounts';
import { managerProcedure } from '../../trpc';

export const userDirectoryProcedures = {
  amocrmManagers: managerProcedure.query(async ({ ctx }) => {
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const users = await amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl);

    return users
      .map((user) => ({
        id: String(user.id || ''),
        name: String(user.name || user.login || user.email || user.id || 'Unknown'),
        email: user.email || null,
        isActive: user.is_active !== false,
      }))
      .filter((user) => user.id.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }),
  utelManagers: managerProcedure.query(async ({ ctx }) => {
    const calls = await ctx.db.call.findMany({
      where: {
        tenantId: ctx.tenantId,
        provider: 'utel',
      },
      orderBy: { startedAt: 'desc' },
      take: 3000,
      select: {
        metadata: true,
      },
    });

    const uniqueManagers = new Map<string, string>();

    for (const call of calls) {
      const extracted = extractUtelManagerFromMetadata(call.metadata);

      if (!extracted) {
        continue;
      }
      if (!uniqueManagers.has(extracted.key)) {
        uniqueManagers.set(extracted.key, extracted.label);
      }
    }

    const mappedUsers = await ctx.db.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        utelManagerExternalId: { not: null },
      },
      select: {
        name: true,
        username: true,
        utelManagerExternalId: true,
      },
      take: 1000,
    });

    for (const user of mappedUsers) {
      const extensionDigits = normalizeDigits(user.utelManagerExternalId || '');

      if (!isAllowedUtelManagerExtension(extensionDigits)) {
        continue;
      }
      if (!uniqueManagers.has(extensionDigits)) {
        const labelSource = toNormalizedText(user.name || user.username || '');

        uniqueManagers.set(extensionDigits, labelSource ? `${labelSource} (${extensionDigits})` : extensionDigits);
      }
    }

    return Array.from(uniqueManagers.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),
  telegramRecipients: managerProcedure.query(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'telegram',
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!integration || integration.status !== 'active') {
      return [];
    }

    return (await listTelegramRecipients({
      tenantId: ctx.tenantId,
      integrationId: integration.id,
      startedOnly: true,
      db: ctx.db,
    }))
      .map((recipient) => ({
        id: recipient.chatId,
        name: recipient.displayName,
        username: recipient.username,
        lastSeenAt: recipient.lastSeenAt,
      }));
  }),
  list: managerProcedure.query(async ({ ctx }) => {
    return await ctx.db.user.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        roles: true,
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
        telegramId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }),
};
