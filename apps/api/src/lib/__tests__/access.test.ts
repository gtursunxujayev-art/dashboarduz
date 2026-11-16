import { getAgentResponsibleScope, isAgentOnly } from '../access';

describe('isAgentOnly', () => {
  it.each([
    [['Agent'], true],
    [['OnlineAgent', 'Dashboard'], true],
    [['Agent', 'Manager'], false],
    [['Finance', 'OfflineAgent'], false],
    [['Manager'], false],
    [[], false],
  ])('%p -> %p', (roles, expected) => {
    expect(isAgentOnly(roles)).toBe(expected);
  });
});

describe('getAgentResponsibleScope', () => {
  function fakeDb(findFirst: jest.Mock) {
    return { user: { findFirst } } as never;
  }

  it('does not scope privileged users or query the database', async () => {
    const findFirst = jest.fn();

    await expect(getAgentResponsibleScope('t', 'u', ['Admin', 'Agent'], fakeDb(findFirst))).resolves.toEqual({ isScoped: false, responsibleUserId: null });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('scopes agents to their amoCRM responsible user within the tenant', async () => {
    const findFirst = jest.fn().mockResolvedValue({ amocrmResponsibleUserId: '42' });

    await expect(getAgentResponsibleScope('t', 'u', ['Agent'], fakeDb(findFirst))).resolves.toEqual({ isScoped: true, responsibleUserId: '42' });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u', tenantId: 't', isActive: true } }));
  });

  it('tolerates a missing column but rethrows other errors', async () => {
    const missingColumn = jest.fn().mockRejectedValue(new Error('Unknown field amocrmResponsibleUserId'));
    const other = jest.fn().mockRejectedValue(new Error('connection lost'));

    await expect(getAgentResponsibleScope('t', 'u', ['Agent'], fakeDb(missingColumn))).resolves.toEqual({ isScoped: true, responsibleUserId: null });
    await expect(getAgentResponsibleScope('t', 'u', ['Agent'], fakeDb(other))).rejects.toThrow('connection lost');
  });
});
