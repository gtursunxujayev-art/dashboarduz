import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

const previousToken = process.env.TELEGRAM_BOT_TOKEN;

beforeAll(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

afterAll(() => {
  if (previousToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = previousToken;
});

let fixture: MoneyFixture;
let customerId: string;
let target: { saleId: string; repaymentIds: string[] };
let source: { saleId: string; repaymentIds: string[] };

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const income = (id: string) => fixture.store.rows('Income', { id })[0]!;

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  customerId = seedCustomer(fixture, '998945554433', 'Nodira');
  // Target: a 5 000 000 IELTS sale, 1 000 000 paid. Source: a later 3 000 000 sale, 1 000 000 + 500 000 paid.
  target = seedSaleChain(fixture, { customerId, agreementAmount: 5_000_000, firstPayment: 1_000_000, entryDate: daysAgo(30), courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
  source = seedSaleChain(fixture, { customerId, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(20), repayments: [{ amount: 500_000, entryDate: daysAgo(10) }] });
});

describe('deleteCustomerCourse', () => {
  it('deletes the whole sale chain and refreshes the customer profile', async () => {
    const result = await admin().deleteCustomerCourse({ saleIncomeId: source.saleId });

    expect(result).toEqual({ success: true, deletedCount: 2, relinkedCount: 0, mode: 'delete', targetSaleIncomeId: null, refundRequestId: null });
    expect(fixture.store.rows('Income').map((row) => row.id)).toEqual([target.saleId]);
    expect(fixture.store.rows('Customer')[0]).toMatchObject({ profileCourseId: fixture.otherCourseId, profileTariffId: fixture.otherTariffId });
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'customer_course_delete', metadata: { transferAmount: 1_500_000, deletedCount: 2 } });
  });

  it('turns the course into a refund request for everything paid on it', async () => {
    const result = await admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'refund' });

    expect(result).toMatchObject({ mode: 'refund', deletedCount: 0 });
    expect(fixture.store.rows('IncomeAdjustmentRequest')[0]).toMatchObject({
      id: result.refundRequestId,
      type: 'refund',
      status: 'pending',
      incomeId: source.saleId,
      requestedAmount: 1_500_000,
      reason: "Mijoz kursini o'chirish oynasidan refund yaratildi.",
    });
    expect([income(source.saleId).lifecycleStatus, income(source.repaymentIds[0]!).lifecycleStatus]).toEqual(['pending_refund', 'pending_refund']);
    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId })).rejects.toThrow("O'chiriladigan aktiv kurs topilmadi.");
  });

  it('moves the payments onto another course of the customer as repayments', async () => {
    const result = await admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink', targetSaleIncomeId: target.saleId });

    expect(result).toMatchObject({ mode: 'relink', relinkedCount: 2, targetSaleIncomeId: target.saleId });
    expect(income(target.saleId)).toMatchObject({ type: 'new_sale', coursePriceAmount: 5_000_000, remainingDebtAmount: 2_500_000 });
    expect(income(source.saleId)).toMatchObject({ type: 'repayment', relatedDebtIncomeId: target.saleId, courseId: fixture.otherCourseId, coursePriceAmount: null, debtAmount: 4_000_000, remainingDebtAmount: 3_000_000, legacyImportMeta: null });
    expect(income(source.repaymentIds[0]!)).toMatchObject({ relatedDebtIncomeId: target.saleId, debtAmount: 3_000_000, remainingDebtAmount: 2_500_000 });
  });

  it('refuses a relink above the target debt, onto itself or without a target', async () => {
    fixture.store.tables.get('Income')!.forEach((row) => {
      if (row.id === target.saleId) {
        row.paymentAmount = 4_000_000;
        row.remainingDebtAmount = 1_000_000;
      }
    });

    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink', targetSaleIncomeId: target.saleId })).rejects.toThrow(
      "Summalar juda katta: o'tkaziladigan to'lov (1 500 000 so'm) maqsad kurs qarzidan (1 000 000 so'm) katta.",
    );
    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink', targetSaleIncomeId: source.saleId })).rejects.toThrow("Daromadni aynan shu kursga o'tkazib bo'lmaydi.");
    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink' })).rejects.toThrow("Daromadni o'tkazish uchun maqsad kurs tanlanishi shart.");
    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId, action: 'relink', targetSaleIncomeId: '00000000-0000-4000-8000-000000000123' })).rejects.toThrow(
      'Daromadni ulash uchun tanlangan kurs topilmadi.',
    );
    expect(income(source.saleId).type).toBe('new_sale');
  });

  it('refuses a course with a pending request on any chain row', async () => {
    fixture.store.seed('IncomeAdjustmentRequest', [{ tenantId: fixture.tenantId, type: 'tariff_change', incomeId: source.saleId, customerId, requestedByUserId: fixture.agentId }]);

    await expect(admin().deleteCustomerCourse({ saleIncomeId: source.saleId })).rejects.toThrow("Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang.");
    await expect(caller(fixture.agentId, ['Agent']).deleteCustomerCourse({ saleIncomeId: source.saleId })).rejects.toThrow('Admin access required');
  });
});

