import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, type MoneyFixture, seedCustomer, seedSaleChain, tashkentMonthDay, tashkentMonthKey } from '../../../../__tests__/helpers/money-fixtures';
import { getTashkentMonthStart } from '../../../../services/bonus-engine';
import { bonusRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;
let saleId: string;
let repaymentId: string;
const lastMonth = tashkentMonthKey(1);

const caller = (userId: string, roles: JWTPayload['roles']) => bonusRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);

function useSettings(salary: Record<string, unknown>) {
  fixture.store.tables.get('Tenant')![0]!.settings = { salary };
}

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  useSettings({ bonusMode: 'on_income', bonusPercentages: { offline: 10, intensive: 5 } });
  const customerId = seedCustomer(fixture, '998931110000');

  // A 3 000 000 offline sale: 1 000 000 by Aziz on the 5th, closed by Bobur's 2 000 000 on the 15th of last month.
  const chain = seedSaleChain(fixture, {
    customerId,
    agreementAmount: 3_000_000,
    firstPayment: 1_000_000,
    entryDate: tashkentMonthDay(1, 5),
    repayments: [{ amount: 2_000_000, entryDate: tashkentMonthDay(1, 15), managerUserId: fixture.otherAgentId }],
  });

  saleId = chain.saleId;
  repaymentId = chain.repaymentIds[0]!;
});

describe('bonus month preview and finalize (on_income)', () => {
  it('previews 10% of every offline payment for the agent who took it', async () => {
    const preview = await admin().previewBonusMonth({ month: lastMonth });

    expect(preview.month).toBe(lastMonth);
    expect(preview.finalized).toBe(false);
    expect(preview.totalBonusAmount).toBe(300_000);
    expect(preview.items.map((item) => [item.sourceKey, item.agentUserId, item.baseAmount, item.appliedPercent, item.bonusAmount])).toEqual([
      [`income:${saleId}`, fixture.agentId, 1_000_000, 10, 100_000],
      [`income:${repaymentId}`, fixture.otherAgentId, 2_000_000, 10, 200_000],
    ]);
    expect(preview.lines.map((line) => [line.agentUserId, line.category, line.calculationMode, line.qualifyingAmount, line.bonusAmount, line.sourceCount])).toEqual(
      [
        [fixture.agentId, 'offline', 'legacy_income', 1_000_000, 100_000, 1],
        [fixture.otherAgentId, 'offline', 'legacy_income', 2_000_000, 200_000, 1],
      ].sort((left, right) => `${String(left[0])}`.localeCompare(`${String(right[0])}`)),
    );
  });

  it('pays no bonus to a user without an agent role', async () => {
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.managerUserId = fixture.managerId;
    });

    const preview = await admin().previewBonusMonth({ month: lastMonth });

    expect(preview.totalBonusAmount).toBe(100_000);
    expect(preview.items.map((item) => item.agentUserId)).toEqual([fixture.agentId]);
  });

  it('freezes the month into a snapshot that later reads return unchanged', async () => {
    const finalized = await admin().finalizeBonusMonth({ month: lastMonth });

    expect(finalized).toMatchObject({ month: lastMonth, finalized: true, totalBonusAmount: 300_000 });
    const [snapshot] = fixture.store.rows('BonusMonthSnapshot');

    expect(snapshot).toMatchObject({ totalBonusAmount: 300_000, finalizedByUserId: fixture.adminId, policyVersionId: null });
    expect(fixture.store.rows('BonusSnapshotLine').map((line) => line.bonusAmount).sort()).toEqual([100_000, 200_000]);
    expect(fixture.store.rows('BonusSnapshotItem').map((item) => [item.sourceIncomeId, item.metadata])).toEqual(expect.arrayContaining([
      [repaymentId, expect.objectContaining({ courseName: 'Foundation English', agreementAmount: 3_000_000, closingIncomeId: repaymentId, usedFallback: false })],
    ]));

    // Data changes after finalization do not move the frozen numbers.
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.paymentAmount = 1_000_000;
    });
    const again = await admin().finalizeBonusMonth({ month: lastMonth });

    expect(again.totalBonusAmount).toBe(300_000);
    expect(again.items.find((item) => item.sourceIncomeId === repaymentId)).toMatchObject({ appliedPercent: 10, bonusAmount: 200_000, agreementAmount: 3_000_000 });
    expect(fixture.store.rows('BonusMonthSnapshot')).toHaveLength(1);
  });

  it('returns the snapshot of a concurrent finalize instead of failing', async () => {
    let raced = false;

    // The other finalize commits its snapshot of the same month while this one is still calculating.
    fixture.store.beforeOperation = (modelName, operation) => {
      if (modelName !== 'Income' || operation !== 'findMany' || raced) return;
      raced = true;
      fixture.store.seed('BonusMonthSnapshot', [{
        tenantId: fixture.tenantId,
        month: getTashkentMonthStart(lastMonth),
        policy: {},
        sourceDigest: 'other-finalize',
        totalBonusAmount: 123,
        finalizedByUserId: fixture.adminId,
      }]);
    };

    const result = await admin().finalizeBonusMonth({ month: lastMonth });

    expect(result.totalBonusAmount).toBe(123);
    expect(fixture.store.rows('BonusMonthSnapshot')).toHaveLength(1);
    expect(fixture.store.rows('BonusSnapshotLine')).toHaveLength(0);
  });

  it('refuses the current month and non-admins', async () => {
    await expect(admin().finalizeBonusMonth({ month: tashkentMonthKey(0) })).rejects.toThrow('Only completed months can be finalized.');
    await expect(caller(fixture.agentId, ['Agent']).finalizeBonusMonth({ month: lastMonth })).rejects.toThrow('Admin access required');
    await expect(caller(fixture.agentId, ['Agent']).getBonusOperations()).rejects.toThrow('FORBIDDEN');
  });
});

