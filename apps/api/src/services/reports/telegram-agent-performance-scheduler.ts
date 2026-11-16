import { systemPrisma } from '@dashboarduz/db';
import { AGENT_ROLES, fromTashkentLocalParts, normalizeDigits, shiftToTashkent, toTashkentDateKey } from '@dashboarduz/shared';

import { buildLooseTelegramChatIdCandidates, normalizeTelegramSecret, sendMessageToTelegramChat } from '../../lib/telegram';
import { isAllowedUtelManagerExtension, resolveCallDuration, resolveCallExtension } from '../../lib/utel';
import { getCallsProvider } from '../calls-source';
import { getCorporateCallDurationByManager } from '../corporate-call-durations';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../income-facts';
import { type AmoCRMTask, amocrmService } from '../integrations/amocrm';
import { getTenantAmoCRMContext } from '../integrations/amocrm-live';
import { LogLevel, log } from '../observability';
import { getRedisClient } from '../queue/redis-client';
import { decryptIntegrationTokens } from '../security/encryption';

const REPORT_TIMEZONE_LABEL = 'GMT+5';
const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_SECONDS = 60 * 60 * 24 * 2; // 2 days

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

function resolveNoonWindow(nowUtc: Date): NoonWindow | null {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();

  const dispatchAt = fromTashkentLocalParts(year, month, day, 12, 0, 0, 0);

  if (nowUtc < dispatchAt) {
    return null;
  }

  return {
    periodStart: fromTashkentLocalParts(year, month, day, 0, 0, 0, 0),
    periodEnd: nowUtc,
    periodKey: toTashkentDateKey(nowUtc),
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
  const agents = await systemPrisma.user.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      roles: { hasSome: [...AGENT_ROLES] },
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
  const corporateDurationByAgentId = await getCorporateCallDurationByManager({
    tenantId: params.tenantId,
    managerUserIds: agentIds,
    rangeStart: params.periodStart,
    rangeEnd: params.periodEnd,
  });
  const extensionToAgentId = new Map<string, string>();

  for (const agent of normalizedAgents) {
    if (agent.utelExtension) {
      extensionToAgentId.set(agent.utelExtension, agent.id);
    }
  }
  const extensionValues = Array.from(extensionToAgentId.keys());

  const [incomeRowsRaw, calls] = await Promise.all([
    systemPrisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        managerUserId: { in: agentIds },
        lifecycleStatus: 'active',
        entryDate: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        managerUserId: true,
        paymentAmount: true,
      },
    }),
    extensionValues.length > 0
      ? systemPrisma.call.findMany({
          where: {
            tenantId: params.tenantId,
            provider: await getCallsProvider(params.tenantId),
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

  // Technical sales (agreement == 1) and their repayments are not real income.
  const incomeRows = excludeTechnicalRows(incomeRowsRaw, await loadTechnicalSaleIdsForRows(params.tenantId, incomeRowsRaw));
  const incomeByAgentId = new Map<string, number>();

  for (const row of incomeRows) {
    incomeByAgentId.set(row.managerUserId, (incomeByAgentId.get(row.managerUserId) || 0) + Number(row.paymentAmount || 0));
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
  let amocrmContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;

  try {
    amocrmContext = await getTenantAmoCRMContext(params.tenantId);
  } catch (error: any) {
    log(LogLevel.WARN, 'Noon agent performance: failed to load AmoCRM context', {
      tenantId: params.tenantId,
      error: String(error?.message || error),
    });
  }
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
    callDurationSeconds: (callDurationByAgentId.get(agent.id) || 0) + (corporateDurationByAgentId.get(agent.id) || 0),
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

async function dispatchNoonWindow(window: NoonWindow, nowUtc: Date): Promise<void> {
  const integrations = await systemPrisma.integration.findMany({
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
          await sendMessageToTelegramChat(botToken, row.telegramId, message, {
            buildCandidates: buildLooseTelegramChatIdCandidates,
            emptyChatIdMessage: 'Telegram chat id is empty',
          });
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

      await systemPrisma.auditLog.create({
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
      await systemPrisma.auditLog.create({
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
