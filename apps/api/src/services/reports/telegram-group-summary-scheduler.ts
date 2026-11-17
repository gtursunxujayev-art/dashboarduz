import { type DbClient, systemPrisma } from '@dashboarduz/db';
import { fromTashkentLocalParts, groupDigits, shiftToTashkent, type ManagerGroup } from '@dashboarduz/shared';

import { createIntervalJob } from '../../lib/interval-job';
import { logger } from '../../lib/logger';
import { asObjectOrEmpty } from '../../lib/object';
import { classifyIncomeCategory, type IncomeCategory } from '../income-facts';
import { telegramService } from '../integrations/telegram';
import { getOfflineTelegramGroupIds, getOnlineTelegramGroupIds } from '../integrations/telegram-groups';
import { reportError } from '../observability';
import { getRedisClient } from '../queue/redis-client';
import { decryptIntegrationTokens } from '../security/encryption';
import { isTechnicalNewSale } from '../technical-income';

const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_SECONDS = 2 * 24 * 60 * 60;

export type TelegramGroupSummaryGroup = ManagerGroup;
export type TelegramGroupSummarySchedule = '18:00' | '23:59' | 'manual';

export type TelegramGroupSummaryMetrics = {
  newSalesCount: number;
  totalIncome: number;
  newIncome: number;
  debtIncome: number;
  coaching?: { salesCount: number; income: number };
  intensive?: { salesCount: number; income: number };
};

export type TelegramGroupDeliveryResult = {
  group: TelegramGroupSummaryGroup;
  status: 'sent' | 'failed' | 'skipped';
  destinationCount: number;
  sentCount: number;
  error: string | null;
};

export type SummaryIncomeRow = {
  id: string;
  type: string;
  relatedDebtIncomeId: string | null;
  paymentAmount: number;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  courseId: string | null;
  course: { id: string; name: string; category: string } | null;
};

type TelegramIntegration = {
  id: string;
  tenantId: string;
  tokensEncrypted: string | null;
  config: unknown;
};

function selectedCourseIds(config: unknown): Set<string> {
  const raw = asObjectOrEmpty(config).telegramDailyReportCourseIds;

  if (!Array.isArray(raw)) return new Set();

  return new Set(raw.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 3));
}

function classifyCourse(value: string | null | undefined): IncomeCategory {
  return classifyIncomeCategory({ category: value });
}

export function getTashkentDayWindow(now: Date): { dateKey: string; start: Date; end: Date } {
  const local = shiftToTashkent(now);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();

  return {
    dateKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    start: fromTashkentLocalParts(year, month, day),
    end: now,
  };
}

export function resolveDueTelegramGroupSummaryCutoffs(now: Date): Array<'18:00' | '23:59'> {
  const local = shiftToTashkent(now);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const due: Array<'18:00' | '23:59'> = [];

  if (minutes >= 18 * 60) due.push('18:00');
  if (minutes >= 23 * 60 + 59) due.push('23:59');

  return due;
}

export function formatTelegramGroupSummary(group: TelegramGroupSummaryGroup, metrics: TelegramGroupSummaryMetrics): string {
  const label = group === 'online' ? 'Online' : 'Offline';
  const lines = [
    `📊 Bugun — ${label}`,
    `🆕 Yangi sotuvlar: ${metrics.newSalesCount}`,
    `💰 Umumiy tushum: ${groupDigits(String(Math.round(metrics.totalIncome)), ' ')} so'm`,
    `💳 Yangi tushum: ${groupDigits(String(Math.round(metrics.newIncome)), ' ')} so'm`,
    `📥 Qarzdorlik tushumi: ${groupDigits(String(Math.round(metrics.debtIncome)), ' ')} so'm`,
  ];

  if (group === 'offline' && metrics.coaching) {
    lines.push(`🎓 Couching sotuvi: ${metrics.coaching.salesCount}`);
    lines.push(`💰 Couching tushumi: ${groupDigits(String(Math.round(metrics.coaching.income)), ' ')} so'm`);
  }
  if (group === 'offline' && metrics.intensive) {
    lines.push(`🔥 Intensiv sotuvi: ${metrics.intensive.salesCount}`);
    lines.push(`💰 Intensiv tushumi: ${groupDigits(String(Math.round(metrics.intensive.income)), ' ')} so'm`);
  }

  return lines.join('\n');
}