describe('updateCustomerCourseSale', () => {
  it('moves the sale and its repayments to another course and picks the first active sub-tariff', async () => {
    // Seeded Morning first: the pick is by name, so Evening wins.
    const [, evening] = fixture.store.seed('SubTariff', [
      { tenantId: fixture.tenantId, tariffId: fixture.otherTariffId, name: 'Morning' },
      { tenantId: fixture.tenantId, tariffId: fixture.otherTariffId, name: 'Evening' },
    ]);

    await expect(admin().updateCustomerCourseSale({ saleIncomeId: source.saleId, newCourseId: fixture.otherCourseId, newTariffId: fixture.otherTariffId })).resolves.toEqual({ success: true });

    expect(income(source.saleId)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId, legacyImportMeta: { saleSubTariffId: evening!.id }, remainingDebtAmount: 1_500_000 });
    expect(income(source.repaymentIds[0]!)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
    expect(fixture.store.rows('AuditLog')[0]).toMatchObject({ action: 'customer_course_sale_update', metadata: { newSubTariffId: evening!.id } });
  });

  it('clears the tariff and sub-tariff when only a course is given', async () => {
    await admin().updateCustomerCourseSale({ saleIncomeId: source.saleId, newCourseId: fixture.otherCourseId });

    expect(income(source.saleId)).toMatchObject({ courseId: fixture.otherCourseId, tariffId: null, legacyImportMeta: null });
  });

  it.each([
    ['a sub-tariff without a tariff', () => ({ newSubTariffId: '00000000-0000-4000-8000-000000000001' }), "Tarif tanlanmasdan subtarif tanlab bo'lmaydi."],
    ['an unknown course', () => ({ newCourseId: '00000000-0000-4000-8000-000000000002' }), 'Yangi kurs topilmadi yoki faol emas.'],
    ['a tariff of another course', () => ({ newTariffId: fixture.tariffId }), 'Yangi tarif tanlangan kursga tegishli emas yoki faol emas.'],
    ['a foreign sub-tariff', () => ({ newTariffId: fixture.otherTariffId, newSubTariffId: '00000000-0000-4000-8000-000000000003' }), 'Yangi subtarif tanlangan tarifga tegishli emas yoki faol emas.'],
  ])('refuses %s', async (_label, overrides, message) => {
    await expect(admin().updateCustomerCourseSale({ saleIncomeId: source.saleId, newCourseId: fixture.otherCourseId, ...overrides() })).rejects.toThrow(message);
    expect(income(source.saleId).courseId).toBe(fixture.courseId);
  });

  it('refuses a sale that is not active', async () => {
    await expect(admin().updateCustomerCourseSale({ saleIncomeId: source.repaymentIds[0]!, newCourseId: fixture.otherCourseId })).rejects.toThrow('Tahrirlanadigan aktiv kurs topilmadi.');
  });
});
