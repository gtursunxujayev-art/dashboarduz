import {
  buildTechnicalSaleIdSet,
  classifyIncomeCategory,
  excludeTechnicalRows,
  resolveRowSaleId,
  resolveSaleAgreementAmount,
} from '../income-facts';

describe('income facts', () => {
  it('resolves the agreement with one formula', () => {
    expect(resolveSaleAgreementAmount({ coursePriceAmount: 5_000_000, debtAmount: 4_000_000, paymentAmount: 1_000_000 })).toBe(5_000_000);
    expect(resolveSaleAgreementAmount({ coursePriceAmount: null, debtAmount: 5_000_000, paymentAmount: 1_000_000 })).toBe(5_000_000);
    expect(resolveSaleAgreementAmount({ coursePriceAmount: null, debtAmount: null, paymentAmount: 1_000_000 })).toBe(1_000_000);
    expect(resolveSaleAgreementAmount({ coursePriceAmount: 0, debtAmount: 5_000_000, paymentAmount: 200_000 })).toBe(0);
    expect(resolveSaleAgreementAmount({ coursePriceAmount: -5, paymentAmount: 1 })).toBe(0);
  });

  it('classifies categories from the category field, then the course name', () => {
    expect(classifyIncomeCategory({ category: 'online', name: 'Offline-Iyul' })).toBe('online');
    expect(classifyIncomeCategory({ category: 'Onlayn', name: null })).toBe('online');
    expect(classifyIncomeCategory({ category: 'additional_service', name: 'Online marketing' })).toBe('additional_service');
    expect(classifyIncomeCategory({ category: '', name: 'Intensiv-2026' })).toBe('intensive');
    expect(classifyIncomeCategory(null)).toBe('other');
  });

  it('excludes technical sales and their repayments', () => {
    const technical = buildTechnicalSaleIdSet([
      { id: 'tech', type: 'new_sale', coursePriceAmount: 1, paymentAmount: 0 },
      { id: 'real', type: 'new_sale', coursePriceAmount: 5_000_000, paymentAmount: 1_000_000 },
    ]);
    const rows = [
      { id: 'tech', type: 'new_sale', relatedDebtIncomeId: null },
      { id: 'rep-tech', type: 'repayment', relatedDebtIncomeId: 'tech' },
      { id: 'real', type: 'new_sale', relatedDebtIncomeId: null },
      { id: 'rep-real', type: 'repayment', relatedDebtIncomeId: 'real' },
    ];
    expect(excludeTechnicalRows(rows, technical).map((row) => row.id)).toEqual(['real', 'rep-real']);
    expect(resolveRowSaleId(rows[1]!)).toBe('tech');
  });
});
