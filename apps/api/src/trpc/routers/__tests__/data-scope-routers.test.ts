import { TRPCError } from '@trpc/server';

import { isSellerInScope, sellerScopeCacheKey } from '../../../services/sellers/scope';
import { canUseAnalyticsAi } from '../analytics-ai';
import { callScopeWhere, summarizeCallRows } from '../calls';
import { canWriteCorporateCallFor, corporateCallManagerFilter } from '../corporate-calls';
import { resolveFunnelGroup } from '../funnel';
import { isLeadResponsibleInScope } from '../leads';
import { adjustmentViewerUserIds, reportManagerFilter } from '../reports';
import { canSendTelegramBotMessages, filterTelegramTargetsToScope, telegramBotRouter } from '../telegram-bot';

import { buildCallerContext } from './procedure-test-context';

// Whose data each sales report shows: Admin/Manager/Finance everyone, team leaders and OnlineAdmin their
// group, agents themselves (`userIds` / `amoResponsibleIds` from resolveCallerDataScope; `null` = everyone).
const mockDb = {
  user: { findFirst: jest.fn(() => Promise.resolve({ id: 'me' })), findMany: jest.fn() },
  integration: { findUnique: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@dashboarduz/db'),
  forTenant: () => mockDb,
}));

const GROUP = ['me', 'a1', 'a2'];

describe('calls scope', () => {
  it('filters calls by the manager who made them', () => {
    expect(callScopeWhere(null)).toEqual({});
    expect(callScopeWhere(GROUP)).toEqual({ managerUserId: { in: GROUP } });
  });

  it('sums only the rows the report returns', () => {
    expect(summarizeCallRows([{ totalCalls: 2, totalDurationSeconds: 60 }, { totalCalls: 1, totalDurationSeconds: 5 }]))
      .toEqual({ totalAgents: 2, totalCalls: 3, totalDurationSeconds: 65 });
    expect(summarizeCallRows([])).toEqual({ totalAgents: 0, totalCalls: 0, totalDurationSeconds: 0 });
  });
});

describe('corporate calls scope', () => {
  const online = { kind: 'group', group: 'online', canWrite: true } as const;

  it('lets Admin write for anyone, OnlineAdmin for online users, others for themselves', () => {
    expect(canWriteCorporateCallFor(['Admin'], { kind: 'all' }, 'me', { id: 'x', roles: ['OfflineAgent'] })).toBe(true);
    expect(canWriteCorporateCallFor(['OnlineAdmin'], online, 'me', { id: 'x', roles: ['OnlineAgent'] })).toBe(true);
    expect(canWriteCorporateCallFor(['OnlineAdmin'], online, 'me', { id: 'x', roles: ['OfflineAgent'] })).toBe(false);
    expect(canWriteCorporateCallFor(['OfflineTeamLeader'], { kind: 'group', group: 'offline', canWrite: false }, 'me', { id: 'x', roles: ['OfflineAgent'] }))
      .toBe(false);
    expect(canWriteCorporateCallFor(['Agent'], { kind: 'self' }, 'me', { id: 'me', roles: ['Agent'] })).toBe(true);
  });

  it('keeps the list filter inside the scope', () => {
    expect(corporateCallManagerFilter(null, undefined)).toBeUndefined();
    expect(corporateCallManagerFilter(null, 'x')).toBe('x');
    expect(corporateCallManagerFilter(GROUP, 'a1')).toBe('a1');
    expect(corporateCallManagerFilter(GROUP, 'outsider')).toEqual({ in: GROUP });
    expect(corporateCallManagerFilter(['me'], 'outsider')).toBe('me');
  });
});

