import { prisma } from '@dashboarduz/db';
import { type AmoCRMTask, amocrmService } from '../integrations/amocrm';
import { getTenantAmoCRMContext } from '../integrations/amocrm-live';
import { telegramService } from '../integrations/telegram';
import { getRedisClient } from '../queue/redis-client';
import { decryptIntegrationTokens } from '../security/encryption';
import { LogLevel, log } from '../observability';

const REPORT_TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000; // GMT+5 (Asia/Tashkent)
const REPORT_TIMEZONE_LABEL = 'GMT+5';
const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days
const UTEL_MIN_EXTENSION = 100;
const UTEL_MAX_EXTENSION = 150;

const AGENT_MOTIVATION_ABOVE = "Harakatlaringiz juda yaxshi, qo'ng'iroqlarni kamaytirmang va albatta natija siz kutganingizdek bo'ladi!";
const AGENT_MOTIVATION_BELOW = "Bugun boshqalardan ortda qolyapsiz, ko'proq qo'ng'iroqlar qiling, natija harakatlarga bog'liq!";

type NoonWindow = {
  periodStart: Date;
  periodEnd: Date;
  periodKey: string;
};

type TelegramIntegrationWithTenant = {
  id: string;
  tenantId: string;
  tokensEncrypted: string | null;
};

type AgentCandidate = {
  id: string;
  name: string;
  telegramId: string | null;
  utelExtension: string | null;
  amocrmResponsibleUserId: string | null;
};

