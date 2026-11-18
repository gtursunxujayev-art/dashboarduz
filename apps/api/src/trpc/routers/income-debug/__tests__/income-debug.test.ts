import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { incomeDebugRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;
let customerId: string;

const caller = (userId: string, roles: JWTPayload['roles']) => incomeDebugRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const income = (id: string) => fixture.store.rows('Income', { id })[0]!;
const setIncome = (id: string, patch: Record<string, unknown>) => {
  fixture.store.tables.get('Income')!.forEach((row) => {
    if (row.id === id) Object.assign(row, patch);
  });
};

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  customerId = seedCustomer(fixture, '998977770000', 'Sardor');
});

describe('integrity report and chain repair', () => {
  it('reports only broken chains', async () => {
    seedSaleChain(fixture, { customerId, agreementAmount: 2_000_000, firstPayment: 1_000_000, entryDate: daysAgo(40) });
    const broken = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(30), repayments: [{ amount: 500_000, entryDate: daysAgo(20) }] });

    setIncome(broken.saleId, { remainingDebtAmount: 2_000_000 });
    setIncome(broken.repaymentIds[0]!, { debtAmount: 9_999 });

    const report = await admin().integrityReport({ limit: 100, onlyMismatches: true });

    expect(report).toMatchObject({ scannedCount: 2, mismatchCount: 1, okCount: 1 });
    expect(report.rows).toEqual([expect.objectContaining({
      saleIncomeId: broken.saleId,
      storedDebt: 2_000_000,
      expectedDebt: 1_500_000,
      expectedPaid: 1_500_000,
      agreementAmount: 3_000_000,
      mismatchReasons: ['repayment_debt_amount_mismatch', 'sale_remaining_mismatch'],
    })]);
    expect((await admin().integrityReport({ limit: 100, onlyMismatches: false })).rows).toHaveLength(2);
  });

  it('repairs a sale without repayments and skips consistent chains', async () => {
    const good = seedSaleChain(fixture, { customerId, agreementAmount: 2_000_000, firstPayment: 1_000_000, entryDate: daysAgo(40) });
    const broken = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(30) });

    setIncome(broken.saleId, { remainingDebtAmount: 123, debtAmount: 5 });
    const repair = await admin().repairAllActiveChains({ limit: 100 });

    expect(repair).toMatchObject({ scannedCount: 2, fixedCount: 1, failedCount: 0, skippedCount: 1 });
    expect(repair.results.find((row) => row.saleIncomeId === broken.saleId)).toMatchObject({
      status: 'fixed',
      didReorder: false,
      reason: 'Chain qarzi qayta hisoblandi. (sale_debt_amount_mismatch, sale_remaining_mismatch)',
    });
    expect(income(broken.saleId)).toMatchObject({ debtAmount: 3_000_000, remainingDebtAmount: 2_000_000 });
    expect(income(good.saleId).remainingDebtAmount).toBe(1_000_000);
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_debug_repair_all_active_chains', metadata: { fixedCount: 1, skippedCount: 1 } });
  });

  it('recomputes the debt before and after every repayment of a chain', async () => {
    const chain = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(30), repayments: [{ amount: 500_000, entryDate: daysAgo(20) }] });

    setIncome(chain.repaymentIds[0]!, { debtAmount: 9_999 });
    await admin().repairAllActiveChains({ limit: 100 });

    // The sale row itself is left at its first-payment debt: see the skipped test below.
    expect(income(chain.repaymentIds[0]!)).toMatchObject({ debtAmount: 2_000_000, remainingDebtAmount: 1_500_000 });
  });

  // Bug (services/income-debug/chain-recompute.ts:118-130): recomputeSaleChainState writes the sale's
  // remainingDebtAmount right after its first payment and never updates it after the repayment loop (136-152), but a
  // sale stores the debt of the whole chain. Every chain with repayments stays inconsistent after repairAllActiveChains
  // ("failed"), repairDatesFromSnapshot and destructiveRelinkCourseChain.
  it.skip('repair leaves the sale with the debt of the whole chain (bug: chain-recompute.ts:118-130)', async () => {
    const chain = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10), repayments: [{ amount: 400_000, entryDate: daysAgo(5) }] });

    setIncome(chain.repaymentIds[0]!, { entryDate: daysAgo(15) });
    const repair = await admin().repairAllActiveChains({ limit: 10 });

    expect(repair.results[0]).toMatchObject({ status: 'fixed', didReorder: true, canonicalSaleId: chain.repaymentIds[0] });
    expect(income(chain.repaymentIds[0]!)).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, coursePriceAmount: 3_000_000, remainingDebtAmount: 1_600_000 });
    expect(income(chain.saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: chain.repaymentIds[0], debtAmount: 2_600_000, remainingDebtAmount: 1_600_000 });
  });

  it('repair makes a repayment dated strictly before its sale the new sale of the chain', async () => {
    const chain = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10), repayments: [{ amount: 400_000, entryDate: daysAgo(5) }] });

    setIncome(chain.repaymentIds[0]!, { entryDate: daysAgo(15) });
    const repair = await admin().repairAllActiveChains({ limit: 10 });

    expect(repair.results[0]).toMatchObject({ canonicalSaleId: chain.repaymentIds[0], didReorder: true });
    expect(income(chain.repaymentIds[0]!)).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, coursePriceAmount: 3_000_000, debtAmount: 3_000_000 });
    expect(income(chain.saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: chain.repaymentIds[0], coursePriceAmount: null, debtAmount: 2_600_000, remainingDebtAmount: 1_600_000 });
  });

  // Bug (services/income-debug/chain-recompute.ts:108-140): with canonicalRule 'earlier-repayment-only' the sale is
  // kept when a repayment shares its entry date but was created earlier, yet the opening payment is taken from that
  // repayment and `chain.slice(1)` then rewrites the sale itself as a 'repayment' linked to its own id.
  it.skip('keeps the sale when a repayment has the same entry date but an earlier createdAt (bug: chain-recompute.ts:108-140)', async () => {
    const date = daysAgo(10);
    const chain = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: date, repayments: [{ amount: 400_000, entryDate: daysAgo(5) }] });

    setIncome(chain.repaymentIds[0]!, { entryDate: date, createdAt: new Date(date.getTime() - 60_000), remainingDebtAmount: 0 });
    await admin().repairAllActiveChains({ limit: 10 });

    expect(income(chain.saleId)).toMatchObject({ type: 'new_sale', relatedDebtIncomeId: null, remainingDebtAmount: 1_600_000 });
  });
});

