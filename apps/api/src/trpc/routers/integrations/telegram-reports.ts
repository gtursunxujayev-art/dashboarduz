import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { parseTelegramDailyReportCourseIds } from '../../../lib/telegram';
import { thrownMessageOr, thrownText } from '../../../lib/thrown';
import { telegramRecipientStorageErrorMessage } from '../../../services/integration-settings/connection';
import { listTelegramRecipients, updateTelegramRecipientSelection } from '../../../services/integrations/telegram-recipient-store';
import { applyTelegramRecipientsToConfig } from '../../../services/integrations/telegram-recipients';
import { sendTelegramGroupSummariesForTenant } from '../../../services/reports/telegram-group-summary-scheduler';
import { sendImmediateTodayReportForTenant, sendManualTelegramReportForTenant } from '../../../services/reports/telegram-report-scheduler';
import { adminProcedure } from '../../trpc';

export const telegramReportProcedures = {
  getTelegramReportRecipients: adminProcedure.query(async ({ ctx }) => {
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
        config: true,
      },
    });

    if (!integration || integration.status !== 'active') {
      return {
        connected: false,
        recipientStorageReady: true,
        recipientError: null as string | null,
        recipients: [] as Array<{
          chatId: string;
          displayName: string;
          username: string | null;
          firstName: string | null;
          lastName: string | null;
          selectedForReports: boolean;
          startedAt: string | null;
          lastSeenAt: string | null;
        }>,
        courseOptions: [] as Array<{
          id: string;
          name: string;
          category: string;
          isActive: boolean;
        }>,
        selectedDailyReportCourseIds: [] as string[],
      };
    }

    const courseOptions = await ctx.db.course.findMany({
      where: { tenantId: ctx.tenantId },
      select: {
        id: true,
        name: true,
        category: true,
        isActive: true,
      },
      orderBy: [
        { isActive: 'desc' },
        { name: 'asc' },
      ],
    });

    const availableCourseIds = new Set(courseOptions.map((course) => course.id));
    const selectedDailyReportCourseIds = parseTelegramDailyReportCourseIds(integration.config)
      .filter((courseId) => availableCourseIds.has(courseId));

    let recipientStorageReady = true;
    let recipientError: string | null = null;
    let storedRecipients: Awaited<ReturnType<typeof listTelegramRecipients>> = [];

    try {
      storedRecipients = await listTelegramRecipients({
        tenantId: ctx.tenantId,
        integrationId: integration.id,
        startedOnly: true,
        db: ctx.db,
      });
    } catch {
      recipientStorageReady = false;
      recipientError = telegramRecipientStorageErrorMessage();
    }

    const recipients = storedRecipients.map((recipient) => ({
        chatId: recipient.chatId,
        displayName: recipient.displayName,
        username: recipient.username,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        selectedForReports: recipient.selectedForReports,
        startedAt: recipient.startedAt,
        lastSeenAt: recipient.lastSeenAt,
      }));

    return {
      connected: true,
      recipientStorageReady,
      recipientError,
      recipients,
      courseOptions,
      selectedDailyReportCourseIds,
    };
  }),
  updateTelegramReportRecipients: adminProcedure
    .input(z.object({
      chatIds: z.array(z.string()),
      dailyReportCourseIds: z.array(z.string().uuid()).max(3).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const integration = await ctx.db.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
      });

      if (!integration || integration.status !== 'active') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Telegram integration is not connected.',
        });
      }

      let selectedChatIds: string[];

      try {
        selectedChatIds = await updateTelegramRecipientSelection({
          tenantId: ctx.tenantId,
          integrationId: integration.id,
          selectedChatIds: input.chatIds,
          db: ctx.db,
        });
      } catch (error) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: thrownText(error) });
      }
      const selectedDailyReportCourseIds = Array.from(new Set(
        (input.dailyReportCourseIds || [])
          .map((courseId) => courseId.trim())
          .filter(Boolean),
      )).slice(0, 3);

      if (selectedDailyReportCourseIds.length > 0) {
        const availableCourses = await ctx.db.course.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: selectedDailyReportCourseIds },
          },
          select: { id: true },
        });
        const availableCourseIds = new Set(availableCourses.map((course) => course.id));
        const unknownCourseId = selectedDailyReportCourseIds.find((courseId) => !availableCourseIds.has(courseId));

        if (unknownCourseId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown report course id: ${unknownCourseId}`,
          });
        }
      }

      const recipients = await listTelegramRecipients({
        tenantId: ctx.tenantId,
        integrationId: integration.id,
        db: ctx.db,
      });
      const configWithCourseSelection = {
        ...applyTelegramRecipientsToConfig(integration.config, recipients),
        telegramDailyReportCourseIds: selectedDailyReportCourseIds,
      };

      await ctx.db.integration.update({
        where: { id: integration.id },
        data: { config: configWithCourseSelection as Prisma.InputJsonObject },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_update',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            type: 'telegram',
            reportRecipientChatIds: selectedChatIds,
            telegramDailyReportCourseIds: selectedDailyReportCourseIds,
          },
        },
      });

      return {
        success: true,
        selectedChatIds,
        selectedDailyReportCourseIds,
      };
    }),
  sendTelegramTodayReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await sendImmediateTodayReportForTenant(ctx.tenantId, ctx.db);

      return result;
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: thrownMessageOr(error, 'Failed to send report'),
      });
    }
  }),
  sendTelegramGroupSummaryNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await sendTelegramGroupSummariesForTenant(ctx.tenantId, ctx.db);
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: thrownMessageOr(error, 'Guruh hisobotini yuborishda xatolik'),
      });
    }
  }),
  sendTelegramWeeklyReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await sendManualTelegramReportForTenant(ctx.tenantId, 'weekly', ctx.db);
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: thrownMessageOr(error, 'Failed to send report'),
      });
    }
  }),
  sendTelegramMonthlyReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await sendManualTelegramReportForTenant(ctx.tenantId, 'monthly', ctx.db);
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: thrownMessageOr(error, 'Failed to send report'),
      });
    }
  }),
};