type AgentMetricRow = {
  userId: string;
  name: string;
  telegramId: string | null;
  incomeToday: number;
  callsCount: number;
  callDurationSeconds: number;
  followUpsDone: number;
  rankByDuration: number;
  aboveAverageDuration: boolean;
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

function formatCurrency(value: number): string {
  return `${Math.max(0, Math.round(value)).toLocaleString('ru-RU')} so'm`;
}

function formatDurationUz(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours} soat ${minutes} daqiqa ${seconds} soniya`;
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= UTEL_MIN_EXTENSION && parsed <= UTEL_MAX_EXTENSION;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getCaseInsensitiveValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }
  const normalizedKey = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (entryKey.toLowerCase() === normalizedKey) {
      return entryValue;
    }
  }
  return undefined;
}

function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return null;
}

function resolveCallDuration(duration: number | null, metadata: unknown): number {
  if (duration !== null && duration !== undefined) {
    return Math.max(0, duration);
  }

  const metadataObject = asObject(metadata);
  if (!metadataObject) {
    return 0;
  }

  const candidates: Record<string, unknown>[] = [metadataObject];
  const rawHistory = asObject(metadataObject.raw_call_history);
  if (rawHistory) {
    candidates.push(rawHistory);
  }

  const keys = ['normalized_duration', 'duration', 'billsec', 'conversation', 'talk_duration'];
  for (const candidate of candidates) {
    for (const key of keys) {
      const parsed = parseDuration(getCaseInsensitiveValue(candidate, key));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return 0;
}

function resolveCallExtension(call: {
  from: string;
  to: string;
  direction: string;
  metadata: unknown;
}): string | null {
  const metadata = asObject(call.metadata);
  const metadataExtension = normalizeDigits(
    metadata?.normalized_extension
    || metadata?.extension
    || metadata?.ext
    || metadata?.internal
    || metadata?.line,
  );
  if (isAllowedUtelManagerExtension(metadataExtension)) {
    return metadataExtension;
  }

  const fromDigits = normalizeDigits(call.from);
  const toDigits = normalizeDigits(call.to);
  const direction = String(call.direction || '').toLowerCase();

  if (direction === 'outbound') {
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  }

  if (direction === 'inbound') {
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  }

  if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  return null;
}

function normalizeTelegramSecret(value: string | undefined | null): string | null {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
}

function buildTelegramChatIdCandidates(chatId: string): string[] {
  const normalized = String(chatId || '').trim();
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>();
  candidates.add(normalized);

  const digitsOnly = normalized.replace(/[^\d-]/g, '');
  if (digitsOnly && digitsOnly !== normalized) {
    candidates.add(digitsOnly);
  }

  const unsignedDigits = digitsOnly.replace(/-/g, '');
  if (unsignedDigits) {
    if (!normalized.startsWith('-100')) {
      candidates.add(`-100${unsignedDigits}`);
    }
    if (!normalized.startsWith('-') && !normalized.startsWith('@')) {
      candidates.add(unsignedDigits);
    }
  }

  return Array.from(candidates);
}

function resolveNoonWindow(nowUtc: Date): NoonWindow | null {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();

  const dispatchAt = fromLocalParts(year, month, day, 12, 0, 0, 0);
  if (nowUtc < dispatchAt) {
    return null;
  }

  return {
    periodStart: fromLocalParts(year, month, day, 0, 0, 0, 0),
    periodEnd: nowUtc,
    periodKey: formatLocalDate(nowUtc),
  };
}

function taskResponsibleUserId(task: AmoCRMTask): string {
  const source = task as Record<string, unknown>;
  const direct = String(task.responsible_user_id || '').trim();
  if (direct) {
    return direct;
  }

  const nestedResponsible = source.responsible_user as Record<string, unknown> | undefined;
  const nestedEmbedded = (source._embedded as Record<string, unknown> | undefined)?.responsible_user as Record<string, unknown> | undefined;
  return (
    String(nestedResponsible?.id || '').trim()
    || String(nestedResponsible?.user_id || '').trim()
    || String(nestedEmbedded?.id || '').trim()
    || String(nestedEmbedded?.user_id || '').trim()
  );
}

function isCompletedTask(task: AmoCRMTask): boolean {
  const value = task.is_completed ?? (task as Record<string, unknown>).completed ?? (task as Record<string, unknown>).isCompleted;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'done';
}

function isLeadTask(task: AmoCRMTask): boolean {
  const entityType = String(task.entity_type || '').trim().toLowerCase();
  if (!entityType) {
    return true;
  }
  return entityType === 'lead' || entityType === 'leads';
}

function buildAgentMessage(row: AgentMetricRow): string {
  const motivation = row.aboveAverageDuration ? AGENT_MOTIVATION_ABOVE : AGENT_MOTIVATION_BELOW;
  return [
    `Bugungi tushum - ${formatCurrency(row.incomeToday)}`,
    `Qo'ng'iroqlar soni - ${row.callsCount}`,
    `Qo'ng'iroqlar davomiyligi - ${formatDurationUz(row.callDurationSeconds)}`,
    `Bajarilgan topshiriqlar - ${row.followUpsDone}`,
    '',
    `Bugun qo'ng'iroqlar bo'yicha ${row.rankByDuration}-o'rindasiz`,
    '',
    motivation,
  ].join('\n');
}

async function collectAgentMetricsForTenant(params: {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<AgentMetricRow[]> {
  const agents = await prisma.user.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      roles: { has: 'Agent' },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      username: true,
      telegramId: true,
      utelManagerExternalId: true,
      amocrmResponsibleUserId: true,
    },
  });

  const normalizedAgents: AgentCandidate[] = agents
    .map((agent) => ({
      id: agent.id,
      name: String(agent.name || agent.username || 'Agent').trim() || 'Agent',
      telegramId: String(agent.telegramId || '').trim() || null,
      utelExtension: isAllowedUtelManagerExtension(agent.utelManagerExternalId)
        ? normalizeDigits(agent.utelManagerExternalId)
        : null,
      amocrmResponsibleUserId: String(agent.amocrmResponsibleUserId || '').trim() || null,
    }));

  if (normalizedAgents.length === 0) {
    return [];
  }

  const agentIds = normalizedAgents.map((agent) => agent.id);
  const extensionToAgentId = new Map<string, string>();
  for (const agent of normalizedAgents) {
    if (agent.utelExtension) {
      extensionToAgentId.set(agent.utelExtension, agent.id);
    }
  }
  const extensionValues = Array.from(extensionToAgentId.keys());

  const [incomeGrouped, calls] = await Promise.all([
    prisma.income.groupBy({
      by: ['managerUserId'],
      where: {
        tenantId: params.tenantId,
        managerUserId: { in: agentIds },
        lifecycleStatus: 'active',
        entryDate: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      _sum: {
        paymentAmount: true,
      },
    }),
    extensionValues.length > 0
      ? prisma.call.findMany({
          where: {
            tenantId: params.tenantId,
            provider: 'utel',
            startedAt: {
              gte: params.periodStart,
              lte: params.periodEnd,
            },
            OR: [
              { from: { in: extensionValues } },
              { to: { in: extensionValues } },
            ],
          },
          select: {
            from: true,
            to: true,
            direction: true,
            duration: true,
            metadata: true,
          },
        })
      : Promise.resolve([] as Array<{ from: string; to: string; direction: string; duration: number | null; metadata: unknown }>),
  ]);

  const incomeByAgentId = new Map<string, number>();
  for (const row of incomeGrouped) {
    incomeByAgentId.set(row.managerUserId, Number(row._sum.paymentAmount || 0));
  }

  const callsCountByAgentId = new Map<string, number>();
  const callDurationByAgentId = new Map<string, number>();
  for (const call of calls) {
    const extension = resolveCallExtension({
      from: call.from,
      to: call.to,
      direction: call.direction,
      metadata: call.metadata,
    });
    if (!extension) {
      continue;
    }
    const agentId = extensionToAgentId.get(extension);
    if (!agentId) {
      continue;
    }
    callsCountByAgentId.set(agentId, (callsCountByAgentId.get(agentId) || 0) + 1);
    callDurationByAgentId.set(agentId, (callDurationByAgentId.get(agentId) || 0) + resolveCallDuration(call.duration, call.metadata));
  }

  const followUpsByAgentId = new Map<string, number>();
  const amocrmContext = await getTenantAmoCRMContext(params.tenantId);
  const managerIds = normalizedAgents
    .map((agent) => ({ agentId: agent.id, amoId: agent.amocrmResponsibleUserId }))
    .filter((entry): entry is { agentId: string; amoId: string } => Boolean(entry.amoId));

  if (amocrmContext && managerIds.length > 0) {
    try {
      const responsibleIds = Array.from(new Set(managerIds.map((entry) => entry.amoId)));
      const tasks = await amocrmService.fetchAllTasks(
        amocrmContext.accessToken,
        {
          responsibleUserIds: responsibleIds,
          completedOnly: true,
          dateFrom: params.periodStart,
          dateTo: params.periodEnd,
          entityType: 'leads',
          limit: 250,
          maxPages: 50,
        },
        amocrmContext.baseUrl,
      );

      const completedByResponsible = new Map<string, number>();
      for (const task of tasks) {
        if (!isLeadTask(task) || !isCompletedTask(task)) {
          continue;
        }
        const responsibleUserId = taskResponsibleUserId(task);
        if (!responsibleUserId) {
          continue;
        }
        completedByResponsible.set(responsibleUserId, (completedByResponsible.get(responsibleUserId) || 0) + 1);
      }

      for (const entry of managerIds) {
        followUpsByAgentId.set(entry.agentId, completedByResponsible.get(entry.amoId) || 0);
      }
    } catch (error: any) {
      log(LogLevel.WARN, 'Noon agent performance: failed to fetch completed follow-ups from AmoCRM', {
        tenantId: params.tenantId,
        error: String(error?.message || error),
      });
    }
  }

  const rowsBase = normalizedAgents.map((agent) => ({
    userId: agent.id,
    name: agent.name,
    telegramId: agent.telegramId,
    incomeToday: incomeByAgentId.get(agent.id) || 0,
    callsCount: callsCountByAgentId.get(agent.id) || 0,
    callDurationSeconds: callDurationByAgentId.get(agent.id) || 0,
    followUpsDone: followUpsByAgentId.get(agent.id) || 0,
  }));

  const ranked = rowsBase
    .slice()
    .sort((a, b) => (
      b.callDurationSeconds - a.callDurationSeconds
      || b.callsCount - a.callsCount
      || a.name.localeCompare(b.name)
    ))
    .map((row, index) => ({
      ...row,
      rankByDuration: index + 1,
    }));

  const averageDuration = ranked.length > 0
    ? ranked.reduce((sum, row) => sum + row.callDurationSeconds, 0) / ranked.length
    : 0;

  return ranked.map((row) => ({
    ...row,
    aboveAverageDuration: row.callDurationSeconds >= averageDuration,
  }));
}

async function sendMessageToTelegramChat(botToken: string, chatId: string, text: string): Promise<void> {
  const candidates = buildTelegramChatIdCandidates(chatId);
  if (candidates.length === 0) {
    throw new Error('Telegram chat id is empty');
  }

  let lastError = '';
  for (const candidate of candidates) {
    try {
      await telegramService.sendMessage(botToken, candidate, text, {
        disable_web_page_preview: true,
      });
      return;
    } catch (error) {
      lastError = String((error as any)?.message || error);
    }
  }

  throw new Error(lastError || 'Failed to send Telegram message');
}

async function dispatchNoonWindow(window: NoonWindow, nowUtc: Date): Promise<void> {
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
    },
  });

  if (integrations.length === 0) {
    return;
  }

  const redis = getRedisClient();

  for (const integration of integrations as TelegramIntegrationWithTenant[]) {
    const lockKey = `telegram-agent-performance:${integration.tenantId}:${window.periodKey}`;
    const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', LOCK_TTL_SECONDS, 'NX');
    if (lockResult !== 'OK') {
      continue;
    }

    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted || '');
      const botToken = normalizeTelegramSecret(tokens.botToken || tokens.token || process.env.TELEGRAM_BOT_TOKEN || undefined);
      if (!botToken) {
        throw new Error('Telegram bot token is missing');
      }

      const rows = await collectAgentMetricsForTenant({
        tenantId: integration.tenantId,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      });

      if (rows.length === 0) {
        continue;
      }

      let sentCount = 0;
      for (const row of rows) {
        if (!row.telegramId) {
          continue;
        }
        const message = buildAgentMessage(row);
        try {
          await sendMessageToTelegramChat(botToken, row.telegramId, message);
          sentCount += 1;
        } catch (error: any) {
          log(LogLevel.WARN, 'Noon agent performance: failed to send message to agent', {
            tenantId: integration.tenantId,
            userId: row.userId,
            chatId: row.telegramId,
            error: String(error?.message || error),
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_agent_noon_performance_sent',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: 'daily_noon',
            timezone: REPORT_TIMEZONE_LABEL,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            sentCount,
            agentCount: rows.length,
          },
        },
      });

      log(LogLevel.INFO, 'Noon agent performance messages sent', {
        tenantId: integration.tenantId,
        sentCount,
        agentCount: rows.length,
      });
    } catch (error: any) {
      await redis.del(lockKey);
      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_agent_noon_performance_failed',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: 'daily_noon',
            timezone: REPORT_TIMEZONE_LABEL,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            error: String(error?.message || error),
          },
        },
      });

      log(LogLevel.ERROR, 'Noon agent performance scheduler failed for tenant', {
        tenantId: integration.tenantId,
        error: String(error?.message || error),
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
    const window = resolveNoonWindow(nowUtc);
    if (window) {
      await dispatchNoonWindow(window, nowUtc);
    }
  } catch (error: any) {
    log(LogLevel.ERROR, 'Noon agent performance scheduler tick failed', {
      error: String(error?.message || error),
    });
  } finally {
    schedulerInProgress = false;
  }
}

export function startTelegramAgentPerformanceScheduler(): void {
  if (schedulerTimer) {
    return;
  }

  schedulerTimer = setInterval(() => {
    void tickScheduler();
  }, POLL_INTERVAL_MS);

  void tickScheduler();

  log(LogLevel.INFO, 'Telegram agent performance scheduler started', {
    timezone: REPORT_TIMEZONE_LABEL,
    intervalMs: POLL_INTERVAL_MS,
  });
}

export function stopTelegramAgentPerformanceScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
