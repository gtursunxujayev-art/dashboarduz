import { prisma } from '@dashboarduz/db';
import { log, LogLevel } from '../observability';
import { telegramService } from '../integrations/telegram';
import { parseTelegramRecipients } from '../integrations/telegram-recipients';
import { decryptIntegrationTokens } from '../security/encryption';
import { getRedisClient } from '../queue/redis-client';

const REPORT_TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000; // GMT+5
const REPORT_TIMEZONE_LABEL = 'GMT+5';
const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

type ReportKind = 'daily' | 'weekly' | 'monthly';

type ReportWindow = {
  kind: ReportKind;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  periodKey: string;
};

type ReportMetrics = {
  newLeads: number;
  qualifiedLeads: number;
  nonQualifiedLeads: number;
  qualifiedShare: number;
  nonQualifiedShare: number;
  newSalesCount: number;
  conversionPercent: number;
  agreementTotal: number;
  incomeTotal: number;
  onlineSalesCount: number;
  onlineAgreementTotal: number;
  offlineSalesCount: number;
  offlineAgreementTotal: number;
  intensiveSalesCount: number;
  intensiveAgreementTotal: number;
  totalCalls: number;
  talkDurationSeconds: number;
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerInProgress = false;

function toLocalDate(date: Date): Date {
  return new Date(date.getTime() + REPORT_TIMEZONE_OFFSET_MS);
}

function fromLocalParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - REPORT_TIMEZONE_OFFSET_MS);
}

