import { resolveDataScope, resolveRoleGroup } from '@dashboarduz/shared';
import { describe, expect, it } from '@jest/globals';

import { isUserInScope } from '../access';

describe('data scope by role', () => {
  it('maps every role to all / group / self', () => {
    expect(resolveDataScope(['Admin'])).toEqual({ kind: 'all' });
    expect(resolveDataScope(['Manager'])).toEqual({ kind: 'all' });
    expect(resolveDataScope(['Finance'])).toEqual({ kind: 'all' });
    expect(resolveDataScope(['OnlineAdmin'])).toEqual({ kind: 'group', group: 'online', canWrite: true });
    expect(resolveDataScope(['OnlineTeamLeader', 'OnlineAgent'])).toEqual({ kind: 'group', group: 'online', canWrite: false });
    expect(resolveDataScope(['TeamLeader'])).toEqual({ kind: 'group', group: 'offline', canWrite: false });
    expect(resolveDataScope(['OfflineTeamLeader'])).toEqual({ kind: 'group', group: 'offline', canWrite: false });
    expect(resolveDataScope(['OnlineAgent'])).toEqual({ kind: 'self' });
    expect(resolveDataScope(['Agent'])).toEqual({ kind: 'self' });
  });

  it('puts team leaders and agents in their group', () => {
    expect(resolveRoleGroup(['OnlineTeamLeader'])).toBe('online');
    expect(resolveRoleGroup(['TeamLeader'])).toBe('offline');
    expect(resolveRoleGroup(['Finance'])).toBeNull();
  });

  it('checks whether a user is inside the caller scope', () => {
    const online = { kind: 'group' as const, group: 'online' as const, canWrite: false };

    expect(isUserInScope(online, 'tl', { id: 'x', roles: ['OnlineAgent'] })).toBe(true);
    expect(isUserInScope(online, 'tl', { id: 'y', roles: ['OfflineAgent'] })).toBe(false);
    expect(isUserInScope(online, 'tl', { id: 'tl', roles: ['OnlineTeamLeader'] })).toBe(true);
    expect(isUserInScope({ kind: 'self' }, 'me', { id: 'other', roles: ['OnlineAgent'] })).toBe(false);
  });
});