export function aggregateTelegramGroupSummaries(params: {
  rows: SummaryIncomeRow[];
  ancestors: SummaryIncomeRow[];
  selectedCourseIds: Set<string>;
  selectedCourseCategories?: Map<string, string>;
}): Record<TelegramGroupSummaryGroup, TelegramGroupSummaryMetrics> {
  const byId = new Map([...params.ancestors, ...params.rows].map((row) => [row.id, row]));
  const rootFor = (row: SummaryIncomeRow): SummaryIncomeRow => {
    let current = row;
    const visited = new Set<string>();

    while (current.relatedDebtIncomeId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.relatedDebtIncomeId);

      if (!parent) break;
      current = parent;
    }

    return current;
  };
  const empty = (): TelegramGroupSummaryMetrics => ({
    newSalesCount: 0,
    totalIncome: 0,
    newIncome: 0,
    debtIncome: 0,
  });
  const result = { online: empty(), offline: empty() };
  let hasSelectedOffline = Array.from(params.selectedCourseCategories?.values() || [])
    .some((value) => classifyCourse(value) === 'offline');
  let hasSelectedIntensive = Array.from(params.selectedCourseCategories?.values() || [])
    .some((value) => classifyCourse(value) === 'intensive');

  for (const row of params.rows) {
    const root = rootFor(row);

    if (isTechnicalNewSale(root)) continue;
    const category = classifyCourse(root.course?.category || root.course?.name);
    // Same split as the live leaderboard: online courses on one side, everything else (offline, intensive,
    // additional services, courseless rows) on the offline side, so the two totals always add up to all income.
    const group = category === 'online' ? 'online' : 'offline';
    const metrics = result[group];
    const amount = Number(row.paymentAmount || 0);

    metrics.totalIncome += amount;
    if (row.type === 'new_sale') {
      metrics.newSalesCount += 1;
      metrics.newIncome += amount;
    } else {
      metrics.debtIncome += amount;
    }

    if (params.selectedCourseIds.has(root.courseId || '') && category === 'offline') {
      hasSelectedOffline = true;
      metrics.coaching ||= { salesCount: 0, income: 0 };
      metrics.coaching.income += amount;
      if (row.type === 'new_sale') metrics.coaching.salesCount += 1;
    }
    if (params.selectedCourseIds.has(root.courseId || '') && category === 'intensive') {
      hasSelectedIntensive = true;
      metrics.intensive ||= { salesCount: 0, income: 0 };
      metrics.intensive.income += amount;
      if (row.type === 'new_sale') metrics.intensive.salesCount += 1;
    }
  }
  if (hasSelectedOffline) result.offline.coaching ||= { salesCount: 0, income: 0 };
  else delete result.offline.coaching;
  if (hasSelectedIntensive) result.offline.intensive ||= { salesCount: 0, income: 0 };
  else delete result.offline.intensive;

  return result;
}

async function loadSummaryRows(db: DbClient, tenantId: string, start: Date, end: Date) {
  const select = {
    id: true,
    type: true,
    relatedDebtIncomeId: true,
    paymentAmount: true,
    coursePriceAmount: true,
    debtAmount: true,
    courseId: true,
    course: { select: { id: true, name: true, category: true } },
  } as const;
  const rows = await db.income.findMany({
    where: { tenantId, lifecycleStatus: 'active', entryDate: { gte: start, lte: end } },
    select,
  });
  const known = new Map<string, SummaryIncomeRow>(rows.map((row) => [row.id, row]));
  let pending = Array.from(new Set(rows.map((row) => row.relatedDebtIncomeId).filter((id): id is string => Boolean(id))));

  while (pending.length > 0) {
    const missing = pending.filter((id) => !known.has(id));

    if (!missing.length) break;
    const ancestors = await db.income.findMany({ where: { tenantId, id: { in: missing } }, select });

    if (!ancestors.length) break;
    for (const row of ancestors) known.set(row.id, row);
    pending = Array.from(new Set(ancestors.map((row) => row.relatedDebtIncomeId).filter((id): id is string => Boolean(id))));
  }

  return { rows: rows as SummaryIncomeRow[], ancestors: Array.from(known.values()) };
}

