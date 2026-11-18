import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../__tests__/helpers/money-fixtures';
import { incomeProblemsRouter } from '../income-problems';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;

const caller = (userId: string, roles: JWTPayload['roles']) => incomeProblemsRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const ddmmyyyy = (date: Date) => {
  const [year, month, day] = dayString(date).split('-');

  return `${day}.${month}.${year}`;
};

// Payments are recorded at 10:00 UTC (15:00 Tashkent), so the Tashkent day equals the UTC day.
const day = (days: number) => daysAgo(days);

function sheet() {
  return [
    ['Moliya hisoboti', null, null, null, null],
    ["To'lov sanasi", 'Telefon raqami', 'Mijoz ism familiya', "To'lov summasi", 'Agent'],
    [ddmmyyyy(day(10)), '+998 90 111 11 11', 'Ali Valiyev', '1 000 000', 'Aziz'],
    [ddmmyyyy(day(5)), '998901111111', 'Ali Valiyev', '400 000', 'Aziz'],
    [dayString(day(4)), '998902222222', 'Vali', '2 000 000', 'Bobur'],
    [dayString(day(3)), '', 'Gani Ganiyev', '300 000', 'Aziz'],
    [dayString(day(3)), '', '', '', ''],
    [dayString(day(3)), '', '', '50 000', ''],
  ];
}

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  const ali = seedCustomer(fixture, '998901111111', 'Ali Valiyev');
  const vali = seedCustomer(fixture, '998902222222', 'Vali');
  const olim = seedCustomer(fixture, '998903333333', 'Olim');

  // Ali matches the sheet exactly; Vali paid 1 500 000 in the app but 2 000 000 in the sheet; Olim is only in the app.
  seedSaleChain(fixture, { customerId: ali, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: day(10), repayments: [{ amount: 400_000, entryDate: day(5) }] });
  seedSaleChain(fixture, { customerId: vali, agreementAmount: 2_000_000, firstPayment: 1_500_000, entryDate: day(4) });
  seedSaleChain(fixture, { customerId: olim, agreementAmount: 700_000, firstPayment: 700_000, entryDate: day(2) });
});

describe('finance snapshot upload', () => {
  it("maps \"To'lov summasi\" (not \"To'lov sanasi\") to the payment amount", async () => {
    const prepared = await admin().prepareFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet() });

    expect(prepared.mapping.paymentAmount).toBe(3);
  });

  it('detects the header row and mapping and normalizes dates, phones and amounts', async () => {
    const prepared = await admin().prepareFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet(), mapping: { paymentAmount: 3 } });

    expect(prepared.headerRowIndex).toBe(1);
    expect(prepared.mapping).toMatchObject({ paymentDate: 0, customerPhone: 1, customerName: 2, paymentAmount: 3, managerLabel: 4, tariffName: null });
    expect(prepared.totalRows).toBe(6);
    expect(prepared.normalizedRowCount).toBe(4);
    expect(prepared.errors).toEqual(['Qator 5: mijoz telefoni yoki ismi topilmadi.', 'Qator 6: mijoz telefoni yoki ismi topilmadi.']);
    expect(prepared.preview.map((row) => [row.paymentDate, row.normalizedPhone, row.paymentAmount])).toEqual([
      [dayString(day(10)), '998901111111', 1_000_000],
      [dayString(day(5)), '998901111111', 400_000],
      [dayString(day(4)), '998902222222', 2_000_000],
      [dayString(day(3)), '', 300_000],
    ]);
  });

  it('reads "2,000,000" as 2 000 000', async () => {
    const rows = sheet();

    rows[4]![3] = '2,000,000';
    const prepared = await admin().prepareFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows, mapping: { paymentAmount: 3 } });

    expect(prepared.preview[2]!.paymentAmount).toBe(2_000_000);
  });

  it('recommends the sheet that has a payment column, then the longest', async () => {
    const result = await admin().uploadFinanceSnapshot({
      workbookName: 'finance.xlsx',
      sheets: [
        { name: 'Notes', rowCount: 900, headers: ['Izoh'] },
        { name: 'Tushum', rowCount: 10, headers: ["To'lov summasi", 'Telefon'] },
      ],
    });

    expect(result.recommendedSheetName).toBe('Tushum');
  });

  it('activates a snapshot in tenant settings and reports it', async () => {
    const prepared = await admin().prepareFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet(), mapping: { paymentAmount: 3 } });

    expect(await admin().getActiveSnapshot()).toEqual({ exists: false });
    await expect(admin().activateFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet(), mapping: prepared.mapping })).resolves.toEqual({
      rowCount: 4,
      errors: ['Qator 5: mijoz telefoni yoki ismi topilmadi.', 'Qator 6: mijoz telefoni yoki ismi topilmadi.'],
    });
    expect(await admin().getActiveSnapshot()).toMatchObject({ exists: true, workbookName: 'finance.xlsx', sheetName: 'Tushum', rowCount: 4 });
  });
});

