import { canApproveRefundRequest, canApproveTariffChangeRequest, canSelectInactiveManagerForIncome, hasSalesManagerRole } from '../roles';
import {
  assertCourseCategoryInScope,
  assertManagerInScope,
  canActForManager,
  canEditCourseCatalog,
  customerInScopeWhere,
  incomeManagerWhere,
  isCourseCategoryInScope,
  resolveIncomeWriterIds,
  writableCustomerWhere,
} from '../scope';

describe('income scope filters', () => {
  it('filters incomes by manager only when the caller is scoped', () => {
    expect(incomeManagerWhere(null)).toEqual({});
    expect(incomeManagerWhere(['a', 'b'])).toEqual({ managerUserId: { in: ['a', 'b'] } });
  });

  it('limits customers to those with an income by a user in scope, keeping extra income conditions', () => {
    expect(customerInScopeWhere(null, { lifecycleStatus: 'active' })).toEqual({});
    expect(customerInScopeWhere(['a'], { lifecycleStatus: 'active' })).toEqual({
      incomes: { some: { lifecycleStatus: 'active', managerUserId: { in: ['a'] } } },
    });
  });

  it('lets a scoped admin edit customers of the group or without any income yet', () => {
    expect(writableCustomerWhere(null)).toEqual({});
    expect(writableCustomerWhere(['a'])).toEqual({
      OR: [{ incomes: { some: { managerUserId: { in: ['a'] } } } }, { incomes: { none: {} } }],
    });
  });
});

describe('resolveIncomeWriterIds', () => {
  const group = ['me', 'agent-1', 'agent-2'];

  it('lets unscoped callers write for anyone', () => {
    expect(resolveIncomeWriterIds({ scope: { kind: 'all' }, userIds: null }, 'me')).toBeNull();
  });

  it('keeps agents and read-only team leaders to themselves', () => {
    expect(resolveIncomeWriterIds({ scope: { kind: 'self' }, userIds: ['me'] }, 'me')).toEqual(['me']);
    expect(resolveIncomeWriterIds({ scope: { kind: 'group', group: 'online', canWrite: false }, userIds: group }, 'me')).toEqual(['me']);
    expect(resolveIncomeWriterIds({ scope: { kind: 'group', group: 'offline', canWrite: false }, userIds: group }, 'me')).toEqual(['me']);
  });

  it('lets OnlineAdmin write for anyone in the online group', () => {
    expect(resolveIncomeWriterIds({ scope: { kind: 'group', group: 'online', canWrite: true }, userIds: group }, 'me')).toEqual(group);
  });

  it('checks a manager against the writer ids', () => {
    expect(canActForManager(null, 'x')).toBe(true);
    expect(canActForManager(['me'], 'me')).toBe(true);
    expect(canActForManager(['me'], 'x')).toBe(false);
    expect(canActForManager(['me'], null)).toBe(false);
    expect(() => assertManagerInScope(['me'], 'x')).toThrow('Bu yozuv sizning guruhingizga tegishli emas.');
    expect(() => assertManagerInScope(null, 'x')).not.toThrow();
  });
});

describe('course catalog scope', () => {
  it('lets Admin, Manager and OnlineAdmin edit the catalog, not team leaders or agents', () => {
    expect(canEditCourseCatalog(['Admin'])).toBe(true);
    expect(canEditCourseCatalog(['Manager'])).toBe(true);
    expect(canEditCourseCatalog(['OnlineAdmin'])).toBe(true);
    expect(canEditCourseCatalog(['TeamLeader'])).toBe(false);
    expect(canEditCourseCatalog(['OnlineTeamLeader'])).toBe(false);
    expect(canEditCourseCatalog(['OfflineTeamLeader'])).toBe(false);
    expect(canEditCourseCatalog(['Agent'])).toBe(false);
  });

  it('limits a group scope to courses of that category', () => {
    const online = { kind: 'group', group: 'online', canWrite: true } as const;

    expect(isCourseCategoryInScope({ kind: 'all' }, 'offline')).toBe(true);
    expect(isCourseCategoryInScope(online, 'online')).toBe(true);
    expect(isCourseCategoryInScope(online, 'offline')).toBe(false);
    expect(isCourseCategoryInScope(online, 'intensive')).toBe(false);
    expect(isCourseCategoryInScope(online, null)).toBe(false);
    expect(() => assertCourseCategoryInScope(online, 'offline')).toThrow('Faqat online kurslarni tahrirlash mumkin.');
  });
});

describe('customer-income role sets', () => {
  it('drops team leaders from approvers and adds OnlineAdmin', () => {
    expect(canApproveTariffChangeRequest(['TeamLeader'])).toBe(false);
    expect(canApproveTariffChangeRequest(['OnlineTeamLeader'])).toBe(false);
    expect(canApproveTariffChangeRequest(['OnlineAdmin'])).toBe(true);
    expect(canApproveTariffChangeRequest(['Manager'])).toBe(true);
    expect(canApproveTariffChangeRequest(['Tashkiliy'])).toBe(true);
    expect(canApproveRefundRequest(['OnlineAdmin'])).toBe(true);
    expect(canApproveRefundRequest(['Finance'])).toBe(true);
    expect(canApproveRefundRequest(['Manager'])).toBe(false);
  });

  it('treats team leaders and OnlineAdmin as sales managers', () => {
    for (const role of ['OnlineTeamLeader', 'OfflineTeamLeader', 'TeamLeader', 'OnlineAdmin', 'OnlineAgent']) {
      expect(hasSalesManagerRole([role])).toBe(true);
    }
    expect(hasSalesManagerRole(['Finance'])).toBe(false);
  });

  it('lets OnlineAdmin and every team leader role pick a deactivated manager', () => {
    for (const role of ['Admin', 'OnlineAdmin', 'Finance', 'TeamLeader', 'OnlineTeamLeader', 'OfflineTeamLeader']) {
      expect(canSelectInactiveManagerForIncome([role])).toBe(true);
    }
    expect(canSelectInactiveManagerForIncome(['Agent'])).toBe(false);
  });
});