function resolveBotToken(integration: TelegramIntegration): string {
  if (integration.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      const token = String(tokens.botToken || tokens.token || '').trim();

      if (token) return token;
    } catch (error: any) {
      logger.warn({
        tenantId: integration.tenantId,
        error: error?.message || String(error),
      }, 'Telegram integration token could not be decrypted; using environment fallback');
    }
  }

  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

async function recordDeliveryAudit(
  db: DbClient,
  integration: TelegramIntegration,
  schedule: TelegramGroupSummarySchedule,
  dateKey: string,
  result: TelegramGroupDeliveryResult,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: result.status === 'sent' ? 'telegram_group_summary_sent' : 'telegram_group_summary_failed',
        resource: 'integration',
        resourceId: integration.id,
        metadata: {
          schedule,
          date: dateKey,
          group: result.group,
          status: result.status,
          destinationCount: result.destinationCount,
          sentCount: result.sentCount,
          error: result.error,
        },
      },
    });
  } catch (error: any) {
    // A logging outage must not turn a successful Telegram send into a retry and duplicate it.
    reportError('Telegram group summary audit log failed', {
      tenantId: integration.tenantId,
      schedule,
      group: result.group,
      status: result.status,
      error: error?.message || String(error),
    });
  }
}

async function sendOneGroup(params: {
  db: DbClient;
  integration: TelegramIntegration;
  group: TelegramGroupSummaryGroup;
  metrics: TelegramGroupSummaryMetrics;
  schedule: TelegramGroupSummarySchedule;
  dateKey: string;
}): Promise<TelegramGroupDeliveryResult> {
  const destinations = params.group === 'online' ? getOnlineTelegramGroupIds() : getOfflineTelegramGroupIds();
  const token = resolveBotToken(params.integration);

  if (!destinations.length || !token) {
    const missing = !token ? 'Telegram bot tokeni sozlanmagan.' : `${params.group} Telegram guruh ID si sozlanmagan.`;
    const result: TelegramGroupDeliveryResult = {
      group: params.group, status: 'skipped', destinationCount: destinations.length, sentCount: 0, error: missing,
    };

    await recordDeliveryAudit(params.db, params.integration, params.schedule, params.dateKey, result);

    return result;
  }

  let sentCount = 0;
  const errors: string[] = [];
  const message = formatTelegramGroupSummary(params.group, params.metrics);

  for (const destination of destinations) {
    try {
      await telegramService.sendMessage(token, destination, message, { disable_web_page_preview: true });
      sentCount += 1;
    } catch (error: any) {
      errors.push(error?.message || String(error));
    }
  }
  const result: TelegramGroupDeliveryResult = {
    group: params.group,
    status: sentCount === destinations.length ? 'sent' : 'failed',
    destinationCount: destinations.length,
    sentCount,
    error: errors.length ? errors.join('; ') : null,
  };

  await recordDeliveryAudit(params.db, params.integration, params.schedule, params.dateKey, result);

  return result;
}