describe('leads and sellers scope', () => {
  it('shows a lead only when its responsible user is in scope', () => {
    expect(isLeadResponsibleInScope(null, null)).toBe(true);
    expect(isLeadResponsibleInScope(['501', '502'], '502')).toBe(true);
    expect(isLeadResponsibleInScope(['501'], '502')).toBe(false);
    expect(isLeadResponsibleInScope(['501'], null)).toBe(false);
    expect(isLeadResponsibleInScope([], '501')).toBe(false);
  });

  it('shows only sellers in scope and caches per scope', () => {
    expect(isSellerInScope(null, '9')).toBe(true);
    expect(isSellerInScope(['9'], '9')).toBe(true);
    expect(isSellerInScope(['9'], '8')).toBe(false);
    expect(isSellerInScope([], '9')).toBe(false);
    expect(sellerScopeCacheKey(null)).toBeNull();
    expect(sellerScopeCacheKey([])).toBe('__unmapped__');
    expect(sellerScopeCacheKey(['9', '1', '9'])).toBe('1|9');
  });
});

describe('funnel scope', () => {
  it("forces a group caller's group and leaves others' choice", () => {
    expect(resolveFunnelGroup({ kind: 'group', group: 'online', canWrite: false }, 'all')).toBe('online');
    expect(resolveFunnelGroup({ kind: 'group', group: 'offline', canWrite: false }, 'online')).toBe('offline');
    expect(resolveFunnelGroup({ kind: 'all' }, 'online')).toBe('online');
    expect(resolveFunnelGroup({ kind: 'self' }, 'all')).toBe('all');
  });
});

describe('reports scope', () => {
  it('limits the manager filter to the scope', () => {
    expect(reportManagerFilter(null, 'x')).toBe('x');
    expect(reportManagerFilter(null, undefined)).toBeUndefined();
    expect(reportManagerFilter(GROUP, 'a2')).toBe('a2');
    expect(reportManagerFilter(GROUP, 'x')).toEqual({ in: GROUP });
    expect(reportManagerFilter(['me'], undefined)).toBe('me');
  });

  it('gives a non-privileged adjustment viewer their scope (or themself)', () => {
    expect(adjustmentViewerUserIds(true, GROUP, 'me')).toBeNull();
    expect(adjustmentViewerUserIds(false, GROUP, 'me')).toEqual(GROUP);
    expect(adjustmentViewerUserIds(false, null, 'me')).toEqual(['me']);
  });
});

describe('analytics AI and Telegram bot access', () => {
  it('opens the company-wide AI analytics to Admin, Manager and Finance only', () => {
    expect(canUseAnalyticsAi(['Admin'])).toBe(true);
    expect(canUseAnalyticsAi(['Manager'])).toBe(true);
    expect(canUseAnalyticsAi(['Finance'])).toBe(true);
    expect(canUseAnalyticsAi(['OnlineAdmin'])).toBe(false);
    expect(canUseAnalyticsAi(['OnlineTeamLeader'])).toBe(false);
    expect(canUseAnalyticsAi(['Agent'])).toBe(false);
  });

  it('lets Admin, Manager and OnlineAdmin message users, not team leaders', async () => {
    expect(canSendTelegramBotMessages(['Admin'])).toBe(true);
    expect(canSendTelegramBotMessages(['Manager'])).toBe(true);
    expect(canSendTelegramBotMessages(['OnlineAdmin'])).toBe(true);
    expect(canSendTelegramBotMessages(['TeamLeader'])).toBe(false);
    expect(canSendTelegramBotMessages(['OfflineTeamLeader'])).toBe(false);

    const caller = telegramBotRouter.createCaller(buildCallerContext({ tenantId: 't1', userId: 'me', roles: ['OnlineTeamLeader'] }));
    const error = await caller.sendMessage({ userIds: ['11111111-1111-4111-8111-111111111111'], text: 'hi' }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: 'FORBIDDEN' });
  });

  it("limits an OnlineAdmin's targets to the online group", () => {
    expect(filterTelegramTargetsToScope(['a1', 'x'], GROUP)).toEqual(['a1']);
    expect(filterTelegramTargetsToScope(['a1', 'x'], null)).toEqual(['a1', 'x']);
  });
});