function formatLocalDate(date: Date): string {
  const local = toLocalDate(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date: Date): string {
  const local = toLocalDate(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const second = String(local.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${REPORT_TIMEZONE_LABEL}`;
}

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} UZS`;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizePercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number(value.toFixed(2));
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function createSimplePdf(lines: string[]): Buffer {
  const maxLines = 46;
  const sliced = lines.slice(0, maxLines);
  const streamParts: string[] = ['BT', '/F1 11 Tf', '50 800 Td', '14 TL'];

  for (let index = 0; index < sliced.length; index += 1) {
    const line = escapePdfText(sliced[index] || '');
    if (index > 0) {
      streamParts.push('T*');
    }
    streamParts.push(`(${line}) Tj`);
  }

  streamParts.push('ET');
  const contentStream = streamParts.join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function classifyCourseCategory(value: string | null | undefined): 'online' | 'offline' | 'intensive' | 'other' {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'other';
  }
  if (normalized.includes('online') || normalized.includes('onlayn')) {
    return 'online';
  }
  if (normalized.includes('offline') || normalized.includes('oflayn')) {
    return 'offline';
  }
  if (normalized.includes('intensive') || normalized.includes('intensiv')) {
    return 'intensive';
  }
  return 'other';
}

function resolveReportWindows(nowUtc: Date): ReportWindow[] {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const weekday = nowLocal.getUTCDay(); // 0 Sunday, 1 Monday

  const windows: ReportWindow[] = [];

  // Daily report for yesterday at 08:00 local.
  const dailyDispatchAt = fromLocalParts(year, month, day, 8, 0, 0, 0);
  if (nowUtc >= dailyDispatchAt) {
    const todayStart = fromLocalParts(year, month, day, 0, 0, 0, 0);
    const periodStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date(todayStart.getTime() - 1);
    windows.push({
      kind: 'daily',
      title: 'Daily Report (Yesterday)',
      periodStart,
      periodEnd,
      periodKey: formatLocalDate(periodStart),
    });
  }

  // Weekly report at Monday 07:55 local for previous week.
  if (weekday === 1) {
    const mondayStart = fromLocalParts(year, month, day, 0, 0, 0, 0);
    const weeklyDispatchAt = fromLocalParts(year, month, day, 7, 55, 0, 0);
    if (nowUtc >= weeklyDispatchAt) {
      const periodStart = new Date(mondayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(mondayStart.getTime() - 1);
      windows.push({
        kind: 'weekly',
        title: 'Weekly Report (Last Week)',
        periodStart,
        periodEnd,
        periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
      });
    }
  }

  // Monthly report at first day 07:50 local for previous month.
  if (day === 1) {
    const currentMonthStart = fromLocalParts(year, month, 1, 0, 0, 0, 0);
    const monthlyDispatchAt = fromLocalParts(year, month, 1, 7, 50, 0, 0);
    if (nowUtc >= monthlyDispatchAt) {
      const periodEnd = new Date(currentMonthStart.getTime() - 1);
      const previousMonthLocal = toLocalDate(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000));
      const periodStart = fromLocalParts(
        previousMonthLocal.getUTCFullYear(),
        previousMonthLocal.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      windows.push({
        kind: 'monthly',
        title: 'Monthly Report (Last Month)',
        periodStart,
        periodEnd,
        periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
      });
    }
  }

  return windows;
}

function buildLeadWhere(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  pipelineIds: string[],
): Record<string, unknown> {
  const baseWhere: Record<string, unknown> = {
    tenantId,
    amocrmId: { not: null },
    OR: [
      { externalCreatedAt: { gte: periodStart, lte: periodEnd } },
      {
        externalCreatedAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    ],
  };

  if (pipelineIds.length > 0) {
    baseWhere.pipelineId = { in: pipelineIds };
  }

  return baseWhere;
}

async function collectMetrics(params: {
  tenantId: string;
  tenantSettings: unknown;
  periodStart: Date;
  periodEnd: Date;
  selectedPipelineIds: string[];
}): Promise<ReportMetrics> {
  const dashboardSettings = (
    params.tenantSettings
    && typeof params.tenantSettings === 'object'
    && !Array.isArray(params.tenantSettings)
    && (params.tenantSettings as Record<string, unknown>).dashboard
    && typeof (params.tenantSettings as Record<string, unknown>).dashboard === 'object'
      ? (params.tenantSettings as Record<string, unknown>).dashboard as Record<string, unknown>
      : {}
  );

  const qualifiedStageIds = Array.isArray(dashboardSettings.qualifiedStageIds)
    ? dashboardSettings.qualifiedStageIds.map((value) => String(value))
    : [];

  const leadWhere = buildLeadWhere(
    params.tenantId,
    params.periodStart,
    params.periodEnd,
    params.selectedPipelineIds,
  );

  const [
    newLeads,
    qualifiedLeads,
    callAggregate,
    incomes,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere as any }),
    qualifiedStageIds.length > 0
      ? prisma.lead.count({
          where: {
            ...(leadWhere as any),
            status: { in: qualifiedStageIds },
          },
        })
      : Promise.resolve(0),
    prisma.call.aggregate({
      where: {
        tenantId: params.tenantId,
        startedAt: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      _count: { id: true },
      _sum: { duration: true },
    }),
    prisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        entryDate: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      select: {
        type: true,
        paymentAmount: true,
        coursePriceAmount: true,
        course: {
          select: {
            category: true,
            name: true,
          },
        },
      },
    }),
  ]);

  let incomeTotal = 0;
  let newSalesCount = 0;
  let agreementTotal = 0;

  let onlineSalesCount = 0;
  let offlineSalesCount = 0;
  let intensiveSalesCount = 0;
  let onlineAgreementTotal = 0;
  let offlineAgreementTotal = 0;
  let intensiveAgreementTotal = 0;

  for (const income of incomes) {
    incomeTotal += Number(income.paymentAmount || 0);

    if (income.type !== 'new_sale') {
      continue;
    }

    newSalesCount += 1;
    const agreementAmount = Number(income.coursePriceAmount || 0);
    agreementTotal += agreementAmount;

    const category = classifyCourseCategory(income.course?.category || income.course?.name);
    if (category === 'online') {
      onlineSalesCount += 1;
      onlineAgreementTotal += agreementAmount;
    } else if (category === 'offline') {
      offlineSalesCount += 1;
      offlineAgreementTotal += agreementAmount;
    } else if (category === 'intensive') {
      intensiveSalesCount += 1;
      intensiveAgreementTotal += agreementAmount;
    }
  }

  const nonQualifiedLeads = Math.max(0, newLeads - qualifiedLeads);
  const qualifiedShare = newLeads > 0 ? normalizePercentage((qualifiedLeads / newLeads) * 100) : 0;
  const nonQualifiedShare = newLeads > 0 ? normalizePercentage((nonQualifiedLeads / newLeads) * 100) : 0;
  const conversionPercent = newLeads > 0 ? normalizePercentage((newSalesCount / newLeads) * 100) : 0;

  return {
    newLeads,
    qualifiedLeads,
    nonQualifiedLeads,
    qualifiedShare,
    nonQualifiedShare,
    newSalesCount,
    conversionPercent,
    agreementTotal,
    incomeTotal,
    onlineSalesCount,
    onlineAgreementTotal,
    offlineSalesCount,
    offlineAgreementTotal,
    intensiveSalesCount,
    intensiveAgreementTotal,
    totalCalls: Number(callAggregate._count.id || 0),
    talkDurationSeconds: Number(callAggregate._sum.duration || 0),
  };
}

function buildReportLines(params: {
  tenantName: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  metrics: ReportMetrics;
}): string[] {
  const { metrics } = params;

  return [
    'Dashboarduz CRM Report',
    `Tenant: ${params.tenantName}`,
    `Report: ${params.title}`,
    `Period: ${formatLocalDateTime(params.periodStart)} - ${formatLocalDateTime(params.periodEnd)}`,
    `Generated: ${formatLocalDateTime(params.generatedAt)}`,
    '',
    'LEADS',
    `- New leads: ${metrics.newLeads}`,
    `- Qualified leads: ${metrics.qualifiedLeads} (${metrics.qualifiedShare.toFixed(2)}%)`,
    `- Non-qualified leads: ${metrics.nonQualifiedLeads} (${metrics.nonQualifiedShare.toFixed(2)}%)`,
    '',
    'SALES & INCOME',
    `- New sales: ${metrics.newSalesCount}`,
    `- Conversion (sales/new leads): ${metrics.conversionPercent.toFixed(2)}%`,
    `- Agreement amount: ${formatCurrency(metrics.agreementTotal)}`,
    `- Income received: ${formatCurrency(metrics.incomeTotal)}`,
    '',
    'SALES BY CATEGORY',
    `- Online: ${metrics.onlineSalesCount} sale(s), agreement ${formatCurrency(metrics.onlineAgreementTotal)}`,
    `- Offline: ${metrics.offlineSalesCount} sale(s), agreement ${formatCurrency(metrics.offlineAgreementTotal)}`,
    `- Intensive: ${metrics.intensiveSalesCount} sale(s), agreement ${formatCurrency(metrics.intensiveAgreementTotal)}`,
    '',
    'CALLS',
    `- Total calls: ${metrics.totalCalls}`,
    `- Total talk time: ${formatDuration(metrics.talkDurationSeconds)}`,
  ];
}

async function dispatchWindow(window: ReportWindow, nowUtc: Date): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: {
      type: 'telegram',
      status: 'active',
      tokensEncrypted: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokensEncrypted: true,
      config: true,
      tenant: {
        select: {
          name: true,
          settings: true,
        },
      },
    },
  });

  const redis = getRedisClient();

  for (const integration of integrations) {
    const recipients = parseTelegramRecipients(integration.config).filter(
      (recipient) => recipient.started && recipient.selectedForReports,
    );
    if (recipients.length === 0) {
      continue;
    }

    const lockKey = `telegram-report:${window.kind}:${integration.tenantId}:${window.periodKey}`;
    const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', LOCK_TTL_SECONDS, 'NX');
    if (lockResult !== 'OK') {
      continue;
    }

    try {
      const amocrmIntegration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: integration.tenantId,
            type: 'amocrm',
          },
        },
        select: {
          config: true,
        },
      });
      const selectedPipelineIds = Array.isArray((amocrmIntegration?.config as any)?.selectedPipelineIds)
        ? (amocrmIntegration?.config as any).selectedPipelineIds.map((value: unknown) => String(value))
        : [];

      const metrics = await collectMetrics({
        tenantId: integration.tenantId,
        tenantSettings: integration.tenant.settings,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        selectedPipelineIds,
      });

      const lines = buildReportLines({
        tenantName: integration.tenant.name || integration.tenantId,
        title: window.title,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        generatedAt: nowUtc,
        metrics,
      });
      const pdfBuffer = createSimplePdf(lines);
      const fileName = `dashboard-report-${window.kind}-${window.periodKey}.pdf`;
      const caption = `${window.title}\n${formatLocalDate(window.periodStart)} - ${formatLocalDate(window.periodEnd)}`;

      const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted || '');
      if (!tokens.botToken) {
        throw new Error('Telegram bot token is missing');
      }

      for (const recipient of recipients) {
        await telegramService.sendDocument(tokens.botToken, recipient.chatId, pdfBuffer, fileName, caption);
      }

      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_sent',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            recipientCount: recipients.length,
            fileName,
          },
        },
      });

      log(LogLevel.INFO, 'Scheduled Telegram report sent', {
        tenantId: integration.tenantId,
        schedule: window.kind,
        recipients: recipients.length,
      });
    } catch (error: any) {
      await redis.del(lockKey);
      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_failed',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            error: error?.message || 'Unknown error',
          },
        },
      });

      log(LogLevel.ERROR, 'Scheduled Telegram report failed', {
        tenantId: integration.tenantId,
        schedule: window.kind,
        error: error?.message || 'Unknown error',
      });
    }
  }
}

async function tickScheduler(): Promise<void> {
  if (schedulerInProgress) {
    return;
  }
  schedulerInProgress = true;

  try {
    const nowUtc = new Date();
    const dueWindows = resolveReportWindows(nowUtc);
    for (const window of dueWindows) {
      await dispatchWindow(window, nowUtc);
    }
  } catch (error: any) {
    log(LogLevel.ERROR, 'Telegram report scheduler tick failed', {
      error: error?.message || 'Unknown error',
    });
  } finally {
    schedulerInProgress = false;
  }
}

export function startTelegramReportScheduler(): void {
  if (schedulerTimer) {
    return;
  }

  schedulerTimer = setInterval(() => {
    void tickScheduler();
  }, POLL_INTERVAL_MS);

  void tickScheduler();

  log(LogLevel.INFO, 'Telegram report scheduler started', {
    timezone: REPORT_TIMEZONE_LABEL,
    intervalMs: POLL_INTERVAL_MS,
  });
}

export function stopTelegramReportScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