async function calculateForIntegration(db: DbClient, integration: TelegramIntegration, now: Date) {
  const window = getTashkentDayWindow(now);
  const selectedIds = selectedCourseIds(integration.config);
  const selectedCourses = selectedIds.size > 0
    ? await db.course.findMany({
      where: { tenantId: integration.tenantId, id: { in: Array.from(selectedIds) } },
      select: { id: true, category: true, name: true },
    })
    : [];
  const data = await loadSummaryRows(db, integration.tenantId, window.start, window.end);

  return {
    window,
    metrics: aggregateTelegramGroupSummaries({
      ...data,
      selectedCourseIds: selectedIds,
      selectedCourseCategories: new Map(selectedCourses.map((course) => [course.id, course.category || course.name])),
    }),
  };
}

/** Sends today's group summaries now. Request code passes its tenant-scoped ctx.db. */
export async function sendTelegramGroupSummariesForTenant(
  tenantId: string,
  db: DbClient,
  now = new Date(),
): Promise<{ date: string; schedule: 'manual'; results: TelegramGroupDeliveryResult[] }> {
  const integration = await db.integration.findFirst({
    where: { tenantId, type: 'telegram', status: 'active' },
    select: { id: true, tenantId: true, tokensEncrypted: true, config: true },
  });

  if (!integration) throw new Error('Telegram integration is not connected.');
  const calculated = await calculateForIntegration(db, integration, now);
  const results: TelegramGroupDeliveryResult[] = [];

  for (const group of ['online', 'offline'] as const) {
    results.push(await sendOneGroup({
      db,
      integration,
      group,
      metrics: calculated.metrics[group],
      schedule: 'manual',
      dateKey: calculated.window.dateKey,
    }));
  }

  return { date: calculated.window.dateKey, schedule: 'manual', results };
}

async function dispatchScheduled(integration: TelegramIntegration, cutoff: '18:00' | '23:59', now: Date): Promise<void> {
  const calculated = await calculateForIntegration(systemPrisma, integration, now);
  const redis = getRedisClient();

  for (const group of ['online', 'offline'] as const) {
    const lockKey = `telegram-group-summary:${integration.tenantId}:${calculated.window.dateKey}:${cutoff}:${group}`;
    const acquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX');

    if (!acquired) continue;
    try {
      const result = await sendOneGroup({
        db: systemPrisma,
        integration,
        group,
        metrics: calculated.metrics[group],
        schedule: cutoff,
        dateKey: calculated.window.dateKey,
      });

      if (result.status !== 'sent') await redis.del(lockKey);
      logger[result.status === 'sent' ? 'info' : 'warn']({
        tenantId: integration.tenantId,
        schedule: cutoff,
        group,
        status: result.status,
        destinationCount: result.destinationCount,
        sentCount: result.sentCount,
      }, 'Telegram group summary dispatch completed');
    } catch (error: any) {
      await redis.del(lockKey);
      reportError('Telegram group summary dispatch failed', {
        tenantId: integration.tenantId, schedule: cutoff, group, error: error?.message || String(error),
      });
    }
  }
}

const schedulerJob = createIntervalJob({
  intervalMs: POLL_INTERVAL_MS,
  skipWhileRunning: true,
  run: async () => {
    const now = new Date();
    const cutoffs = resolveDueTelegramGroupSummaryCutoffs(now);

    if (!cutoffs.length) return;
    const integrations = await systemPrisma.integration.findMany({
      where: { type: 'telegram', status: 'active' },
      select: { id: true, tenantId: true, tokensEncrypted: true, config: true },
    });

    for (const integration of integrations) {
      for (const cutoff of cutoffs) await dispatchScheduled(integration, cutoff, now);
    }
  },
  onError: (error) => {
    reportError('Telegram group summary scheduler tick failed', {
      error: (error as Error | undefined)?.message || String(error),
    });
  },
  onStart: () => {
    logger.info({
      timezone: 'Asia/Tashkent', schedules: ['18:00', '23:59'], intervalMs: POLL_INTERVAL_MS,
    }, 'Telegram group summary scheduler started');
  },
});

export function startTelegramGroupSummaryScheduler(): void {
  schedulerJob.start();
}

export function stopTelegramGroupSummaryScheduler(): void {
  schedulerJob.stop();
}