describe('bonus calculation modes', () => {
  it('on_debt_closed pays the closer a percent of the whole agreement in the closing month', async () => {
    useSettings({ bonusMode: 'on_debt_closed', bonusPercentages: { offline: 4 } });

    const preview = await admin().previewBonusMonth({ month: lastMonth });

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({
      sourceKey: `legacy-close:${repaymentId}`,
      agentUserId: fixture.otherAgentId,
      calculationMode: 'legacy_debt_closed',
      baseAmount: 3_000_000,
      appliedPercent: 4,
      bonusAmount: 120_000,
      closedCount: 1,
      closedAgreementAmount: 3_000_000,
    });
  });

  it('tiers on the number of closures in the month and falls back to the simple percent below the first tier', async () => {
    useSettings({
      bonusMode: 'on_debt_closed',
      bonusRules: { offline: { mode: 'tiered', simplePercent: 2, tiers: [{ minSales: 2, maxSales: null, percent: 6 }] } },
    });

    const one = await admin().previewBonusMonth({ month: lastMonth });

    expect(one.items[0]).toMatchObject({ appliedPercent: 2, bonusAmount: 60_000, usedFallback: true });

    const customerId = seedCustomer(fixture, '998931110001');

    seedSaleChain(fixture, { customerId, managerUserId: fixture.otherAgentId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: tashkentMonthDay(1, 20) });
    const two = await admin().previewBonusMonth({ month: lastMonth });

    expect(two.items.map((item) => [item.baseAmount, item.appliedPercent, item.bonusAmount, item.usedFallback])).toEqual([
      [3_000_000, 6, 180_000, false],
      [1_000_000, 6, 60_000, false],
    ]);
    expect(two.totalBonusAmount).toBe(240_000);
  });

  it('a course override pays its team tier on closures and splits the rounding across items', async () => {
    fixture.store.seed('BonusPolicyVersion', [{
      tenantId: fixture.tenantId,
      effectiveMonth: new Date('1970-01-01T00:00:00.000Z'),
      policy: {
        bonusMode: 'on_income',
        bonusPercentages: { offline: 10 },
        courseOverrides: {
          [fixture.courseId]: { mode: 'monthly_team_income_tiered', fallbackPercent: 1, tiers: [{ minAmount: 3_000_001, maxAmount: null, percent: 3.333 }] },
        },
      },
    }]);
    const customerId = seedCustomer(fixture, '998931110002');

    seedSaleChain(fixture, { customerId, managerUserId: fixture.otherAgentId, agreementAmount: 1_000_001, firstPayment: 1_000_001, entryDate: tashkentMonthDay(1, 21) });

    const preview = await admin().previewBonusMonth({ month: lastMonth });

    // Team total 4 000 001 reaches the 3.33% tier; Bobur closed both sales. 3.33% of 4 000 001 = 133 200.03.
    expect(preview.policyVersionId).toBe(fixture.store.rows('BonusPolicyVersion')[0]!.id);
    expect(preview.items.map((item) => [item.calculationMode, item.agentUserId, item.baseAmount, item.appliedPercent, item.bonusAmount])).toEqual([
      ['course_team_income', fixture.otherAgentId, 3_000_000, 3.33, 99_900],
      ['course_team_income', fixture.otherAgentId, 1_000_001, 3.33, 33_300],
    ]);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]).toMatchObject({ qualifyingAmount: 4_000_001, bonusAmount: 133_200, sourceCount: 2 });
  });
});

