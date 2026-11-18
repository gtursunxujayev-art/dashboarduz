import {
  buildSellerListRow,
  compareSellerListRows,
  countByManager,
  countDeadlineAdherence,
  countNewAndRepeatCustomers,
  groupCallsByManager,
  groupLeadsByManager,
  groupSellerIncomesByManager,
  managerIdByMappedUserId,
  percentToTwoDecimals,
  type SellerListSources,
  sumByManager,
} from '../list-rows';

const managerIdByUserId = managerIdByMappedUserId(new Map([['501', ['u-a', 'u-a2']], ['502', ['u-b']]]));

describe('sellers list grouping', () => {
  it('inverts manager -> users into user -> manager', () => {
    expect([...managerIdByUserId]).toEqual([['u-a', '501'], ['u-a2', '501'], ['u-b', '502']]);
  });

  it('groups leads of listed managers by their trimmed responsible user', () => {
    const grouped = groupLeadsByManager([
      { id: 1, responsible_user_id: ' 501 ' },
      { id: 2, responsible_user_id: 999 },
      { id: 3 },
      { id: 4, responsible_user_id: 501 },
    ], new Set(['501']));

    expect([...grouped].map(([id, leads]) => [id, leads.map((lead) => lead.id)])).toEqual([['501', [1, 4]]]);
  });

  it('groups calls and incomes of mapped users by manager, keeping only the fields metrics read', () => {
    const startedAt = new Date('2026-09-01T00:00:00Z');
    const calls = groupCallsByManager([
      { managerUserId: 'u-a2', duration: 5, direction: 'inbound', status: 'missed', startedAt },
      { managerUserId: null, duration: 9, direction: 'inbound', status: 'completed', startedAt },
      { managerUserId: 'u-x', duration: 9, direction: 'inbound', status: 'completed', startedAt },
    ], managerIdByUserId);
    const incomes = groupSellerIncomesByManager([
      { managerUserId: 'u-b', type: 'new_sale', paymentAmount: 1, coursePriceAmount: 2, debtAmount: 1, course: null },
      { managerUserId: null, type: 'new_sale', paymentAmount: 1, coursePriceAmount: 2, course: null },
    ], managerIdByUserId);

    expect([...calls]).toEqual([['501', [{ duration: 5, direction: 'inbound', status: 'missed', startedAt }]]]);
    expect([...incomes]).toEqual([['502', [{ type: 'new_sale', paymentAmount: 1, coursePriceAmount: 2, course: null }]]]);
  });

  it('adds up and counts per manager, skipping unmapped users', () => {
    expect([...sumByManager(new Map([['u-a', 10], ['u-a2', 5], ['u-x', 99]]), managerIdByUserId)]).toEqual([['501', 15]]);
    expect([...countByManager(['u-a', 'u-b', 'u-b', null, 'u-x'], managerIdByUserId)]).toEqual([['501', 1], ['502', 2]]);
  });

  it('counts each customer once per manager as new or repeat', () => {
    const result = countNewAndRepeatCustomers([
      { managerUserId: 'u-a', customerId: 'c1' },
      { managerUserId: 'u-a2', customerId: 'c1' },
      { managerUserId: 'u-a', customerId: 'c2' },
      { managerUserId: 'u-b', customerId: 'c1' },
      { managerUserId: null, customerId: 'c3' },
    ], new Set(['c2']), managerIdByUserId);

    expect([...result.newCustomersByManager]).toEqual([['501', 1], ['502', 1]]);
    expect([...result.repeatCustomersByManager]).toEqual([['501', 1]]);
  });

  it('counts deadlines met when paid off or entered by the deadline', () => {
    const deadline = new Date('2026-09-10T00:00:00Z');
    const result = countDeadlineAdherence([
      { managerUserId: 'u-a', entryDate: new Date('2026-09-10T00:00:00Z'), deadline, remainingDebtAmount: 5 },
      { managerUserId: 'u-a', entryDate: new Date('2026-09-11T00:00:00Z'), deadline, remainingDebtAmount: 5 },
      { managerUserId: 'u-b', entryDate: new Date('2026-09-11T00:00:00Z'), deadline, remainingDebtAmount: 0 },
      { managerUserId: 'u-b', entryDate: new Date('2026-09-11T00:00:00Z'), deadline: null, remainingDebtAmount: 5 },
    ], managerIdByUserId);

    expect([...result.deadlineTotalByManager]).toEqual([['501', 2], ['502', 1]]);
    expect([...result.deadlineMetByManager]).toEqual([['501', 1], ['502', 1]]);
  });

  it('rounds percentages to 2 decimals and answers 0 for an empty whole', () => {
    expect(percentToTwoDecimals(1, 3)).toBe(33.33);
    expect(percentToTwoDecimals(5, 0)).toBe(0);
  });
});

describe('sellers list rows', () => {
  function sources(overrides: Partial<SellerListSources> = {}): SellerListSources {
    return {
      rangeStart: new Date('2026-09-01T00:00:00Z'),
      rangeEnd: new Date('2026-09-30T23:59:59Z'),
      activeLeadsByManager: new Map(),
      newLeadsByManager: new Map([['501', [{ id: 1 }, { id: 2 }, { id: 3 }]]]),
      callsByManager: new Map(),
      activityByManager: new Map(),
      incomesByManager: new Map([['501', [{ type: 'new_sale', paymentAmount: 40, coursePriceAmount: 100, course: { category: 'online' } }]]]),
      corporateDurationByManager: new Map([['501', 30]]),
      refundsByManager: new Map([['501', 1]]),
      newCustomersByManager: new Map([['501', 1]]),
      repeatCustomersByManager: new Map([['501', 2]]),
      deadlineMetByManager: new Map(),
      deadlineTotalByManager: new Map([['501', 4]]),
      leadResponseTimeByManager: new Map(),
      ...overrides,
    };
  }

  it('builds a manager row from sales, leads and service quality numbers', () => {
    const row = buildSellerListRow({ id: 501, email: 'a@example.uz', rights: { is_admin: true } }, sources());

    expect(row).toMatchObject({ id: '501', name: 'Manager 501', email: 'a@example.uz', phone: null, roles: ['Manager'], lastLoginAt: null });
    expect(row.createdAt).toEqual(new Date(0));
    expect(row.metrics).toMatchObject({
      salesCount: 1,
      totalDealAmount: 100,
      incomeAmount: 40,
      totalCallDuration: 30,
      newLeadsInRange: 3,
      conversionRate: 33.33,
      refundCount: 1,
      refundRate: 100,
      newCustomerRate: 33.33,
      deadlineTotal: 4,
      deadlineMet: 0,
      deadlineAdherenceRate: 0,
      leadResponseTime: { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
    });
  });

  it('sorts by sales, then income, then talk time, then name', () => {
    const empty = sources({ incomesByManager: new Map(), corporateDurationByManager: new Map() });
    const rows = [
      buildSellerListRow({ id: 1, name: 'Zarina' }, empty),
      buildSellerListRow({ id: 2, name: 'Aziz' }, empty),
      buildSellerListRow({ id: 3, name: 'Talker' }, sources({ incomesByManager: new Map(), corporateDurationByManager: new Map([['3', 60]]) })),
      buildSellerListRow({ id: 501, name: 'Seller' }, sources()),
    ].sort(compareSellerListRows);

    expect(rows.map((row) => row.name)).toEqual(['Seller', 'Talker', 'Aziz', 'Zarina']);
  });
});
