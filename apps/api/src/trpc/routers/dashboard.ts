import { prisma } from '@dashboarduz/db';
import { protectedProcedure, router } from '../trpc';

const LEAD_STATUS_CONFIG = [
  { key: 'new', name: 'New', color: '#3B82F6' },
  { key: 'contacted', name: 'Contacted', color: '#F59E0B' },
  { key: 'qualified', name: 'Qualified', color: '#10B981' },
  { key: 'lost', name: 'Lost', color: '#EF4444' },
] as const;

const ANSWERED_CALL_STATUSES = new Set(['completed', 'answered', 'success']);
const MISSED_CALL_STATUSES = new Set(['missed', 'failed', 'busy', 'no_answer']);

const INTEGRATION_LABELS = [
  { type: 'amocrm', name: 'AmoCRM' },
  { type: 'telegram', name: 'Telegram' },
  { type: 'voip_utel', name: 'UTeL' },
] as const;

function normalizeStatus(status: string | null | undefined): string {
  if (!status) {
    return 'unknown';
  }
  return status.trim().toLowerCase();
}

function createMonthBuckets(now: Date) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return {
      date,
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleString('en-US', { month: 'short' }),
    };
  });
}

export const dashboardRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthBuckets = createMonthBuckets(now);
    const trendStart = monthBuckets[0]?.date ?? new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      leadStatusGroups,
      leadsForTrend,
      totalLeads,
      callStatusGroups,
      callDurationAggregate,
      pendingNotifications,
      integrations,
    ] = await Promise.all([
      prisma.lead.groupBy({
        by: ['status'],
        where: { tenantId: ctx.tenantId },
        _count: { _all: true },
      }),
      prisma.lead.findMany({
        where: {
          tenantId: ctx.tenantId,
          createdAt: { gte: trendStart },
        },
        select: { createdAt: true },
      }),
      prisma.lead.count({
        where: { tenantId: ctx.tenantId },
      }),
      prisma.call.groupBy({
        by: ['status'],
        where: { tenantId: ctx.tenantId },
        _count: { _all: true },
      }),
      prisma.call.aggregate({
        where: {
          tenantId: ctx.tenantId,
          duration: { not: null },
        },
        _avg: { duration: true },
      }),
      prisma.notification.count({
        where: {
          tenantId: ctx.tenantId,
          status: { in: ['pending', 'retrying'] },
        },
      }),
      prisma.integration.findMany({
        where: { tenantId: ctx.tenantId },
        select: { type: true, status: true },
      }),
    ]);

    const leadStatusCounts = new Map<string, number>();
    for (const group of leadStatusGroups) {
      const key = normalizeStatus(group.status);
      leadStatusCounts.set(key, (leadStatusCounts.get(key) ?? 0) + group._count._all);
    }

    const leadStatusData = LEAD_STATUS_CONFIG.map((item) => ({
      name: item.name,
      value: leadStatusCounts.get(item.key) ?? 0,
      color: item.color,
    }));

    const monthLeadCounts = new Map<string, number>();
    for (const lead of leadsForTrend) {
      const key = `${lead.createdAt.getFullYear()}-${lead.createdAt.getMonth()}`;
      monthLeadCounts.set(key, (monthLeadCounts.get(key) ?? 0) + 1);
    }

    const monthlyLeadsData = monthBuckets.map((bucket) => ({
      month: bucket.label,
      leads: monthLeadCounts.get(bucket.key) ?? 0,
    }));

    const callStatusCounts = new Map<string, number>();
    for (const group of callStatusGroups) {
      const key = normalizeStatus(group.status);
      callStatusCounts.set(key, (callStatusCounts.get(key) ?? 0) + group._count._all);
    }

    const totalCalls = Array.from(callStatusCounts.values()).reduce((sum, value) => sum + value, 0);
    let answeredCalls = 0;
    let missedCalls = 0;
    for (const [status, count] of callStatusCounts.entries()) {
      if (ANSWERED_CALL_STATUSES.has(status)) {
        answeredCalls += count;
      } else if (MISSED_CALL_STATUSES.has(status)) {
        missedCalls += count;
      }
    }

    const avgCallDurationSeconds = Math.round(callDurationAggregate._avg.duration ?? 0);
    const qualifiedLeads = leadStatusCounts.get('qualified') ?? 0;
    const conversionRate = totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(2)) : 0;

    const integrationByType = new Map(integrations.map((item) => [item.type, item.status]));
    const integrationActivityData = INTEGRATION_LABELS.map((item) => {
      const status = integrationByType.get(item.type) ?? 'disconnected';
      return {
        name: item.name,
        active: status === 'active' ? 1 : 0,
        errors: status === 'error' ? 1 : 0,
      };
    });

    return {
      leadStatusData,
      monthlyLeadsData,
      callMetricsData: [
        { name: 'Total Calls', value: totalCalls },
        { name: 'Answered', value: answeredCalls },
        { name: 'Missed', value: missedCalls },
      ],
      integrationActivityData,
      summary: {
        totalLeads,
        conversionRate,
        avgCallDurationSeconds,
        pendingNotifications,
      },
      updatedAt: now.toISOString(),
    };
  }),
});