describe('debug list and hiding', () => {
  it('classifies incomes by how they were created and hides selected rows', async () => {
    const manual = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });
    const unresolved = seedSaleChain(fixture, { customerId, agreementAmount: 2_000_000, firstPayment: 500_000, entryDate: daysAgo(8) });
    const imported = seedSaleChain(fixture, { customerId, agreementAmount: 500_000, firstPayment: 500_000, entryDate: daysAgo(6) });

    setIncome(imported.saleId, { legacyImportSource: 'excel' });
    fixture.store.seed('AuditLog', [{ tenantId: fixture.tenantId, userId: fixture.agentId, action: 'income_create', resource: 'income', resourceId: manual.saleId }]);

    const all = await admin().list({ mode: 'all', limit: 50 });
    const statusById = Object.fromEntries(all.rows.map((row) => [row.id, [row.status, row.createdByLabel]]));

    expect(statusById).toEqual({
      [manual.saleId]: ['normal', 'Aziz'],
      [unresolved.saleId]: ['unresolved', "qo'lda"],
      [imported.saleId]: ['imported', 'import'],
    });
    expect(all.summary).toMatchObject({ inspectedCount: 3, importedCount: 1, unresolvedCount: 1, futureCount: 0, hiddenCount: 0 });
    expect((await admin().list({ mode: 'suspicious', limit: 50 })).rows.map((row) => row.id).sort()).toEqual([imported.saleId, unresolved.saleId].sort());

    await expect(admin().hideSelected({ incomeIds: [unresolved.saleId], hidden: true })).resolves.toEqual({ success: true, updatedCount: 1 });
    expect(income(unresolved.saleId).legacyImportMeta).toEqual({ debugHidden: true });
    expect((await admin().list({ mode: 'hidden', limit: 50 })).rows.map((row) => row.id)).toEqual([unresolved.saleId]);
    expect((await admin().list({ mode: 'unresolved', limit: 50 })).rows).toEqual([]);
    expect((await admin().list({ mode: 'imported', limit: 50 })).rows.map((row) => row.id)).toEqual([imported.saleId]);
    await expect(caller(fixture.agentId, ['Agent']).list()).rejects.toThrow('Admin access required');
  });

  it('finds incomes by customer number', async () => {
    const other = seedCustomer(fixture, '998911112222', 'Other');
    const mine = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    seedSaleChain(fixture, { customerId: other, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    expect((await admin().list({ mode: 'all', query: '7777', limit: 50 })).rows.map((row) => row.id)).toEqual([mine.saleId]);
  });

  // Bug (trpc/routers/income-debug/list.ts:26-33): the customer-number branch uses normalizeDigits(query), which is ''
  // for a name query, and `contains: ''` matches every customer, so a name search returns every income.
  it.skip('a name search returns only that customer (bug: list.ts:26-33)', async () => {
    const other = seedCustomer(fixture, '998911112222', 'Other');
    const mine = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    seedSaleChain(fixture, { customerId: other, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    expect((await admin().list({ mode: 'all', query: 'Sardor', limit: 50 })).rows.map((row) => row.id)).toEqual([mine.saleId]);
  });
});

describe('destructive relink', () => {
  it('recreates the source payments as repayments of the target and deletes the source chain', async () => {
    const target = seedSaleChain(fixture, { customerId, agreementAmount: 5_000_000, firstPayment: 1_000_000, entryDate: daysAgo(30) });
    const source = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 700_000, entryDate: daysAgo(20), repayments: [{ amount: 300_000, entryDate: daysAgo(10) }] });

    const result = await admin().destructiveRelinkCourseChain({ sourceSaleIncomeId: source.saleId, targetSaleIncomeId: target.saleId, note: 'merge' });

    expect(result).toEqual({ success: true, deletedCount: 2, createdRepaymentsCount: 2, transferAmount: 1_000_000, targetSaleIncomeId: target.saleId });
    expect(fixture.store.rows('Income', { id: { in: [source.saleId, ...source.repaymentIds] } })).toEqual([]);
    const repayments = fixture.store.rows('Income', { relatedDebtIncomeId: target.saleId });

    expect(repayments.map((row) => [row.paymentAmount, row.debtAmount, row.remainingDebtAmount])).toEqual([
      [700_000, 4_000_000, 3_300_000],
      [300_000, 3_300_000, 3_000_000],
    ]);
    // The target sale should now owe 3 000 000, but the final recompute leaves 4 000 000 (chain-recompute bug above).
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_debug_destructive_relink', metadata: { note: 'merge', transferAmount: 1_000_000 } });
  });

  it('refuses the same sale, different customers and transfers above the target debt', async () => {
    const otherCustomer = seedCustomer(fixture, '998911113333');
    const target = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 800_000, entryDate: daysAgo(30) });
    const source = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 700_000, entryDate: daysAgo(20) });
    const foreign = seedSaleChain(fixture, { customerId: otherCustomer, agreementAmount: 3_000_000, firstPayment: 100_000, entryDate: daysAgo(20) });

    await expect(admin().destructiveRelinkCourseChain({ sourceSaleIncomeId: source.saleId, targetSaleIncomeId: source.saleId })).rejects.toThrow("Manba va maqsad sotuv bir xil bo'lishi mumkin emas.");
    await expect(admin().destructiveRelinkCourseChain({ sourceSaleIncomeId: foreign.saleId, targetSaleIncomeId: target.saleId })).rejects.toThrow('Faqat bir xil mijoz kurslari orasida destructive relink mumkin.');
    await expect(admin().destructiveRelinkCourseChain({ sourceSaleIncomeId: source.saleId, targetSaleIncomeId: target.saleId })).rejects.toThrow("O'tkaziladigan summa maqsad kurs qarzidan katta.");
    await expect(admin().destructiveRelinkCourseChain({ sourceSaleIncomeId: source.saleId, targetSaleIncomeId: '00000000-0000-4000-8000-000000000001' })).rejects.toThrow(
      'Manba yoki maqsad aktiv yangi sotuv topilmadi.',
    );
    expect(income(source.saleId).type).toBe('new_sale');
  });
});

