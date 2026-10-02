import { planChainRepair, type RepairChainRow } from '../income-chain-repair';

function row(overrides: Partial<RepairChainRow> & { id: string }): RepairChainRow {
  return {
    type: 'repayment',
    lifecycleStatus: 'active',
    paymentAmount: 0,
    coursePriceAmount: null,
    debtAmount: null,
    remainingDebtAmount: null,
    entryDate: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

const sale = (overrides: Partial<RepairChainRow> = {}) => row({
  id: 'sale',
  type: 'new_sale',
  paymentAmount: 2_000_000,
  coursePriceAmount: 10_000_000,
  debtAmount: 10_000_000,
  remainingDebtAmount: 5_000_000,
  ...overrides,
});

describe('planChainRepair', () => {
  it('marks active repayments of a refunded sale as refunded and skips debt recompute', () => {
    const plan = planChainRepair({
      sale: sale({ lifecycleStatus: 'refunded' }),
      repayments: [row({ id: 'r1', paymentAmount: 3_000_000 })],
      hasPendingRefundRequest: false,
    });
    expect(plan.lifecycleUpdates).toEqual([{ id: 'r1', from: 'active', to: 'refunded' }]);
    expect(plan.debtUpdates).toEqual([]);
  });

  it('releases repayments stuck in pending_refund after a rejected refund and recomputes debt', () => {
    const plan = planChainRepair({
      sale: sale({ remainingDebtAmount: 8_000_000 }),
      repayments: [row({ id: 'r1', lifecycleStatus: 'pending_refund', paymentAmount: 3_000_000 })],
      hasPendingRefundRequest: false,
    });
    expect(plan.lifecycleUpdates).toEqual([{ id: 'r1', from: 'pending_refund', to: 'active' }]);
    expect(plan.debtUpdates).toEqual([
      { id: 'r1', debtAmount: 8_000_000, remainingDebtAmount: 5_000_000 },
      { id: 'sale', debtAmount: 10_000_000, remainingDebtAmount: 5_000_000 },
    ]);
  });

  it('leaves a chain alone while a refund request is still pending', () => {
    const plan = planChainRepair({
      sale: sale({ lifecycleStatus: 'pending_refund' }),
      repayments: [row({ id: 'r1', lifecycleStatus: 'pending_refund', paymentAmount: 3_000_000 })],
      hasPendingRefundRequest: true,
    });
    expect(plan).toEqual({ saleId: 'sale', lifecycleUpdates: [], debtUpdates: [] });
  });

  it('fixes stale repayment debt after a tariff change, in date order', () => {
    const plan = planChainRepair({
      sale: sale({ coursePriceAmount: 12_000_000, debtAmount: 12_000_000, remainingDebtAmount: 7_000_000 }),
      repayments: [
        row({ id: 'r2', paymentAmount: 1_000_000, entryDate: new Date('2026-09-10T00:00:00.000Z'), debtAmount: 5_000_000, remainingDebtAmount: 4_000_000 }),
        row({ id: 'r1', paymentAmount: 3_000_000, entryDate: new Date('2026-09-05T00:00:00.000Z'), debtAmount: 8_000_000, remainingDebtAmount: 5_000_000 }),
      ],
      hasPendingRefundRequest: false,
    });
    expect(plan.debtUpdates).toEqual([
      { id: 'r1', debtAmount: 10_000_000, remainingDebtAmount: 7_000_000 },
      { id: 'r2', debtAmount: 7_000_000, remainingDebtAmount: 6_000_000 },
      { id: 'sale', debtAmount: 12_000_000, remainingDebtAmount: 6_000_000 },
    ]);
  });
});
