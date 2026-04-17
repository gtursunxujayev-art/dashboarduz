import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService, type AmoCRMLead, type AmoCRMLeadPipeline, type AmoCRMUser } from '../../services/integrations/amocrm';
import {
  getAmoCRMActivityMetrics,
  type AmoCRMActivityMetrics,
  summarizeAmoCRMActivityMetrics,
} from '../../services/integrations/amocrm-activity';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';
import { log, LogLevel } from '../../services/observability';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { telegramService } from '../../services/integrations/telegram';
import { getCorporateCallDurationByManager } from '../../services/corporate-call-durations';

const WON_STATUS_ID = '142';
const LOST_STATUS_ID = '143';
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const sellerRangeSchema = z.enum(['today', 'week', 'month', 'last30days', 'custom']);
type SellerRange = z.infer<typeof sellerRangeSchema>;
const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const SELLERS_LIST_CACHE_TTL_MS = 2 * 60 * 1000;
const SELLERS_ACTIVITY_CACHE_TTL_MS = 10 * 60 * 1000;

type SellersListCacheEntry = {
  expiresAt: number;
  data: any[];
};

const sellersListCache = new Map<string, SellersListCacheEntry>();

type SellerIncomeMetricSource = {
  type: string | null;
  paymentAmount: number | null;
  coursePriceAmount: number | null;
  course: {
    category: string | null;
    name?: string | null;
  } | null;
};

type SellerSalesMetrics = {
  newSalesCount: number;
  newSalesAgreementAmount: number;
  incomeAmount: number;
  averageSalesCount: number;
  averageAgreementAmount: number;
  onlineSalesCount: number;
  onlineSalesAgreementAmount: number;
  onlineSalesIncomeAmount: number;
  offlineSalesCount: number;
  offlineSalesAgreementAmount: number;
  offlineSalesIncomeAmount: number;
  intensiveSalesCount: number;
  intensiveSalesAgreementAmount: number;
  intensiveSalesIncomeAmount: number;
  totalPaidAmount: number;
  totalAgreementAmount: number;
  debtCollectionRate: number;
};

type SellerReportSeller = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
};

type SellerReportPayload = {
  seller: SellerReportSeller;
  metrics: ReturnType<typeof buildMetrics> & SellerSalesMetrics;
  rangeStart: Date;
  rangeEnd: Date;
};

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAmoDate(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseAmoDate(asNumber);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

function getRangeStart(range: SellerRange, now: Date): Date {
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
  const shiftedNow = new Date(now.getTime() + offsetMs);

  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - offsetMs);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(Date.UTC(year, month, date - daysSinceMonday) - offsetMs);
  }

  if (range === 'last30days') {
    return new Date(Date.UTC(year, month, date - 29) - offsetMs);
  }

  return new Date(Date.UTC(year, month, 1) - offsetMs);
}

function parseCustomDate(input: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Custom date must be in YYYY-MM-DD format.' });
  }

  const timestamp = `${input}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid custom date: ${input}` });
  }

  return parsed;
}

function resolveDateRange(range: SellerRange, now: Date, dateFrom?: string, dateTo?: string) {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Both dateFrom and dateTo are required when range is custom.',
    });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);
  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateTo must be greater than or equal to dateFrom.' });
  }

  return { rangeStart, rangeEnd };
}

