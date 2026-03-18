import { adminProcedure, router } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { queueService } from '../../services/queue';

const notificationsListSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  status: z.enum(['pending', 'sent', 'failed', 'retrying']).optional(),
  type: z.enum(['telegram', 'email', 'sms']).optional(),
});

export const notificationsRouter = router({
  list: adminProcedure
    .input(notificationsListSchema)
    .query(async ({ input, ctx }) => {
      const { page, limit, status, type } = input;
      const skip = (page - 1) * limit;

      const where: any = { tenantId: ctx.tenantId };
      if (status) {
        where.status = status;
      }
      if (type) {
        where.type = type;
      }

      const [data, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.notification.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + data.length < total,
        },
      };
    }),

  retry: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const notification = await prisma.notification.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
      });
      if (!notification) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Notification not found' });
      }

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: 'pending',
          errorMessage: null,
          nextRetryAt: null,
        },
      });

      await queueService.addNotificationJob(notification.id, { priority: 1 });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'notification_retry',
          resource: 'notification',
          resourceId: notification.id,
          metadata: { type: notification.type },
        },
      });

      return { success: true };
    }),
});
