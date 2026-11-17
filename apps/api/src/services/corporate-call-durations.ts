import { type DbClient } from '@dashboarduz/db';
import { fromTashkentLocalParts, shiftToTashkent, toTashkentDateKey } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

function getReportDayStart(date: Date): Date {
  const local = shiftToTashkent(date);

  return fromTashkentLocalParts(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0);
}

export function parseReportDateInput(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Sana formati noto'g'ri. YYYY-MM-DD bo'lishi kerak." });
  }
  const parsed = new Date(`${input}T00:00:00.000+05:00`);

  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sana noto‘g‘ri.' });
  }

  return getReportDayStart(parsed);
}

export function parseDurationToSeconds(input: string): number {
  const normalized = String(input || '').trim();

  if (!normalized) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Qo'ng'iroq davomiyligi kiritilishi kerak." });
  }

  if (!/^\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Davomiylik HH:MM:SS formatida bo'lishi kerak." });
  }

  const parts = normalized.split(':').map((part) => part.trim());
  const hours = Number.parseInt(parts[0] || '0', 10);
  const minutes = Number.parseInt(parts[1] || '0', 10);
  const seconds = Number.parseInt(parts[2] || '0', 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Qo'ng'iroq davomiyligi noto'g'ri." });
  }
  if (minutes >= 60 || seconds >= 60) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Daqiqa/soniya 60 dan kichik bo'lishi kerak." });
  }

  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

export function formatDurationToHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function isTodayOrYesterdayInReportTz(targetDate: Date, now = new Date()): boolean {
  const target = toTashkentDateKey(targetDate);
  const todayStart = getReportDayStart(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const allowed = new Set([toTashkentDateKey(todayStart), toTashkentDateKey(yesterdayStart)]);

  return allowed.has(target);
}

export async function getCorporateCallDurationByManager(params: {
  tenantId: string;
  managerUserIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
  db: DbClient;
}): Promise<Map<string, number>> {
  const { db } = params;
  const result = new Map<string, number>();

  if (!params.managerUserIds.length) {
    return result;
  }

  const dayStart = getReportDayStart(params.rangeStart);
  const dayEnd = getReportDayStart(params.rangeEnd);

  const grouped = await db.corporateCallDuration.groupBy({
    by: ['managerUserId'],
    where: {
      tenantId: params.tenantId,
      managerUserId: { in: params.managerUserIds },
      callDate: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
    _sum: {
      durationSeconds: true,
    },
  });

  for (const row of grouped) {
    result.set(row.managerUserId, Number(row._sum.durationSeconds || 0));
  }

  return result;
}

export async function getCorporateCallDurationTotal(params: {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
  db: DbClient;
}): Promise<number> {
  const { db } = params;
  const dayStart = getReportDayStart(params.rangeStart);
  const dayEnd = getReportDayStart(params.rangeEnd);

  const aggregate = await db.corporateCallDuration.aggregate({
    where: {
      tenantId: params.tenantId,
      callDate: {
        gte: dayStart,
        lte: dayEnd,
      },
    },
    _sum: {
      durationSeconds: true,
    },
  });

  return Number(aggregate._sum.durationSeconds || 0);
}
