import { systemPrisma } from '@dashboarduz/db';
import { AGENT_ROLES, formatSomAmount, fromTashkentLocalParts, shiftToTashkent, TASHKENT_TIMEZONE_LABEL, toTashkentDateKey } from '@dashboarduz/shared';

import { isCompletedTask, isLeadTask, taskResponsibleUserId } from '../../lib/amocrm';
import { formatDuration } from '../../lib/duration';
import { thrownText } from '../../lib/errors';
import { createIntervalJob } from '../../lib/interval-job';
import { logger } from '../../lib/logger';
import { buildLooseTelegramChatIdCandidates, resolveTelegramBotToken, sendMessageToTelegramChat } from '../../lib/telegram';
import { countedCallsWhere } from '../calls-source';
import { getCorporateCallDurationByManager } from '../corporate-call-durations';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../income-facts';
import { getAmoTasks } from '../integrations/amocrm-activity-snapshot-read';
import { getTenantAmoCRMContext } from '../integrations/amocrm-live';
import { reportError } from '../observability';
import { getRedisClient } from '../queue/redis-client';

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
  status: string;
  tokensEncrypted: string | null;
};

type AgentCandidate = {
  id: string;
  name: string;
  telegramId: string | null;
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

function buildAgentMessage(row: AgentMetricRow): string {
  const motivation = row.aboveAverageDuration ? AGENT_MOTIVATION_ABOVE : AGENT_MOTIVATION_BELOW;

  return [
    `Bugungi tushum - ${formatSomAmount(row.incomeToday)}`,
    `Qo'ng'iroqlar soni - ${row.callsCount}`,
    `Qo'ng'iroqlar davomiyligi - ${formatDuration(row.callDurationSeconds)}`,
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
      amocrmResponsibleUserId: true,
    },
  });

  const normalizedAgents: AgentCandidate[] = agents
    .map((agent) => ({
      id: agent.id,
      name: String(agent.name || agent.username || 'Agent').trim() || 'Agent',
      telegramId: String(agent.telegramId || '').trim() || null,
      amocrmResponsibleUserId: String(agent.amocrmResponsibleUserId || '').trim() || null,
    }));

  if (normalizedAgents.length === 0) {
    return [];
  }

  const agentIds = normalizedAgents.map((agent) => agent.id);
  const corporateDurationByAgentId = await getCorporateCallDurationByManager({
    db: systemPrisma,
    tenantId: params.tenantId,
    managerUserIds: agentIds,
    rangeStart: params.periodStart,
    rangeEnd: params.periodEnd,
  });

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
    systemPrisma.call.findMany({
      where: {
        ...countedCallsWhere(params.tenantId, agentIds),
        startedAt: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      select: {
        managerUserId: true,
        duration: true,
      },
    }),
  ]);

  // Technical sales (agreement == 1) and their repayments are not real income.
  const incomeRows = excludeTechnicalRows(incomeRowsRaw, await loadTechnicalSaleIdsForRows(params.tenantId, incomeRowsRaw, systemPrisma));
  const incomeByAgentId = new Map<string, number>();

  for (const row of incomeRows) {
    incomeByAgentId.set(row.managerUserId, (incomeByAgentId.get(row.managerUserId) || 0) + Number(row.paymentAmount || 0));
  }

  const callsCountByAgentId = new Map<string, number>();
  const callDurationByAgentId = new Map<string, number>();

  for (const call of calls) {
    const agentId = call.managerUserId;

    if (!agentId) {
      continue;
    }
    callsCountByAgentId.set(agentId, (callsCountByAgentId.get(agentId) || 0) + 1);
    callDurationByAgentId.set(agentId, (callDurationByAgentId.get(agentId) || 0) + Math.max(0, call.duration ?? 0));
  }

  const followUpsByAgentId = new Map<string, number>();
  let amocrmContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;

  try {
    amocrmContext = await getTenantAmoCRMContext(params.tenantId, systemPrisma);
  } catch (error) {
    logger.warn({
      tenantId: params.tenantId,
      error: thrownText(error),
    }, 'Noon agent performance: failed to load AmoCRM context');
  }
  const managerIds = normalizedAgents
    .map((agent) => ({ agentId: agent.id, amoId: agent.amocrmResponsibleUserId }))
    .filter((entry): entry is { agentId: string; amoId: string } => Boolean(entry.amoId));

  if (amocrmContext && managerIds.length > 0) {
    try {
      const responsibleIds = Array.from(new Set(managerIds.map((entry) => entry.amoId)));
      const tasks = await getAmoTasks(params.tenantId, {
        responsibleUserIds: responsibleIds,
        completed: true,
        dateFrom: params.periodStart,
        dateTo: params.periodEnd,
        entityType: 'leads',
      }, amocrmContext, systemPrisma);

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
    } catch (error) {
      logger.warn({
        tenantId: params.tenantId,
        error: thrownText(error),
      }, 'Noon agent performance: failed to fetch completed follow-ups from AmoCRM');
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
      status: true,
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
      const botToken = resolveTelegramBotToken(integration);

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
        } catch (error) {
          logger.warn({
            tenantId: integration.tenantId,
            userId: row.userId,
            chatId: row.telegramId,
            error: thrownText(error),
          }, 'Noon agent performance: failed to send message to agent');
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
            timezone: TASHKENT_TIMEZONE_LABEL,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            sentCount,
            agentCount: rows.length,
          },
        },
      });

      logger.info({
        tenantId: integration.tenantId,
        sentCount,
        agentCount: rows.length,
      }, 'Noon agent performance messages sent');
    } catch (error) {
      await redis.del(lockKey);
      await systemPrisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_agent_noon_performance_failed',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: 'daily_noon',
            timezone: TASHKENT_TIMEZONE_LABEL,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            error: thrownText(error),
          },
        },
      });

      reportError('Noon agent performance scheduler failed for tenant', {
        tenantId: integration.tenantId,
        error: thrownText(error),
      });
    }
  }
}

const schedulerJob = createIntervalJob({
  intervalMs: POLL_INTERVAL_MS,
  skipWhileRunning: true,
  run: async () => {
    const nowUtc = new Date();
    const window = resolveNoonWindow(nowUtc);

    if (window) {
      await dispatchNoonWindow(window, nowUtc);
    }
  },
  onError: (error) => {
    reportError('Noon agent performance scheduler tick failed', {
      error: String((error as Error | undefined)?.message || error),
    });
  },
  onStart: () => {
    logger.info({
      timezone: TASHKENT_TIMEZONE_LABEL,
      intervalMs: POLL_INTERVAL_MS,
    }, 'Telegram agent performance scheduler started');
  },
});

export function startTelegramAgentPerformanceScheduler(): void {
  schedulerJob.start();
}

export function stopTelegramAgentPerformanceScheduler(): void {
  schedulerJob.stop();
}
