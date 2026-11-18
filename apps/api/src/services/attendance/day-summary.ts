import { type DbClient } from '@dashboarduz/db';

const REQUIRED_WORK_SECONDS_MON_TO_SAT = 9 * 60 * 60;

function requiredSecondsForDate(localDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return REQUIRED_WORK_SECONDS_MON_TO_SAT;
  }
  const [year, month, day] = localDate.split('-').map((part) => Number.parseInt(part, 10));

  if (!year || !month || !day) {
    return REQUIRED_WORK_SECONDS_MON_TO_SAT;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay(); // 0: Sunday

  if (dayOfWeek === 0) {
    return 0;
  }

  return REQUIRED_WORK_SECONDS_MON_TO_SAT;
}

export async function recomputeAttendanceDaySummary(params: {
  tenantId: string;
  userId: string;
  localDate: string;
  /** Tenant-scoped client for user requests; defaults to the system client (workers). */
  db: DbClient;
}): Promise<void> {
  const { db } = params;
  const events = await db.attendanceEvent.findMany({
    where: {
      tenantId: params.tenantId,
      userId: params.userId,
      localDate: params.localDate,
    },
    orderBy: [
      { eventAt: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      action: true,
      eventAt: true,
      lateMinutes: true,
    },
  });

  let workedSeconds = 0;
  let unmatchedInCount = 0;
  let unmatchedOutCount = 0;
  let firstInAt: Date | null = null;
  let firstInLateMinutes = 0;
  let lastOutAt: Date | null = null;
  let openInAt: Date | null = null;

  for (const event of events) {
    const action = String(event.action || '').toUpperCase();

    if (action === 'IN') {
      if (openInAt) {
        unmatchedInCount += 1;
      }
      openInAt = event.eventAt;
      if (!firstInAt) {
        firstInAt = event.eventAt;
        firstInLateMinutes = Math.max(0, Math.floor(event.lateMinutes || 0));
      }
      continue;
    }

    if (action === 'OUT') {
      if (!openInAt || event.eventAt.getTime() < openInAt.getTime()) {
        unmatchedOutCount += 1;
        continue;
      }
      workedSeconds += Math.max(0, Math.floor((event.eventAt.getTime() - openInAt.getTime()) / 1000));
      openInAt = null;
      lastOutAt = event.eventAt;
    }
  }

  if (openInAt) {
    unmatchedInCount += 1;
  }

  const requiredSeconds = requiredSecondsForDate(params.localDate);
  const missingSeconds = Math.max(requiredSeconds - workedSeconds, 0);
  const absence = requiredSeconds > 0 && workedSeconds === 0;
  const lateCount = firstInLateMinutes > 0 ? 1 : 0;
  const anomalyCount = unmatchedInCount + unmatchedOutCount;

  await db.attendanceDaySummary.upsert({
    where: {
      tenantId_userId_summaryDate: {
        tenantId: params.tenantId,
        userId: params.userId,
        summaryDate: params.localDate,
      },
    },
    create: {
      tenantId: params.tenantId,
      userId: params.userId,
      summaryDate: params.localDate,
      workedSeconds,
      requiredSeconds,
      missingSeconds,
      lateMinutes: firstInLateMinutes,
      lateCount,
      absence,
      unmatchedInCount,
      unmatchedOutCount,
      anomalyCount,
      firstInAt: firstInAt || null,
      lastOutAt: lastOutAt || null,
      sourceUpdatedAt: new Date(),
    },
    update: {
      workedSeconds,
      requiredSeconds,
      missingSeconds,
      lateMinutes: firstInLateMinutes,
      lateCount,
      absence,
      unmatchedInCount,
      unmatchedOutCount,
      anomalyCount,
      firstInAt: firstInAt || null,
      lastOutAt: lastOutAt || null,
      sourceUpdatedAt: new Date(),
    },
  });
}

export async function recomputeAttendanceSummariesForRange(params: {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  userId?: string;
  db: DbClient;
}): Promise<{ recomputed: number }> {
  const { db } = params;
  const events = await db.attendanceEvent.findMany({
    where: {
      tenantId: params.tenantId,
      // One filter on userId: the requested user, or every matched user. (A later `userId: { not: null }` used to
      // overwrite the requested user, so a one-user recompute recomputed everyone.)
      userId: params.userId ?? { not: null },
      localDate: {
        gte: params.dateFrom,
        lte: params.dateTo,
      },
    },
    select: {
      userId: true,
      localDate: true,
    },
    distinct: ['userId', 'localDate'],
  });

  let recomputed = 0;

  for (const event of events) {
    if (!event.userId) {
      continue;
    }
    await recomputeAttendanceDaySummary({
      tenantId: params.tenantId,
      userId: event.userId,
      localDate: event.localDate,
      db,
    });
    recomputed += 1;
  }

  return { recomputed };
}
