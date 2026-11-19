import type { ResolvedDataScope } from '../../../lib/access';
import { redactTenantSettings, salarySettingsVisibility } from '../../../trpc/routers/tenant';
import { limitBonusResultToUsers, mergeFixedSalariesForUsers, restrictBonusRulesToOnline, restrictCourseOverridesToOnline } from '../../bonus-config/access';
import { canQueryScopedLeads, pickScopedUsers, resolveManagerFilter, scopedManagerWhere, scopedResponsibleIds } from '../data-scope';
import { canReadLiveLeaderboard } from '../live-leaderboard';

const all: ResolvedDataScope = { scope: { kind: 'all' }, userIds: null, amoResponsibleIds: null, canWriteOthers: true };
const group: ResolvedDataScope = { scope: { kind: 'group', group: 'online', canWrite: false }, userIds: ['lead', 'a', 'b'], amoResponsibleIds: ['501'], canWriteOthers: false };
const self: ResolvedDataScope = { scope: { kind: 'self' }, userIds: ['a'], amoResponsibleIds: [], canWriteOthers: false };
const users = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('dashboard data scope filters', () => {
  it('filters incomes and leads by the scope, not at all for the whole company', () => {
    expect(scopedManagerWhere(all)).toEqual({});
    expect(scopedManagerWhere(group)).toEqual({ managerUserId: { in: ['lead', 'a', 'b'] } });
    expect(scopedResponsibleIds(all)).toBeUndefined();
    expect(scopedResponsibleIds(group)).toEqual(['501']);
    // An unlinked agent has no leads to query (an empty filter could match every lead).
    expect(canQueryScopedLeads(self)).toBe(false);
    expect(canQueryScopedLeads(all)).toBe(true);
  });

  it('accepts a requested manager inside the scope and rejects one outside it', () => {
    expect(resolveManagerFilter(group, 'b')).toEqual({ managerUserId: 'b' });
    expect(resolveManagerFilter(all, 'c')).toEqual({ managerUserId: 'c' });
    expect(resolveManagerFilter(group)).toEqual({ managerUserId: { in: ['lead', 'a', 'b'] } });
    expect(() => resolveManagerFilter(group, 'c')).toThrow('outside your access scope');
  });

  it('picks report rows: own row for agents, the group for team leaders, everyone for admins', () => {
    expect(pickScopedUsers(self, users, { callerId: 'a', requestedUserId: 'b' })).toEqual({ users: [{ id: 'a' }], selectedUserId: 'a', agentScoped: true });
    expect(pickScopedUsers(group, users, { callerId: 'lead' }).users).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(pickScopedUsers(group, users, { callerId: 'lead', requestedUserId: 'b' }).users).toEqual([{ id: 'b' }]);
    expect(() => pickScopedUsers(group, users, { callerId: 'lead', requestedUserId: 'c' })).toThrow('outside your access scope');
    expect(pickScopedUsers(all, users, { callerId: 'x' }).users).toHaveLength(3);
  });
});

describe('live leaderboard access', () => {
  it('lets team leaders and OnlineAdmin watch only their own group board', () => {
    expect(canReadLiveLeaderboard(['OnlineAdmin'], 'online')).toBe(true);
    expect(canReadLiveLeaderboard(['OnlineAdmin'], 'offline')).toBe(false);
    expect(canReadLiveLeaderboard(['OnlineTeamLeader'], 'online')).toBe(true);
    expect(canReadLiveLeaderboard(['OnlineTeamLeader'], 'offline')).toBe(false);
    expect(canReadLiveLeaderboard(['OfflineTeamLeader'], 'offline')).toBe(true);
    expect(canReadLiveLeaderboard(['TeamLeader'], 'online')).toBe(false);
  });

  it('keeps Admin / Manager on both boards and the screen accounts on theirs', () => {
    expect(canReadLiveLeaderboard(['Manager'], 'offline')).toBe(true);
    expect(canReadLiveLeaderboard(['Admin'], 'online')).toBe(true);
    expect(canReadLiveLeaderboard(['Dashboard'], 'online')).toBe(true);
    expect(canReadLiveLeaderboard(['OfflineDashboard'], 'online')).toBe(false);
    expect(canReadLiveLeaderboard(['OnlineAgent'], 'online')).toBe(false);
  });
});

describe('tenant settings visibility', () => {
  const settings = { theme: 'dark', dashboard: { reasonFieldKey: 'x' }, salary: { bonusMode: 'on_income', fixedSalaries: [{ userId: 'a', amount: 1 }, { userId: 'c', amount: 2 }] } };

  it('shows salary settings to Admin / Manager / Finance, the online part to OnlineAdmin, none to others', () => {
    expect(salarySettingsVisibility(['Finance'])).toBe('full');
    expect(salarySettingsVisibility(['OnlineAdmin'])).toBe('online');
    expect(salarySettingsVisibility(['OnlineTeamLeader'])).toBe('none');
    expect(salarySettingsVisibility(['OnlineAgent'])).toBe('none');
    expect(redactTenantSettings(settings, 'full')).toBe(settings);
    expect(redactTenantSettings(settings, 'none')).toEqual({ theme: 'dark', dashboard: { reasonFieldKey: 'x' } });
    expect(redactTenantSettings(settings, 'online', ['a'])).toEqual({ ...settings, salary: { bonusMode: 'on_income', fixedSalaries: [{ userId: 'a', amount: 1 }] } });
  });
});

describe('OnlineAdmin bonus changes', () => {
  const rule = (percent: number) => ({ mode: 'simple' as const, tierBasis: 'sales_count' as const, simplePercent: percent, tiers: [] });
  const rules = (percent: number) => ({ online: rule(percent), offline: rule(percent), intensive: rule(percent), additional_service: rule(percent) });

  it('applies only the online rule and online course overrides', () => {
    expect(restrictBonusRulesToOnline({ current: { bonusMode: 'on_income', bonusRules: rules(1) }, requested: { bonusMode: 'on_debt_closed', bonusRules: rules(5) } }))
      .toEqual({ bonusMode: 'on_income', bonusRules: { ...rules(1), online: rule(5) } });
    expect(restrictCourseOverridesToOnline({
      current: { on1: 'old-on1', off1: 'old-off1' },
      requested: { on2: 'new-on2', off1: 'new-off1', off2: 'new-off2' },
      onlineCourseIds: new Set(['on1', 'on2']),
    })).toEqual({ off1: 'old-off1', on2: 'new-on2' });
  });

  it('merges fixed salaries and limits a month preview to the group', () => {
    expect(mergeFixedSalariesForUsers({ current: [{ userId: 'a', amount: 1 }, { userId: 'c', amount: 2 }], requested: [{ userId: 'a', amount: 9 }, { userId: 'c', amount: 9 }], allowedUserIds: ['a'] }))
      .toEqual([{ userId: 'c', amount: 2 }, { userId: 'a', amount: 9 }]);
    const result = { totalBonusAmount: 30, lines: [{ agentUserId: 'a', bonusAmount: 10 }, { agentUserId: 'c', bonusAmount: 20 }], items: [{ agentUserId: 'a' }, { agentUserId: 'c' }] };

    expect(limitBonusResultToUsers(result, ['a'])).toEqual({ totalBonusAmount: 10, lines: [{ agentUserId: 'a', bonusAmount: 10 }], items: [{ agentUserId: 'a' }] });
    expect(limitBonusResultToUsers(result, null)).toBe(result);
  });
});
