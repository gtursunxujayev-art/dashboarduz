import { describe, expect, it } from '@jest/globals';

import { assertCanAssignRoles, assertCanManageUser } from '../permissions';

const admin = { id: 'a', roles: ['Admin'] };
const onlineAgent = { id: 'o', roles: ['OnlineAgent'] };
const offlineAgent = { id: 'f', roles: ['OfflineAgent'] };

describe('user account permissions', () => {
  it('stops team leaders from changing any account or role', () => {
    for (const leader of [['TeamLeader'], ['OnlineTeamLeader'], ['OfflineTeamLeader']]) {
      expect(() => assertCanAssignRoles(leader, ['Admin'])).toThrow();
      expect(() => assertCanManageUser(leader, 'tl', admin)).toThrow();
      expect(() => assertCanManageUser(leader, 'tl', onlineAgent)).toThrow();
    }
  });

  it('lets a Manager manage staff but not admins or admin roles', () => {
    expect(() => assertCanAssignRoles(['Manager'], ['OnlineAgent'])).not.toThrow();
    expect(() => assertCanAssignRoles(['Manager'], ['Admin'])).toThrow();
    expect(() => assertCanAssignRoles(['Manager'], ['OnlineAdmin'])).toThrow();
    expect(() => assertCanManageUser(['Manager'], 'm', offlineAgent)).not.toThrow();
    expect(() => assertCanManageUser(['Manager'], 'm', admin)).toThrow();
  });

  it('limits an OnlineAdmin to online staff and online roles', () => {
    expect(() => assertCanAssignRoles(['OnlineAdmin'], ['OnlineAgent'])).not.toThrow();
    expect(() => assertCanAssignRoles(['OnlineAdmin'], ['OnlineTeamLeader'])).not.toThrow();
    expect(() => assertCanAssignRoles(['OnlineAdmin'], ['OfflineAgent'])).toThrow();
    expect(() => assertCanAssignRoles(['OnlineAdmin'], ['OnlineAdmin'])).toThrow();
    expect(() => assertCanManageUser(['OnlineAdmin'], 'oa', onlineAgent)).not.toThrow();
    expect(() => assertCanManageUser(['OnlineAdmin'], 'oa', offlineAgent)).toThrow();
    expect(() => assertCanManageUser(['OnlineAdmin'], 'oa', admin)).toThrow();
    expect(() => assertCanManageUser(['OnlineAdmin'], 'oa', { id: 'oa', roles: ['OnlineAdmin'] })).not.toThrow();
  });

  it('lets an Admin do anything', () => {
    expect(() => assertCanAssignRoles(['Admin'], ['Admin', 'Finance'])).not.toThrow();
    expect(() => assertCanManageUser(['Admin'], 'a', admin)).not.toThrow();
  });
});
