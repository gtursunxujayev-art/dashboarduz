import type { DbClient } from '@dashboarduz/db';

import { echoReportRange } from '../../../lib/dates';
import { buildCustomerListWhere } from '../customer-list';
import {
  activeSalesWhere,
  buildCourseSaleFilters,
  loadSalePaymentTotals,
  sumPaymentsBySale,
} from '../queries';

function fakeDb(incomeRows: unknown[] = []) {
  const findMany = jest.fn().mockResolvedValue(incomeRows);

  return { db: { income: { findMany } } as unknown as DbClient, findMany };
}

describe('course-sales query builders', () => {
  it('activeSalesWhere scopes active new sales to an agent and ANDs the filters', () => {
    expect(activeSalesWhere({ tenantId: 't1' })).toEqual({
      tenantId: 't1',
      type: 'new_sale',
      lifecycleStatus: 'active',
    });
    expect(activeSalesWhere({
      tenantId: 't1',
      scopedManagerUserIds: ['u1', 'u2'],
      filters: [{ courseId: 'c1' }],
      extra: { entryDate: { gte: new Date(0), lte: new Date(1) } },
    })).toEqual({
      tenantId: 't1',
      type: 'new_sale',
      lifecycleStatus: 'active',
      managerUserId: { in: ['u1', 'u2'] },
      AND: [{ courseId: 'c1' }],
      entryDate: { gte: new Date(0), lte: new Date(1) },
    });
  });

  it('buildCourseSaleFilters: one course, or every course of the category', async () => {
    const { db, findMany } = fakeDb();

    await expect(buildCourseSaleFilters({ db, tenantId: 't1', courseId: 'c1', tariffId: 'tr1' }))
      .resolves.toEqual([{ courseId: 'c1' }, { tariffId: 'tr1' }]);
    await expect(buildCourseSaleFilters({ db, tenantId: 't1', categoryCourseIds: ['c1', 'c2'] }))
      .resolves.toEqual([{ courseId: { in: ['c1', 'c2'] } }]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('buildCourseSaleFilters rejects a course outside the category in Uzbek', async () => {
    const { db } = fakeDb();

    await expect(buildCourseSaleFilters({ db, tenantId: 't1', courseId: 'c9', categoryCourseIds: ['c1'] }))
      .rejects.toThrow('Kurs tanlangan turga tegishli emas.');
  });

  it('buildCourseSaleFilters resolves a sub-tariff to the matching sale ids', async () => {
    const { db, findMany } = fakeDb([
      { id: 's1', courseId: 'c1', tariffId: 'tr1', legacyImportMeta: { saleSubTariffId: 'st1' }, customer: null },
      { id: 's2', courseId: 'c1', tariffId: 'tr1', legacyImportMeta: null, customer: { profileCourseId: 'c1', profileTariffId: 'tr1', profileSubTariffId: 'st1' } },
      { id: 's3', courseId: 'c1', tariffId: 'tr1', legacyImportMeta: null, customer: { profileCourseId: 'c1', profileTariffId: 'tr1', profileSubTariffId: 'st2' } },
    ]);

    await expect(buildCourseSaleFilters({ db, tenantId: 't1', courseId: 'c1', subTariffId: 'st1' }))
      .resolves.toEqual([{ courseId: 'c1' }, { id: { in: ['s1', 's2'] } }]);
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', type: 'new_sale', AND: [{ courseId: 'c1' }] });
  });

  it('buildCustomerListWhere adds the entry-date window and a case-insensitive search', () => {
    const entryDate = { gte: new Date(0), lte: new Date(1) };

    expect(buildCustomerListWhere({ tenantId: 't1', filters: [], entryDate, query: 'ali' })).toEqual({
      tenantId: 't1',
      type: 'new_sale',
      lifecycleStatus: 'active',
      entryDate,
      OR: [
        { customer: { customerNumber: { contains: 'ali', mode: 'insensitive' } } },
        { customer: { name: { contains: 'ali', mode: 'insensitive' } } },
      ],
    });
    expect(buildCustomerListWhere({ tenantId: 't1', filters: [{ courseId: 'c1' }] })).toEqual({
      tenantId: 't1',
      type: 'new_sale',
      lifecycleStatus: 'active',
      AND: [{ courseId: 'c1' }],
    });
  });

  it('sumPaymentsBySale credits repayments to their sale and skips other sales', () => {
    const totals = sumPaymentsBySale([
      { id: 's1', relatedDebtIncomeId: null, paymentAmount: 100 },
      { id: 'p1', relatedDebtIncomeId: 's1', paymentAmount: 50 },
      { id: 'p2', relatedDebtIncomeId: 's2', paymentAmount: 7 },
      { id: 's3', relatedDebtIncomeId: null, paymentAmount: null },
    ], new Set(['s1', 's3']));

    expect(Array.from(totals.entries())).toEqual([['s1', 150], ['s3', 0]]);
  });

  it('loadSalePaymentTotals skips the queries when there are no sales', async () => {
    const { db, findMany } = fakeDb();
    const result = await loadSalePaymentTotals({ db, tenantId: 't1', saleIds: [], rangeStart: new Date(0), rangeEnd: new Date(1) });

    expect(result.rangeIncomeBySaleId.size).toBe(0);
    expect(result.currentIncomeBySaleId.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('echoReportRange returns the dates only for a custom range', () => {
    expect(echoReportRange({ range: 'month', dateFrom: '2026-01-01', dateTo: '2026-01-31' }))
      .toEqual({ range: 'month', dateFrom: null, dateTo: null });
    expect(echoReportRange({ range: 'custom', dateFrom: '2026-01-01', dateTo: '' }))
      .toEqual({ range: 'custom', dateFrom: '2026-01-01', dateTo: null });
  });
});
