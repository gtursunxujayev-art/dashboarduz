import { Prisma } from '@prisma/client';

import { rowMatchesSaleChainState, withSaleSubTariffMeta } from '../sale-chain';

describe('withSaleSubTariffMeta', () => {
  it('sets the sale sub-tariff id and keeps the other meta keys', () => {
    expect(withSaleSubTariffMeta({ source: 'import', row: 7 }, 'sub-1')).toEqual({ source: 'import', row: 7, saleSubTariffId: 'sub-1' });
    expect(withSaleSubTariffMeta({ saleSubTariffId: 'old' }, 'new')).toEqual({ saleSubTariffId: 'new' });
  });

  it('removes the id when it is cleared, and gives JsonNull once nothing is left', () => {
    expect(withSaleSubTariffMeta({ source: 'import', saleSubTariffId: 'sub-1' }, null)).toEqual({ source: 'import' });
    expect(withSaleSubTariffMeta({ saleSubTariffId: 'sub-1' }, null)).toBe(Prisma.JsonNull);
    expect(withSaleSubTariffMeta(null, null)).toBe(Prisma.JsonNull);
  });

  it('starts from an empty object when the stored meta is not a plain object', () => {
    expect(withSaleSubTariffMeta(undefined, 'sub-1')).toEqual({ saleSubTariffId: 'sub-1' });
    expect(withSaleSubTariffMeta(['a', 'b'], 'sub-1')).toEqual({ saleSubTariffId: 'sub-1' });
    expect(withSaleSubTariffMeta('text', 'sub-1')).toEqual({ saleSubTariffId: 'sub-1' });
    expect(withSaleSubTariffMeta(42, null)).toBe(Prisma.JsonNull);
  });

  it('does not mutate the stored meta', () => {
    const stored = { saleSubTariffId: 'sub-1', note: 'x' };

    withSaleSubTariffMeta(stored, null);
    expect(stored).toEqual({ saleSubTariffId: 'sub-1', note: 'x' });
  });
});

describe('rowMatchesSaleChainState', () => {
  const sale = { id: 'sale', paymentAmount: 500_000, coursePriceAmount: 1_500_000, debtAmount: 1_000_000, remainingDebtAmount: 1_000_000, lifecycleStatus: 'active' };
  const repayment = { id: 'repay', paymentAmount: 400_000, coursePriceAmount: null, debtAmount: null, remainingDebtAmount: 600_000, lifecycleStatus: 'active' };
  const state = [sale, repayment];

  it('is true only when every recorded money field is unchanged', () => {
    expect(rowMatchesSaleChainState(state, { ...repayment })).toBe(true);
    expect(rowMatchesSaleChainState(state, { ...sale, paymentAmount: 500_001 })).toBe(false);
    expect(rowMatchesSaleChainState(state, { ...sale, coursePriceAmount: null })).toBe(false);
    expect(rowMatchesSaleChainState(state, { ...sale, debtAmount: 0 })).toBe(false);
    expect(rowMatchesSaleChainState(state, { ...repayment, remainingDebtAmount: 0 })).toBe(false);
    expect(rowMatchesSaleChainState(state, { ...repayment, lifecycleStatus: 'pending_refund' })).toBe(false);
  });

  it('is false for a row that was not in the recorded state', () => {
    expect(rowMatchesSaleChainState(state, { ...sale, id: 'other' })).toBe(false);
    expect(rowMatchesSaleChainState([], { ...sale })).toBe(false);
  });
});