function getDealAmount(lead: AmoCRMLead): number {
  const maybePrice = (lead as Record<string, unknown>).price;
  if (typeof maybePrice === 'number' && Number.isFinite(maybePrice)) {
    return maybePrice;
  }
  if (typeof maybePrice === 'string') {
    const parsed = Number(maybePrice);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function getLeadResponsibleId(lead: AmoCRMLead): string | null {
  return asString(lead.responsible_user_id);
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function normalizeTelegramSecret(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }
  const normalized = rawValue.replace(/^['"`]+|['"`]+$/g, '').trim();
  return normalized || null;
}

function resolveSellerIncomeCategory(source: SellerIncomeMetricSource): 'online' | 'offline' | 'intensive' | null {
  const rawCategory = asString(source.course?.category)?.toLowerCase();
  if (rawCategory === 'online' || rawCategory === 'offline' || rawCategory === 'intensive') {
    return rawCategory;
  }

  const courseName = asString(source.course?.name)?.toLowerCase() || '';
  if (courseName.includes('onlayn') || courseName.includes('online')) {
    return 'online';
  }
  if (courseName.includes('oflayn') || courseName.includes('offline')) {
    return 'offline';
  }
  if (courseName.includes('intensiv') || courseName.includes('intensive')) {
    return 'intensive';
  }

  return null;
}

function getInclusiveRangeDayCount(rangeStart: Date, rangeEnd: Date): number {
  const millis = rangeEnd.getTime() - rangeStart.getTime();
  if (millis <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(millis / (24 * 60 * 60 * 1000)));
}

function summarizeSellerIncomeMetrics(
  incomes: SellerIncomeMetricSource[],
  rangeStart: Date,
  rangeEnd: Date,
): SellerSalesMetrics {
  let newSalesCount = 0;
  let newSalesAgreementAmount = 0;
  let incomeAmount = 0;

  let onlineSalesCount = 0;
  let onlineSalesAgreementAmount = 0;
  let onlineSalesIncomeAmount = 0;
  let offlineSalesCount = 0;
  let offlineSalesAgreementAmount = 0;
  let offlineSalesIncomeAmount = 0;
  let intensiveSalesCount = 0;
  let intensiveSalesAgreementAmount = 0;
  let intensiveSalesIncomeAmount = 0;
  let totalPaidAmount = 0;
  let totalAgreementAmount = 0;

  for (const income of incomes) {
    const paymentAmount = Number(income.paymentAmount || 0);
    const agreementAmount = Number(income.coursePriceAmount || 0);
    const category = resolveSellerIncomeCategory(income);

    incomeAmount += paymentAmount;
    totalPaidAmount += paymentAmount;
    totalAgreementAmount += agreementAmount;

    if (income.type === 'new_sale') {
      newSalesCount += 1;
      newSalesAgreementAmount += agreementAmount;
      if (category === 'online') {
        onlineSalesCount += 1;
        onlineSalesAgreementAmount += agreementAmount;
      } else if (category === 'offline') {
        offlineSalesCount += 1;
        offlineSalesAgreementAmount += agreementAmount;
      } else if (category === 'intensive') {
        intensiveSalesCount += 1;
        intensiveSalesAgreementAmount += agreementAmount;
      }
    }

    if (category === 'online') {
      onlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'offline') {
      offlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'intensive') {
      intensiveSalesIncomeAmount += paymentAmount;
    }
  }

  const rangeDayCount = getInclusiveRangeDayCount(rangeStart, rangeEnd);
  const averageSalesCount = newSalesCount > 0 ? newSalesCount / rangeDayCount : 0;
  const averageAgreementAmount = newSalesCount > 0 ? newSalesAgreementAmount / newSalesCount : 0;

  return {
    newSalesCount,
    newSalesAgreementAmount: Number(newSalesAgreementAmount.toFixed(2)),
    incomeAmount: Number(incomeAmount.toFixed(2)),
    averageSalesCount: Number(averageSalesCount.toFixed(2)),
    averageAgreementAmount: Number(averageAgreementAmount.toFixed(2)),
    onlineSalesCount,
    onlineSalesAgreementAmount: Number(onlineSalesAgreementAmount.toFixed(2)),
    onlineSalesIncomeAmount: Number(onlineSalesIncomeAmount.toFixed(2)),
    offlineSalesCount,
    offlineSalesAgreementAmount: Number(offlineSalesAgreementAmount.toFixed(2)),
    offlineSalesIncomeAmount: Number(offlineSalesIncomeAmount.toFixed(2)),
    intensiveSalesCount,
    intensiveSalesAgreementAmount: Number(intensiveSalesAgreementAmount.toFixed(2)),
    intensiveSalesIncomeAmount: Number(intensiveSalesIncomeAmount.toFixed(2)),
    totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
    totalAgreementAmount: Number(totalAgreementAmount.toFixed(2)),
    debtCollectionRate: totalAgreementAmount > 0
      ? Number(((totalPaidAmount / totalAgreementAmount) * 100).toFixed(2))
      : 0,
  };
}

function buildSellerReportPdf(params: SellerReportPayload): Buffer {
  const lines = [
    `${params.seller.name} — agent report`,
    `Period: ${params.rangeStart.toISOString()} — ${params.rangeEnd.toISOString()}`,
    '',
    `Sales count: ${params.metrics.newSalesCount}`,
    `Agreement amount: ${Math.round(params.metrics.newSalesAgreementAmount).toLocaleString('en-US')} UZS`,
    `Income amount: ${Math.round(params.metrics.incomeAmount).toLocaleString('en-US')} UZS`,
    `Average sales: ${params.metrics.averageSalesCount.toFixed(2)}`,
    '',
    `Online: ${params.metrics.onlineSalesCount} | Agreement ${Math.round(params.metrics.onlineSalesAgreementAmount).toLocaleString('en-US')} UZS | Income ${Math.round(params.metrics.onlineSalesIncomeAmount).toLocaleString('en-US')} UZS`,
    `Offline: ${params.metrics.offlineSalesCount} | Agreement ${Math.round(params.metrics.offlineSalesAgreementAmount).toLocaleString('en-US')} UZS | Income ${Math.round(params.metrics.offlineSalesIncomeAmount).toLocaleString('en-US')} UZS`,
    `Intensive: ${params.metrics.intensiveSalesCount} | Agreement ${Math.round(params.metrics.intensiveSalesAgreementAmount).toLocaleString('en-US')} UZS | Income ${Math.round(params.metrics.intensiveSalesIncomeAmount).toLocaleString('en-US')} UZS`,
    '',
    `Calls: ${params.metrics.totalCalls}`,
    `Call duration: ${params.metrics.totalCallDuration} seconds`,
    `Follow-ups done: ${params.metrics.followUpCount}`,
    `Notes: ${params.metrics.noteCount}`,
    `CRM changes: ${params.metrics.stageChangeCount}`,
    `Today's follow-ups: ${params.metrics.todayFollowUpCount}`,
    `Overdue follow-ups: ${params.metrics.overdueFollowUpCount}`,
  ];

  const content = lines
    .map((line, index) => {
      const escaped = line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/[^\x20-\x7E]/g, '?');
      return `BT /F1 12 Tf 50 ${780 - index * 20} Td (${escaped}) Tj ET`;
    })
    .join('\n');

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream\nendobj\n`,
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

async function resolveTelegramBotTokenForTenant(tenantId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'telegram',
      },
    },
    select: {
      tokensEncrypted: true,
    },
  });

  let botToken = normalizeTelegramSecret(process.env.TELEGRAM_BOT_TOKEN || undefined);
  if (integration?.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      botToken = normalizeTelegramSecret(tokens.botToken || tokens.token || undefined) || botToken;
    } catch (error) {
      log(LogLevel.WARN, 'Failed to decrypt Telegram integration token for sellers report', {
        tenantId,
        error: String((error as Error)?.message || error),
      });
    }
  }

  return botToken;
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 150;
}

function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('amocrmResponsibleUserId') || message.includes('utelManagerExternalId');
}

function toManagerRole(user: AmoCRMUser): string[] {
  return user.rights?.is_admin ? ['Manager'] : ['Agent'];
}

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
  const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;
  try {
    currentUser = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

async function computeLeadResponseTimes(params: {
  accessToken: string;
  baseUrl: string | undefined;
  managerIds: string[];
  newLeads: AmoCRMLead[];
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<Map<string, { avgResponseSeconds: number; medianResponseSeconds: number; respondedCount: number; totalCount: number }>> {
  const result = new Map<string, { avgResponseSeconds: number; medianResponseSeconds: number; respondedCount: number; totalCount: number }>();
  if (!params.newLeads.length || !params.managerIds.length) {
    return result;
  }

  // Fetch events (notes, status changes, etc.) for leads in the period
  let events: Array<Record<string, unknown>> = [];
  try {
    events = await amocrmService.fetchAllEvents(
      params.accessToken,
      {
        dateFrom: params.rangeStart,
        dateTo: params.rangeEnd,
        userIds: params.managerIds,
        entityType: 'lead',
        limit: 250,
        maxPages: 30,
      },
      params.baseUrl,
    );
  } catch {
    return result;
  }

  // Map entity_id -> earliest event timestamp (seconds)
  const firstEventByLead = new Map<string, number>();
  for (const event of events) {
    const entityId = String(event.entity_id ?? '').trim();
    if (!entityId) continue;
    const createdAt = event.created_at;
    let eventTs: number | null = null;
    if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
      eventTs = createdAt > 1_000_000_000_000 ? createdAt / 1000 : createdAt;
    } else if (typeof createdAt === 'string') {
      const asNum = Number(createdAt);
      if (!Number.isNaN(asNum)) {
        eventTs = asNum > 1_000_000_000_000 ? asNum / 1000 : asNum;
      }
    }
    if (eventTs === null) continue;
    const existing = firstEventByLead.get(entityId);
    if (!existing || eventTs < existing) {
      firstEventByLead.set(entityId, eventTs);
    }
  }

  // Group new leads by responsible manager
  const leadsByManager = new Map<string, AmoCRMLead[]>();
  const managerIdSet = new Set(params.managerIds);
  for (const lead of params.newLeads) {
    const managerId = asString(lead.responsible_user_id);
    if (!managerId || !managerIdSet.has(managerId)) continue;
    const current = leadsByManager.get(managerId) || [];
    current.push(lead);
    leadsByManager.set(managerId, current);
  }

  // Calculate response times per manager
  for (const [managerId, leads] of leadsByManager.entries()) {
    const responseTimes: number[] = [];
    for (const lead of leads) {
      const leadId = asString(lead.id);
      if (!leadId) continue;
      const leadCreatedAt = parseAmoDate(lead.created_at).getTime() / 1000;
      const firstEvent = firstEventByLead.get(leadId);
      if (firstEvent !== undefined && firstEvent > leadCreatedAt) {
        responseTimes.push(firstEvent - leadCreatedAt);
      }
    }
    const totalCount = leads.length;
    const respondedCount = responseTimes.length;
    if (respondedCount === 0) {
      result.set(managerId, { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount });
      continue;
    }
    const avg = responseTimes.reduce((s, v) => s + v, 0) / respondedCount;
    const sorted = responseTimes.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);
    result.set(managerId, {
      avgResponseSeconds: Math.round(avg),
      medianResponseSeconds: Math.round(median as number),
      respondedCount,
      totalCount,
    });
  }

  return result;
}

function buildMetrics(
  activeLeads: AmoCRMLead[],
  wonLeadsData: AmoCRMLead[],
  lostLeadsData: AmoCRMLead[],
  calls: Array<{ duration: number | null; direction: string; status: string; startedAt?: Date | null }>,
  options?: {
    incomeAmountOverride?: number | null;
    neutralizeLeadOutcomes?: boolean;
    activityMetrics?: AmoCRMActivityMetrics | null;
    manualDurationSeconds?: number;
  },
) {
  const activeLeadsCount = activeLeads.length;
  const neutralizeLeadOutcomes = Boolean(options?.neutralizeLeadOutcomes);
  const wonLeads = neutralizeLeadOutcomes ? 0 : wonLeadsData.length;
  const lostLeads = neutralizeLeadOutcomes ? 0 : lostLeadsData.length;
  const totalLeads = neutralizeLeadOutcomes ? activeLeadsCount : (activeLeadsCount + wonLeads + lostLeads);
  const conversionRate = neutralizeLeadOutcomes ? 0 : (totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0);

  const totalDealAmount = neutralizeLeadOutcomes
    ? 0
    : wonLeadsData.reduce((sum, lead) => sum + getDealAmount(lead), 0);
  const averageDealAmount = neutralizeLeadOutcomes ? 0 : (wonLeads > 0 ? totalDealAmount / wonLeads : 0);

  const totalCalls = calls.length;
  const inboundCalls = calls.filter((call) => call.direction === 'inbound').length;
  const outboundCalls = calls.filter((call) => call.direction === 'outbound').length;
  const missedCalls = calls.filter((call) => call.status === 'missed').length;
  const missedCallRate = totalCalls > 0 ? (missedCalls / totalCalls) * 100 : 0;
  const manualDurationSeconds = Math.max(0, Number(options?.manualDurationSeconds || 0));
  const totalCallDuration = calls.reduce((sum, call) => sum + (call.duration || 0), 0) + manualDurationSeconds;
  const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;
  const activeCallDays = new Set(
    calls
      .map((call) => (call.startedAt instanceof Date ? call.startedAt : null))
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.toISOString().slice(0, 10)),
  ).size;
  const averageDailyCalls = activeCallDays > 0 ? totalCalls / activeCallDays : 0;
  const averageDailyCallDuration = activeCallDays > 0 ? totalCallDuration / activeCallDays : 0;
  const incomeAmount = typeof options?.incomeAmountOverride === 'number' ? options.incomeAmountOverride : totalDealAmount;
  const activityMetrics = options?.activityMetrics || {
    followUpCount: 0,
    noteCount: 0,
    stageChangeCount: 0,
    overdueFollowUpCount: 0,
    todayFollowUpCount: 0,
  };

  return {
    newLeads: neutralizeLeadOutcomes ? activeLeadsCount : totalLeads,
    qualifiedLeads: neutralizeLeadOutcomes ? 0 : wonLeads,
    unqualifiedLeads: neutralizeLeadOutcomes ? 0 : lostLeads,
    salesCount: neutralizeLeadOutcomes ? 0 : wonLeads,
    totalLeads,
    activeLeads: activeLeadsCount,
    wonLeads,
    lostLeads,
    conversionRate: Number(conversionRate.toFixed(2)),
    totalDealAmount: Number(totalDealAmount.toFixed(2)),
    averageDealAmount: Number(averageDealAmount.toFixed(2)),
    totalCalls,
    inboundCalls,
    outboundCalls,
    missedCalls,
    missedCallRate: Number(missedCallRate.toFixed(2)),
    totalCallDuration,
    averageCallDuration: Number(averageCallDuration.toFixed(2)),
    averageDailyCalls: Number(averageDailyCalls.toFixed(2)),
    averageDailyCallDuration: Number(averageDailyCallDuration.toFixed(2)),
    incomeAmount: Number(incomeAmount.toFixed(2)),
    followUpCount: activityMetrics.followUpCount,
    noteCount: activityMetrics.noteCount,
    stageChangeCount: activityMetrics.stageChangeCount,
    overdueFollowUpCount: activityMetrics.overdueFollowUpCount,
    todayFollowUpCount: activityMetrics.todayFollowUpCount,
  };
}

function getSelectedPipelines(
  selectedPipelineIds: string[] | null,
  pipelines: AmoCRMLeadPipeline[],
): string[] {
  if (selectedPipelineIds !== null) {
    return selectedPipelineIds.map((id) => String(id).trim()).filter(Boolean);
  }

  return pipelines
    .map((pipeline) => asString(pipeline.id))
    .filter(Boolean) as string[];
}

function buildStatusFilters(
  selectedPipelineIds: string[],
  pipelines: AmoCRMLeadPipeline[],
  statusIds: string[],
): Array<{ pipelineId: string; statusId: string }> {
  if (selectedPipelineIds.length === 0 || statusIds.length === 0) {
    return [];
  }

  const selected = new Set(selectedPipelineIds);
  const unique = new Set<string>();
  const filters: Array<{ pipelineId: string; statusId: string }> = [];

  for (const pipeline of pipelines) {
    const pipelineId = asString(pipeline.id);
    if (!pipelineId || !selected.has(pipelineId)) {
      continue;
    }

    const statuses = Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : [];
    const availableStatusIds = new Set(
      statuses
        .map((status) => asString(status.id))
        .filter(Boolean) as string[],
    );

    for (const statusId of statusIds) {
      if (!availableStatusIds.has(statusId)) {
        continue;
      }

      const key = `${pipelineId}:${statusId}`;
      if (unique.has(key)) {
        continue;
      }
      unique.add(key);
      filters.push({ pipelineId, statusId });
    }
  }

  return filters;
}

function buildStatusFilterSet(filters: Array<{ pipelineId: string; statusId: string }>): Set<string> {
  return new Set(filters.map((filter) => `${filter.pipelineId}:${filter.statusId}`));
}

function isLeadInStatusSet(lead: AmoCRMLead, statusSet: Set<string>) {
  const pipelineId = asString(lead.pipeline_id);
  const statusId = asString(lead.status_id);
  if (!pipelineId || !statusId) {
    return false;
  }
  return statusSet.has(`${pipelineId}:${statusId}`);
}

async function fetchLeadsByStatusFilters(
  accessToken: string,
  baseUrl: string | undefined,
  pipelineIds: string[],
  statusFilters: Array<{ pipelineId: string; statusId: string }>,
  responsibleUserIds: string[],
  rangeStart?: Date,
  rangeEnd?: Date,
  withContacts = false,
): Promise<AmoCRMLead[]> {
  if (pipelineIds.length === 0 || statusFilters.length === 0 || responsibleUserIds.length === 0) {
    return [];
  }

  const statusSet = buildStatusFilterSet(statusFilters);
  try {
    return await amocrmService.fetchAllLeads(
      accessToken,
      {
        pipelineIds,
        statusFilters,
        responsibleUserIds,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
        with: withContacts ? 'contacts' : undefined,
        limit: 250,
      },
      baseUrl,
    );
  } catch {
    const fallback = await amocrmService.fetchAllLeads(
      accessToken,
      {
        pipelineIds,
        responsibleUserIds,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
        with: withContacts ? 'contacts' : undefined,
        limit: 250,
      },
      baseUrl,
    );
    return fallback.filter((lead) => {
      if (!isLeadInStatusSet(lead, statusSet)) {
        return false;
      }
      if (!rangeStart || !rangeEnd) {
        return true;
      }
      const createdAt = parseAmoDate(lead.created_at);
      return createdAt >= rangeStart && createdAt <= rangeEnd;
    });
  }
}

async function getManagerExtensionsMap(tenantId: string, managerIds: string[]): Promise<Map<string, string[]>> {
  if (managerIds.length === 0) {
    return new Map();
  }

  try {
    const mappedUsers = await prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        amocrmResponsibleUserId: { in: managerIds },
        utelManagerExternalId: { not: null },
      },
      select: {
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
      },
    });

    const byManager = new Map<string, Set<string>>();
    for (const mappedUser of mappedUsers as Array<{ amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }>) {
      const managerId = asString(mappedUser.amocrmResponsibleUserId);
      const extension = normalizeDigits(mappedUser.utelManagerExternalId || '');
      if (!managerId || !isAllowedUtelManagerExtension(extension)) {
        continue;
      }
      const current = byManager.get(managerId) || new Set<string>();
      current.add(extension);
      byManager.set(managerId, current);
    }

    return new Map(
      Array.from(byManager.entries()).map(([managerId, extensions]) => [managerId, Array.from(extensions)]),
    );
  } catch (error) {
    if (!isMissingUserMappingColumnError(error)) {
      throw error;
    }
    return new Map();
  }
}

function resolveCallExtension(call: { from: string; to: string }): string | null {
  const fromExtension = normalizeDigits(call.from);
  if (isAllowedUtelManagerExtension(fromExtension)) {
    return fromExtension;
  }
  const toExtension = normalizeDigits(call.to);
  if (isAllowedUtelManagerExtension(toExtension)) {
    return toExtension;
  }
  return null;
}

function buildSellersListCacheKey(
  tenantId: string,
  scopedResponsibleUserId: string | null,
  pipelineIds: string[],
  range: SellerRange,
  corporateRevision: string,
  dateFrom?: string,
  dateTo?: string,
): string {
  return [
    tenantId,
    scopedResponsibleUserId || 'all',
    pipelineIds.slice().sort().join(','),
    range,
    corporateRevision,
    dateFrom || '',
    dateTo || '',
  ].join('|');
}

export const sellersRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        range: sellerRangeSchema.default('last30days').optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
    const startedAtMs = Date.now();
    const timings: Record<string, number> = {};
    const now = new Date();
    const range = input?.range || 'last30days';
    const { rangeStart, rangeEnd } = resolveDateRange(range, now, input?.dateFrom, input?.dateTo);
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
    timings.scopeMs = Date.now() - startedAtMs;

    const amoContextStartedMs = Date.now();
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
    timings.amoContextMs = Date.now() - amoContextStartedMs;

    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const amocrmUsersPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl);
      timings.amocrmUsersMs = Date.now() - stepStartedMs;
      return result;
    })();

    const pipelinesPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
      timings.amocrmPipelinesMs = Date.now() - stepStartedMs;
      return result;
    })();

    const [amocrmUsers, pipelinesResponse] = await Promise.all([amocrmUsersPromise, pipelinesPromise]);
    const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
    const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

    const managerPreparationStartedMs = Date.now();
    const managers = amocrmUsers
      .filter((user) => user.is_active !== false)
      .filter((user) => {
        if (!scope.isScoped) {
          return true;
        }
        return asString(user.id) === scope.responsibleUserId;
      });

    const managerIds = new Set(
      managers
        .map((manager) => asString(manager.id))
        .filter(Boolean) as string[],
    );
    timings.managerPreparationMs = Date.now() - managerPreparationStartedMs;

    const managerIdList = Array.from(managerIds);
    const corporateRevision = await prisma.corporateCallDuration.aggregate({
      where: { tenantId: ctx.tenantId },
      _max: { updatedAt: true },
    });
    const corporateRevisionKey = corporateRevision._max.updatedAt
      ? corporateRevision._max.updatedAt.toISOString()
      : '';
    const listCacheKey = buildSellersListCacheKey(
      ctx.tenantId,
      scope.isScoped ? (scope.responsibleUserId || '__unmapped__') : null,
      selectedPipelineIds,
      range,
      corporateRevisionKey,
      input?.dateFrom,
      input?.dateTo,
    );
    const cached = sellersListCache.get(listCacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      timings.totalMs = Date.now() - startedAtMs;
      log(LogLevel.INFO, 'Sellers list timings', {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        managerCount: managers.length,
        selectedPipelineIds,
        cacheHit: true,
        timings,
      });
      return cached.data;
    }

    const leadsFetchStartedMs = Date.now();
    const activeLeadsPromise = (async () => {
      const allPipelineLeads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: selectedPipelineIds,
          responsibleUserIds: managerIdList,
          limit: 250,
          maxPages: 20,
        },
        amoContext.baseUrl,
      );
      return allPipelineLeads.filter((lead) => {
        const statusId = asString(lead.status_id);
        return statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID;
      });
    })();

    const newLeadsInRangePromise = amocrmService.fetchAllLeads(
      amoContext.accessToken,
      {
        pipelineIds: selectedPipelineIds,
        responsibleUserIds: managerIdList,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
        limit: 250,
        maxPages: 20,
      },
      amoContext.baseUrl,
    );

    const activityFetchStartedMs = Date.now();
    const roundedNow = new Date(Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000));
    const activityPromise = getAmoCRMActivityMetrics({
      tenantId: ctx.tenantId,
      accessToken: amoContext.accessToken,
      baseUrl: amoContext.baseUrl,
      managerIds: managerIdList,
      rangeStart,
      rangeEnd: roundedNow < rangeEnd ? roundedNow : rangeEnd,
      rangeKind: range === 'today' ? 'today' : (range === 'last30days' ? 'month' : range),
      cacheTtlMs: SELLERS_ACTIVITY_CACHE_TTL_MS,
    });

    const extensionMappingStartedMs = Date.now();
    const extensionsByManagerPromise = getManagerExtensionsMap(ctx.tenantId, managerIdList);
    const userMappingsPromise = (async () => {
      try {
        return await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            amocrmResponsibleUserId: { in: managerIdList },
          },
          select: {
            id: true,
            amocrmResponsibleUserId: true,
          },
        });
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) {
          throw error;
        }
        return [];
      }
    })();

    const [activeLeads, newLeadsInRange, activityByManager, extensionsByManager, userMappings] = await Promise.all([
      activeLeadsPromise,
      newLeadsInRangePromise,
      activityPromise,
      extensionsByManagerPromise,
      userMappingsPromise,
    ]);
    timings.amocrmLeadsMs = Date.now() - leadsFetchStartedMs;
    timings.activityFetchMs = Date.now() - activityFetchStartedMs;
    timings.extensionMappingMs = Date.now() - extensionMappingStartedMs;

    // Start lead response time computation in parallel (doesn't block other work)
    const leadResponseTimePromise = computeLeadResponseTimes({
      accessToken: amoContext.accessToken,
      baseUrl: amoContext.baseUrl,
      managerIds: managerIdList,
      newLeads: newLeadsInRange,
      rangeStart,
      rangeEnd,
    });

    const leadsGroupingStartedMs = Date.now();
    const activeLeadsByManager = new Map<string, AmoCRMLead[]>();
    for (const lead of activeLeads) {
      const responsibleUserId = getLeadResponsibleId(lead);
      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = activeLeadsByManager.get(responsibleUserId) || [];
      current.push(lead);
      activeLeadsByManager.set(responsibleUserId, current);
    }
    const newLeadsByManager = new Map<string, AmoCRMLead[]>();
    for (const lead of newLeadsInRange) {
      const responsibleUserId = getLeadResponsibleId(lead);
      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = newLeadsByManager.get(responsibleUserId) || [];
      current.push(lead);
      newLeadsByManager.set(responsibleUserId, current);
    }
    timings.leadsGroupingMs = Date.now() - leadsGroupingStartedMs;

    const managerByExtension = new Map<string, string>();
    for (const [managerId, extensions] of extensionsByManager.entries()) {
      for (const extension of extensions) {
        managerByExtension.set(extension, managerId);
      }
    }

    const managerUserIdsByAmoId = new Map<string, string[]>();
    for (const mapping of userMappings as Array<{ id: string; amocrmResponsibleUserId: string | null }>) {
      const managerId = asString(mapping.amocrmResponsibleUserId);
      if (!managerId) {
        continue;
      }
      const current = managerUserIdsByAmoId.get(managerId) || [];
      current.push(mapping.id);
      managerUserIdsByAmoId.set(managerId, current);
    }

    const callsFetchStartedMs = Date.now();
    const extensionValues = Array.from(new Set(Array.from(extensionsByManager.values()).flat()));
    const calls = extensionValues.length > 0
      ? await prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: 'utel',
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            OR: [
              { from: { in: extensionValues } },
              { to: { in: extensionValues } },
            ],
          },
          select: {
            from: true,
            to: true,
            duration: true,
            direction: true,
            status: true,
            startedAt: true,
          },
        })
      : [];
    timings.callsFetchMs = Date.now() - callsFetchStartedMs;

    const incomeFetchStartedMs = Date.now();
    const allManagerUserIds = Array.from(new Set(Array.from(managerUserIdsByAmoId.values()).flat()));
    const [incomes, refundRequests, incomesWithCustomer, incomesWithDeadline] = await Promise.all([
      allManagerUserIds.length > 0
        ? prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: 'active',
              managerUserId: { in: allManagerUserIds },
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
            },
            select: {
              managerUserId: true,
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
          })
        : [],
      // Refund requests by manager in period
      allManagerUserIds.length > 0
        ? prisma.incomeAdjustmentRequest.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'refund',
              status: 'approved',
              createdAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              income: {
                managerUserId: { in: allManagerUserIds },
              },
            },
            select: {
              income: {
                select: { managerUserId: true },
              },
            },
          })
        : [],
      // Incomes with customerId for new vs repeat
      allManagerUserIds.length > 0
        ? prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: 'active',
              type: 'new_sale',
              managerUserId: { in: allManagerUserIds },
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
            },
            select: {
              managerUserId: true,
              customerId: true,
            },
          })
        : [],
      // Incomes with deadline for payment adherence
      allManagerUserIds.length > 0
        ? prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: 'active',
              managerUserId: { in: allManagerUserIds },
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              deadline: { not: null },
            },
            select: {
              managerUserId: true,
              entryDate: true,
              deadline: true,
              paymentAmount: true,
              remainingDebtAmount: true,
            },
          })
        : [],
    ]);
    timings.incomeFetchMs = Date.now() - incomeFetchStartedMs;

    const callsGroupingStartedMs = Date.now();
    const callsByManager = new Map<string, Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>>();
    for (const call of calls) {
      const extension = resolveCallExtension({
        from: call.from,
        to: call.to,
      });
      if (!extension) {
        continue;
      }

      const managerId = managerByExtension.get(extension);
      if (!managerId) {
        continue;
      }

      const current = callsByManager.get(managerId) || [];
      current.push({
        duration: call.duration,
        direction: call.direction,
        status: call.status,
        startedAt: call.startedAt,
      });
      callsByManager.set(managerId, current);
    }
    timings.callsGroupingMs = Date.now() - callsGroupingStartedMs;

    const incomeGroupingStartedMs = Date.now();
    const incomesByManager = new Map<string, SellerIncomeMetricSource[]>();
    const managerIdByUserId = new Map<string, string>();
    for (const [managerId, userIds] of managerUserIdsByAmoId.entries()) {
      for (const userId of userIds) {
        managerIdByUserId.set(userId, managerId);
      }
    }
    const corporateDurationByUserId = await getCorporateCallDurationByManager({
      tenantId: ctx.tenantId,
      managerUserIds: Array.from(managerIdByUserId.keys()),
      rangeStart,
      rangeEnd,
    });
    const corporateDurationByManager = new Map<string, number>();
    for (const [userId, durationSeconds] of corporateDurationByUserId.entries()) {
      const managerId = managerIdByUserId.get(userId);
      if (!managerId) {
        continue;
      }
      corporateDurationByManager.set(
        managerId,
        (corporateDurationByManager.get(managerId) || 0) + durationSeconds,
      );
    }

    for (const income of incomes) {
      const managerId = managerIdByUserId.get(income.managerUserId || '');
      if (!managerId) {
        continue;
      }
      const current = incomesByManager.get(managerId) || [];
      current.push({
        type: income.type,
        paymentAmount: income.paymentAmount,
        coursePriceAmount: income.coursePriceAmount,
        course: income.course,
      });
      incomesByManager.set(managerId, current);
    }
    // Group refund requests by manager
    const refundsByManager = new Map<string, number>();
    for (const req of refundRequests) {
      const managerId = managerIdByUserId.get(req.income.managerUserId || '');
      if (!managerId) continue;
      refundsByManager.set(managerId, (refundsByManager.get(managerId) || 0) + 1);
    }

    // New vs Repeat customers: find which customerIds had purchases before rangeStart
    const allCustomerIds = [...new Set(incomesWithCustomer.map((i) => i.customerId))];
    const repeatCustomerIds = new Set<string>();
    if (allCustomerIds.length > 0) {
      const priorIncomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          lifecycleStatus: 'active',
          customerId: { in: allCustomerIds },
          entryDate: { lt: rangeStart },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });
      for (const pi of priorIncomes) {
        repeatCustomerIds.add(pi.customerId);
      }
    }
    // Group new vs repeat by manager
    const newCustomersByManager = new Map<string, number>();
    const repeatCustomersByManager = new Map<string, number>();
    const seenCustomerByManager = new Map<string, Set<string>>();
    for (const inc of incomesWithCustomer) {
      const managerId = managerIdByUserId.get(inc.managerUserId || '');
      if (!managerId) continue;
      const seen = seenCustomerByManager.get(managerId) || new Set();
      if (seen.has(inc.customerId)) continue;
      seen.add(inc.customerId);
      seenCustomerByManager.set(managerId, seen);
      if (repeatCustomerIds.has(inc.customerId)) {
        repeatCustomersByManager.set(managerId, (repeatCustomersByManager.get(managerId) || 0) + 1);
      } else {
        newCustomersByManager.set(managerId, (newCustomersByManager.get(managerId) || 0) + 1);
      }
    }

    // Payment deadline adherence by manager
    const deadlineMetByManager = new Map<string, number>();
    const deadlineTotalByManager = new Map<string, number>();
    for (const inc of incomesWithDeadline) {
      const managerId = managerIdByUserId.get(inc.managerUserId || '');
      if (!managerId || !inc.deadline) continue;
      deadlineTotalByManager.set(managerId, (deadlineTotalByManager.get(managerId) || 0) + 1);
      if (inc.remainingDebtAmount <= 0 || inc.entryDate <= inc.deadline) {
        deadlineMetByManager.set(managerId, (deadlineMetByManager.get(managerId) || 0) + 1);
      }
    }
    timings.incomeGroupingMs = Date.now() - incomeGroupingStartedMs;

    const leadResponseTimeByManager = await leadResponseTimePromise;

    const buildResponseStartedMs = Date.now();
    const result = managers
      .map((manager) => {
        const managerId = asString(manager.id) || '';
        const managerActiveLeads = activeLeadsByManager.get(managerId) || [];
        const managerCalls = callsByManager.get(managerId) || [];
        const managerActivity = activityByManager.get(managerId) || null;
        const managerIncomes = incomesByManager.get(managerId) || [];
        const salesMetrics = summarizeSellerIncomeMetrics(managerIncomes, rangeStart, rangeEnd);

        const managerNewLeads = newLeadsByManager.get(managerId) || [];
        const newLeadCount = managerNewLeads.length;
        const listConversionRate = newLeadCount > 0
          ? Number(((salesMetrics.newSalesCount / newLeadCount) * 100).toFixed(2))
          : 0;

        return {
          id: managerId,
          name: manager.name || manager.login || `Manager ${managerId}`,
          email: manager.email || null,
          phone: null,
          roles: toManagerRole(manager),
          lastLoginAt: null,
          createdAt: new Date(0),
          metrics: {
            ...buildMetrics(managerActiveLeads, [], [], managerCalls, {
            neutralizeLeadOutcomes: true,
            activityMetrics: managerActivity,
            incomeAmountOverride: salesMetrics.incomeAmount,
            manualDurationSeconds: corporateDurationByManager.get(managerId) || 0,
            }),
            salesCount: salesMetrics.newSalesCount,
            totalDealAmount: salesMetrics.newSalesAgreementAmount,
            averageDealAmount: salesMetrics.averageAgreementAmount,
            ...salesMetrics,
            conversionRate: listConversionRate,
            refundCount: refundsByManager.get(managerId) || 0,
            refundRate: salesMetrics.newSalesCount > 0
              ? Number((((refundsByManager.get(managerId) || 0) / salesMetrics.newSalesCount) * 100).toFixed(2))
              : 0,
            newCustomers: newCustomersByManager.get(managerId) || 0,
            repeatCustomers: repeatCustomersByManager.get(managerId) || 0,
            newCustomerRate: ((newCustomersByManager.get(managerId) || 0) + (repeatCustomersByManager.get(managerId) || 0)) > 0
              ? Number((((newCustomersByManager.get(managerId) || 0) / ((newCustomersByManager.get(managerId) || 0) + (repeatCustomersByManager.get(managerId) || 0))) * 100).toFixed(2))
              : 0,
            deadlineTotal: deadlineTotalByManager.get(managerId) || 0,
            deadlineMet: deadlineMetByManager.get(managerId) || 0,
            deadlineAdherenceRate: (deadlineTotalByManager.get(managerId) || 0) > 0
              ? Number((((deadlineMetByManager.get(managerId) || 0) / (deadlineTotalByManager.get(managerId) || 0)) * 100).toFixed(2))
              : 0,
            leadResponseTime: leadResponseTimeByManager.get(managerId) || { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
          },
        };
      })
      .sort((a, b) => (
        (b.metrics.salesCount - a.metrics.salesCount)
        || (b.metrics.incomeAmount - a.metrics.incomeAmount)
        || (b.metrics.totalCallDuration - a.metrics.totalCallDuration)
        || a.name.localeCompare(b.name)
      ));
    timings.buildResponseMs = Date.now() - buildResponseStartedMs;
    timings.totalMs = Date.now() - startedAtMs;

    log(LogLevel.INFO, 'Sellers list timings', {
      tenantId: ctx.tenantId,
      userId: ctx.user.userId,
      managerCount: managers.length,
      selectedPipelineIds,
      activeLeadsCount: activeLeads.length,
      callsCount: calls.length,
      activityTotals: summarizeAmoCRMActivityMetrics(activityByManager),
      cacheHit: false,
      timings,
    });

    sellersListCache.set(listCacheKey, {
      expiresAt: Date.now() + SELLERS_LIST_CACHE_TTL_MS,
      data: result,
    });

    return result;
  }),

  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        range: sellerRangeSchema.default('today'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const [amocrmUsers, pipelinesResponse] = await Promise.all([
        amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl),
        amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl),
      ]);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

      const activeStatusFilters = buildStatusFilters(
        selectedPipelineIds,
        pipelines,
        pipelines
          .flatMap((pipeline) => (Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : []))
          .map((status) => asString(status.id))
          .filter((statusId): statusId is string => Boolean(statusId) && statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID),
      );
      const wonStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [WON_STATUS_ID]);
      const lostStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [LOST_STATUS_ID]);

      const [activeLeads, wonLeads, lostLeads] = await Promise.all([
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          activeStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
          true,
        ),
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          wonStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          lostStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
      ]);

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);
      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const extensionsByManager = await getManagerExtensionsMap(ctx.tenantId, [input.id]);
      const extensions = extensionsByManager.get(input.id) || [];

      const callsForMetrics = extensions.length > 0
        ? await prisma.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: 'utel',
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
          })
      : [];

      const recentCalls = extensions.length > 0
        ? await prisma.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: 'utel',
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              id: true,
              from: true,
              to: true,
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
            orderBy: {
              startedAt: 'desc',
            },
            take: 50,
          })
        : [];

      let mappedManagerUserIds: string[] = [];
      try {
        mappedManagerUserIds = (
          await prisma.user.findMany({
            where: {
              tenantId: ctx.tenantId,
              isActive: true,
              amocrmResponsibleUserId: input.id,
            },
            select: { id: true },
          })
        ).map((user) => user.id);
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) {
          throw error;
        }
      }

      const [sellerIncomes, detailRefundRequests, detailIncomesWithCustomer, detailIncomesWithDeadline] = await Promise.all([
        mappedManagerUserIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
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
            })
          : [],
        mappedManagerUserIds.length > 0
          ? prisma.incomeAdjustmentRequest.findMany({
              where: {
                tenantId: ctx.tenantId,
                type: 'refund',
                status: 'approved',
                createdAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                income: {
                  managerUserId: { in: mappedManagerUserIds },
                },
              },
              select: { id: true },
            })
          : [],
        mappedManagerUserIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                type: 'new_sale',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: { customerId: true },
            })
          : [],
        mappedManagerUserIds.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                deadline: { not: null },
              },
              select: {
                entryDate: true,
                deadline: true,
                paymentAmount: true,
                remainingDebtAmount: true,
              },
            })
          : [],
      ]);
      const [corporateDurationByUserId, newLeadsForManager, activityMetricsMap] = await Promise.all([
        getCorporateCallDurationByManager({
          tenantId: ctx.tenantId,
          managerUserIds: mappedManagerUserIds,
          rangeStart,
          rangeEnd,
        }),
        amocrmService.fetchAllLeads(
          amoContext.accessToken,
          {
            pipelineIds: selectedPipelineIds,
            responsibleUserIds: [input.id],
            createdAtFrom: rangeStart,
            createdAtTo: rangeEnd,
            limit: 250,
            maxPages: 20,
          },
          amoContext.baseUrl,
        ),
        getAmoCRMActivityMetrics({
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: [input.id],
          rangeStart,
          rangeEnd,
          rangeKind: input.range === 'last30days' ? 'custom' : input.range,
        }),
      ]);
      // Start lead response time (runs while we build metrics below)
      const detailLeadResponsePromise = computeLeadResponseTimes({
        accessToken: amoContext.accessToken,
        baseUrl: amoContext.baseUrl,
        managerIds: [input.id],
        newLeads: newLeadsForManager,
        rangeStart,
        rangeEnd,
      });
      const manualDurationSeconds = Array.from(corporateDurationByUserId.values())
        .reduce((sum, value) => sum + value, 0);
      const salesMetrics = summarizeSellerIncomeMetrics(sellerIncomes, rangeStart, rangeEnd);
      const activityMetrics = activityMetricsMap.get(input.id) || null;

      const metrics = buildMetrics(
        activeLeads,
        wonLeads,
        lostLeads,
        (callsForMetrics as Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>).map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          startedAt: call.startedAt,
        })),
        {
          incomeAmountOverride: salesMetrics.incomeAmount,
          activityMetrics,
          manualDurationSeconds,
        },
      );

      const recentLeads = activeLeads
        .slice()
        .sort((a, b) => parseAmoDate(b.created_at).getTime() - parseAmoDate(a.created_at).getTime())
        .slice(0, 50)
        .map((lead) => {
          const firstContact = Array.isArray(lead._embedded?.contacts) ? lead._embedded?.contacts[0] : null;
          const contact = firstContact && typeof firstContact === 'object'
            ? {
                name: asString((firstContact as Record<string, unknown>).name),
                phone: null,
                email: null,
              }
            : null;

          return {
            id: asString(lead.id) || '',
            title: lead.name || 'Untitled lead',
            status: asString(lead.status_id),
            metadata: lead,
            createdAt: parseAmoDate(lead.created_at),
            updatedAt: parseAmoDate(lead.updated_at),
            contact,
          };
        });

      const detailNewLeadCount = newLeadsForManager.length;
      const detailConversionRate = detailNewLeadCount > 0
        ? Number(((salesMetrics.newSalesCount / detailNewLeadCount) * 100).toFixed(2))
        : 0;

      // Refund rate
      const detailRefundCount = detailRefundRequests.length;
      const detailRefundRate = salesMetrics.newSalesCount > 0
        ? Number(((detailRefundCount / salesMetrics.newSalesCount) * 100).toFixed(2))
        : 0;

      // New vs repeat customers
      const detailCustomerIds = [...new Set(detailIncomesWithCustomer.map((i) => i.customerId))];
      let detailNewCustomers = 0;
      let detailRepeatCustomers = 0;
      if (detailCustomerIds.length > 0) {
        const detailPriorCustomers = await prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: 'active',
            customerId: { in: detailCustomerIds },
            entryDate: { lt: rangeStart },
          },
          select: { customerId: true },
          distinct: ['customerId'],
        });
        const detailRepeatSet = new Set(detailPriorCustomers.map((p) => p.customerId));
        for (const cid of detailCustomerIds) {
          if (detailRepeatSet.has(cid)) {
            detailRepeatCustomers++;
          } else {
            detailNewCustomers++;
          }
        }
      }
      const detailTotalCustomers = detailNewCustomers + detailRepeatCustomers;
      const detailNewCustomerRate = detailTotalCustomers > 0
        ? Number(((detailNewCustomers / detailTotalCustomers) * 100).toFixed(2))
        : 0;

      // Payment deadline adherence
      let detailDeadlineTotal = 0;
      let detailDeadlineMet = 0;
      for (const inc of detailIncomesWithDeadline) {
        if (!inc.deadline) continue;
        detailDeadlineTotal++;
        if (inc.remainingDebtAmount <= 0 || inc.entryDate <= inc.deadline) {
          detailDeadlineMet++;
        }
      }
      const detailDeadlineAdherenceRate = detailDeadlineTotal > 0
        ? Number(((detailDeadlineMet / detailDeadlineTotal) * 100).toFixed(2))
        : 0;

      const detailLeadResponseMap = await detailLeadResponsePromise;
      const detailLeadResponseTime = detailLeadResponseMap.get(input.id) || { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 };

      return {
        seller: {
          id: input.id,
          name: sellerUser.name || sellerUser.login || `Manager ${input.id}`,
          email: sellerUser.email || null,
          phone: null,
          roles: toManagerRole(sellerUser),
          lastLoginAt: null,
          createdAt: new Date(0),
        },
        metrics: {
          ...metrics,
          salesCount: salesMetrics.newSalesCount,
          totalDealAmount: salesMetrics.newSalesAgreementAmount,
          averageDealAmount: salesMetrics.averageAgreementAmount,
          ...salesMetrics,
          conversionRate: detailConversionRate,
          refundCount: detailRefundCount,
          refundRate: detailRefundRate,
          newCustomers: detailNewCustomers,
          repeatCustomers: detailRepeatCustomers,
          newCustomerRate: detailNewCustomerRate,
          deadlineTotal: detailDeadlineTotal,
          deadlineMet: detailDeadlineMet,
          deadlineAdherenceRate: detailDeadlineAdherenceRate,
          leadResponseTime: detailLeadResponseTime,
        },
        recentLeads,
        recentCalls,
        period: {
          range: input.range,
          dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
          dateTo: input.range === 'custom' ? input.dateTo || null : null,
          rangeStart,
          rangeEnd,
        },
      };
    }),

  sendPdfToAdmins: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        range: sellerRangeSchema.default('last30days'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const botToken = await resolveTelegramBotTokenForTenant(ctx.tenantId);
      if (!botToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram bot token topilmadi.' });
      }

      const [amoContext, adminUsers] = await Promise.all([
        getTenantAmoCRMContext(ctx.tenantId),
        prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: { has: 'Admin' },
            telegramId: { not: null },
          },
          select: {
            telegramId: true,
            name: true,
          },
        }),
      ]);

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const adminChatIds = adminUsers
        .map((user) => String(user.telegramId || '').trim())
        .filter(Boolean);
      if (!adminChatIds.length) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram chat id bilan admin topilmadi.' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

      const [amocrmUsers, pipelinesResponse] = await Promise.all([
        amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl),
        amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl),
      ]);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

      const activeStatusFilters = buildStatusFilters(
        selectedPipelineIds,
        pipelines,
        pipelines
          .flatMap((pipeline) => (Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : []))
          .map((status) => asString(status.id))
          .filter((statusId): statusId is string => Boolean(statusId) && statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID),
      );

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);
      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const [activeLeads, extensionsByManager, mappedUsers] = await Promise.all([
        fetchLeadsByStatusFilters(
          amoContext.accessToken,
          amoContext.baseUrl,
          selectedPipelineIds,
          activeStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
          false,
        ),
        getManagerExtensionsMap(ctx.tenantId, [input.id]),
        prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            amocrmResponsibleUserId: input.id,
          },
          select: { id: true },
        }).catch((error) => {
          if (!isMissingUserMappingColumnError(error)) {
            throw error;
          }
          return [];
        }),
      ]);

      const extensions = extensionsByManager.get(input.id) || [];
      const [callsForMetrics, sellerIncomes, activityMetricsMap] = await Promise.all([
        extensions.length > 0
          ? prisma.call.findMany({
              where: {
                tenantId: ctx.tenantId,
                provider: 'utel',
                startedAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                OR: [{ from: { in: extensions } }, { to: { in: extensions } }],
              },
              select: {
                duration: true,
                status: true,
                direction: true,
                startedAt: true,
              },
            })
          : Promise.resolve([]),
        mappedUsers.length > 0
          ? prisma.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedUsers.map((row) => row.id) },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
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
            })
          : Promise.resolve([]),
        getAmoCRMActivityMetrics({
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: [input.id],
          rangeStart,
          rangeEnd,
          rangeKind: input.range === 'last30days' ? 'custom' : input.range,
        }),
      ]);
      const corporateDurationByUserId = await getCorporateCallDurationByManager({
        tenantId: ctx.tenantId,
        managerUserIds: mappedUsers.map((row) => row.id),
        rangeStart,
        rangeEnd,
      });
      const manualDurationSeconds = Array.from(corporateDurationByUserId.values())
        .reduce((sum, value) => sum + value, 0);

      const salesMetrics = summarizeSellerIncomeMetrics(sellerIncomes, rangeStart, rangeEnd);
      const activityMetrics = activityMetricsMap.get(input.id) || null;
      const baseMetrics = buildMetrics(
        activeLeads,
        [],
        [],
        (callsForMetrics as Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>).map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          startedAt: call.startedAt,
        })),
        {
          neutralizeLeadOutcomes: true,
          incomeAmountOverride: salesMetrics.incomeAmount,
          activityMetrics,
          manualDurationSeconds,
        },
      );

      const payload: SellerReportPayload = {
        seller: {
          id: input.id,
          name: sellerUser.name || sellerUser.login || `Manager ${input.id}`,
          email: sellerUser.email || null,
          phone: null,
          roles: toManagerRole(sellerUser),
          lastLoginAt: null,
          createdAt: new Date(0),
        },
        metrics: {
          ...baseMetrics,
          salesCount: salesMetrics.newSalesCount,
          totalDealAmount: salesMetrics.newSalesAgreementAmount,
          averageDealAmount: salesMetrics.averageAgreementAmount,
          ...salesMetrics,
        },
        rangeStart,
        rangeEnd,
      };

      const pdfBuffer = buildSellerReportPdf(payload);
      const safeName = payload.seller.name.replace(/[^a-zA-Z0-9-_]+/g, '-');
      const fileName = `seller-report-${safeName || input.id}.pdf`;
      const caption = `${payload.seller.name} hisobot PDF`;

      for (const chatId of adminChatIds) {
        await telegramService.sendDocument(botToken, chatId, pdfBuffer, fileName, caption);
      }

      return {
        success: true,
        recipientCount: adminChatIds.length,
      };
    }),
});