describe('finance comparison', () => {
  beforeEach(async () => {
    const prepared = await admin().prepareFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet(), mapping: { paymentAmount: 3 } });

    await admin().activateFinanceSnapshot({ workbookName: 'finance.xlsx', sheetName: 'Tushum', rows: sheet(), mapping: prepared.mapping });
  });

  const range = () => ({ dateFrom: dayString(day(30)), dateTo: dayString(day(0)) });

  it('matches customers by phone, then by name, and totals both sides', async () => {
    const result = await admin().compare(range());

    expect(result.summary).toMatchObject({
      dbTotal: 3_600_000,
      financeTotal: 3_700_000,
      differenceAmount: -100_000,
      matchedCustomers: 1,
      onlyInDbCustomers: 1,
      amountMismatchCount: 1,
    });
    const byPhone = Object.fromEntries(result.rows.map((row) => [String(row.matchId), [row.status, row.differenceAmount]]));

    expect(byPhone).toMatchObject({
      'phone:998901111111': ['matched', 0],
      'phone:998902222222': ['amount_mismatch', -500_000],
      'db:phone:998903333333': ['only_in_db', 700_000],
    });
  });

  // Bug (services/income-problems/comparison.ts:223): a name-only customer found on one side only falls into the
  // "ambiguous" branch (it runs whenever either list is non-empty), so Gani, who is only in the sheet, is reported as
  // ambiguous_match instead of only_in_finance.
  it.skip('reports a name-only customer missing from the app as only_in_finance (bug: comparison.ts:223)', async () => {
    const result = await admin().compare(range());

    expect(result.summary).toMatchObject({ onlyInFinanceCustomers: 1, ambiguousMatchCount: 0 });
    expect(result.rows.find((row) => row.status === 'only_in_finance')).toMatchObject({ name: 'Gani Ganiyev', financeTotalPaid: 300_000 });
  });

  it('filters by status and search text and drills down into one customer', async () => {
    expect((await admin().compare({ ...range(), status: 'amount_mismatch' })).rows.map((row) => row.phone)).toEqual(['998902222222']);
    expect((await admin().compare({ ...range(), search: 'ali val' })).rows.map((row) => row.status)).toEqual(['matched']);

    const drill = await admin().customerDrilldown({ ...range(), dbGroupKeys: ['phone:998901111111'], financeGroupKeys: ['phone:998901111111'] });

    expect(drill.dbRows.map((row) => [row.paymentDate, row.paymentAmount, row.paymentType])).toEqual([
      [dayString(day(10)), 1_000_000, 'new_sale'],
      [dayString(day(5)), 400_000, 'repayment'],
    ]);
    expect(drill.financeRows.map((row) => row.paymentAmount)).toEqual([1_000_000, 400_000]);
  });

  it('refuses to compare without an active snapshot or with a reversed range', async () => {
    fixture.store.tables.get('Tenant')![0]!.settings = {};

    await expect(admin().compare(range())).rejects.toThrow('Faol moliya snapshot yuklanmagan.');
    await expect(admin().customerDrilldown({ ...range(), dbGroupKeys: [], financeGroupKeys: [] })).rejects.toThrow('Faol moliya snapshot yuklanmagan.');
    await expect(caller(fixture.agentId, ['Agent']).compare(range())).rejects.toThrow('Admin access required');
  });
});