describe('bonus adjustments after finalization', () => {
  it('a later change creates a pending correction, approval schedules it for this month', async () => {
    await admin().finalizeBonusMonth({ month: lastMonth });
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.paymentAmount = 1_500_000;
    });

    await expect(admin().reconcileBonusMonth({ month: lastMonth })).resolves.toEqual({ pendingCount: 1 });
    const [adjustment] = fixture.store.rows('BonusAdjustment');

    expect(adjustment).toMatchObject({ agentUserId: fixture.otherAgentId, category: 'offline', deltaAmount: -50_000, outstandingAmount: -50_000, status: 'pending' });
    expect(fixture.store.rows('BonusAdjustmentAudit').map((audit) => audit.action)).toEqual(['created']);

    // Reconciling again with the same data recalculates the same pending row instead of adding one.
    await admin().reconcileBonusMonth({ month: lastMonth });
    expect(fixture.store.rows('BonusAdjustment')).toHaveLength(1);
    expect(fixture.store.rows('BonusAdjustmentAudit').map((audit) => audit.action)).toEqual(['created', 'recalculated']);

    await expect(admin().reviewBonusAdjustment({ adjustmentId: String(adjustment!.id), action: 'reject' })).rejects.toThrow('A rejection reason is required.');
    const approved = await admin().reviewBonusAdjustment({ adjustmentId: String(adjustment!.id), action: 'approve', note: ' ok ' });

    expect(approved).toMatchObject({ status: 'approved', reviewedByUserId: fixture.adminId, reviewNote: 'ok' });
    expect(approved.payoutMonth).toEqual(getTashkentMonthStart(new Date()));
    await expect(admin().reviewBonusAdjustment({ adjustmentId: String(adjustment!.id), action: 'approve' })).rejects.toThrow('Pending bonus adjustment was not found.');

    const operations = await admin().getBonusOperations();

    expect(operations.snapshots).toEqual([expect.objectContaining({ month: lastMonth, totalBonusAmount: 300_000 })]);
    expect(operations.adjustments).toEqual([expect.objectContaining({ sourceMonth: lastMonth, payoutMonth: tashkentMonthKey(0), status: 'approved', deltaAmount: -50_000 })]);
  });

  it('drops a pending correction once the data is back to what was finalized', async () => {
    await admin().finalizeBonusMonth({ month: lastMonth });
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.paymentAmount = 1_500_000;
    });
    await admin().reconcileBonusMonth({ month: lastMonth });
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === repaymentId) row.paymentAmount = 2_000_000;
    });

    await expect(admin().reconcileBonusMonth({ month: lastMonth })).resolves.toEqual({ pendingCount: 0 });
    expect(fixture.store.rows('BonusAdjustment')).toHaveLength(0);
  });

  it('a month without a snapshot has nothing to reconcile', async () => {
    await expect(admin().reconcileBonusMonth({ month: lastMonth })).resolves.toEqual({ pendingCount: 0 });
  });
});