describe('repair dates from the finance snapshot', () => {
  const snapshotRow = (overrides: Record<string, unknown>) => ({
    rowIndex: 1,
    paymentDate: null,
    customerPhone: '998977770000',
    customerName: 'Sardor',
    telegramUsername: '',
    managerLabel: 'Aziz',
    courseName: 'Foundation English',
    tariffName: 'Standard',
    subTariffName: '',
    paymentType: '',
    agreementAmount: 0,
    paymentAmount: 0,
    remainingDebtAmount: 0,
    deadline: null,
    normalizedPhone: '998977770000',
    normalizedName: 'sardor',
    ...overrides,
  });

  it('moves an income to the snapshot date, skips unmatched and unchanged ones', async () => {
    const moved = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(10) });
    const same = seedSaleChain(fixture, { customerId, agreementAmount: 900_000, firstPayment: 900_000, entryDate: daysAgo(9) });
    const unmatched = seedSaleChain(fixture, { customerId, agreementAmount: 800_000, firstPayment: 800_000, entryDate: daysAgo(8) });
    const sameDay = dayString(new Date(daysAgo(9).getTime() + 5 * 60 * 60 * 1000));

    fixture.store.tables.get('Tenant')![0]!.settings = {
      incomeProblems: {
        activeSnapshot: {
          version: 1,
          workbookName: 'finance.xlsx',
          sheetName: 'Tushum',
          activatedAt: new Date().toISOString(),
          rowCount: 2,
          rows: [
            snapshotRow({ rowIndex: 1, paymentDate: dayString(daysAgo(12)), paymentAmount: 1_000_000, remainingDebtAmount: 2_000_000 }),
            snapshotRow({ rowIndex: 2, paymentDate: sameDay, paymentAmount: 900_000 }),
          ],
        },
      },
    };

    const result = await admin().repairDatesFromSnapshot({ incomeIds: [moved.saleId, same.saleId, unmatched.saleId] });

    expect(result).toMatchObject({ success: true, updatedCount: 1, skippedCount: 2 });
    expect(result.results.map((row) => [row.incomeId, row.status])).toEqual([
      [moved.saleId, 'updated'],
      [same.saleId, 'unchanged'],
      [unmatched.saleId, 'no_match'],
    ]);
    expect(dayString(income(moved.saleId).entryDate as Date)).toBe(dayString(daysAgo(12)));
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'income_debug_repair_dates_from_snapshot', metadata: { updatedCount: 1, workbookName: 'finance.xlsx' } });
  });

  it('refuses without an active snapshot', async () => {
    const chain = seedSaleChain(fixture, { customerId, agreementAmount: 1_000_000, firstPayment: 1_000_000, entryDate: daysAgo(3) });

    await expect(admin().repairDatesFromSnapshot({ incomeIds: [chain.saleId] })).rejects.toThrow(
      'Faol moliya snapshot topilmadi. Avval Tushum muammolari sahifasida snapshotni faollashtiring.',
    );
  });
});
