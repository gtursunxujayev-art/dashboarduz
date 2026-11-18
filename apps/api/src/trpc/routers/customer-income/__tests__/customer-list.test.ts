import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;
let ali: string;
let vali: string;
let gani: string;
let morningId: string;

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const byName = <T extends { name: string }>(rows: T[]) => Object.fromEntries(rows.map((row) => [row.name, row]));

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  morningId = String(fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning' }])[0]!.id);
  ali = seedCustomer(fixture, '998901111111', 'Ali');
  vali = seedCustomer(fixture, '998902222222', 'Vali');
  gani = seedCustomer(fixture, '998903333333', 'Gani');
  // Ali owes 1 500 000 on English (Morning) and nothing on a technical sale; Vali paid IELTS in full; Gani has no sales.
  const aliChain = seedSaleChain(fixture, { customerId: ali, agreementAmount: 3_000_000, firstPayment: 1_000_000, entryDate: daysAgo(20), repayments: [{ amount: 500_000, entryDate: daysAgo(4) }] });

  seedSaleChain(fixture, { customerId: ali, agreementAmount: 1, firstPayment: 0, entryDate: daysAgo(15) });
  seedSaleChain(fixture, { customerId: vali, managerUserId: fixture.otherAgentId, agreementAmount: 2_000_000, firstPayment: 2_000_000, entryDate: daysAgo(6), courseId: fixture.otherCourseId, tariffId: fixture.otherTariffId });
  fixture.store.tables.get('Income')!.forEach((row) => {
    if (row.id === aliChain.saleId) row.legacyImportMeta = { saleSubTariffId: morningId };
  });
  fixture.store.tables.get('Customer')!.forEach((customer) => {
    if (customer.id === vali) {
      customer.profileCourseId = fixture.otherCourseId;
      customer.profileTariffId = fixture.otherTariffId;
    }
  });
});

describe('listCustomers', () => {
  it('aggregates paid and owed amounts per customer, skipping technical sales', async () => {
    const result = await admin().listCustomers();
    const rows = byName(result.customers);

    expect(result.summaryCounts).toEqual({ totalCustomers: 3, withDebtCustomers: 1, withoutDebtCustomers: 2 });
    expect(rows.Ali).toMatchObject({ totalDebtAmount: 1_500_000, totalPaidAmount: 1_500_000, hasDebt: true, responsibleManagerLabel: 'Aziz' });
    expect(rows.Ali!.courseEntries.map((entry) => [entry.label, entry.remainingDebtAmount])).toEqual([
      ['Foundation English / Standard', 1],
      ['Foundation English / Standard / Morning', 1_500_000],
    ]);
    expect(rows.Vali).toMatchObject({ totalDebtAmount: 0, totalPaidAmount: 2_000_000, hasDebt: false, profileCourseName: 'IELTS Intensive', profileTariffName: 'VIP', courses: ['IELTS Intensive / VIP'] });
    expect(rows.Gani).toMatchObject({ id: gani, totalDebtAmount: 0, hasDebt: false, courseEntries: [], lastActivityAt: null });
    expect(result.courseOptions.map((course) => course.name)).toEqual(['Foundation English', 'IELTS Intensive']);
  });

  it('filters by debt, course, sub-tariff and text, and limits after filtering', async () => {
    expect((await admin().listCustomers({ debtFilter: 'with_debt' })).customers.map((customer) => customer.name)).toEqual(['Ali']);
    expect((await admin().listCustomers({ debtFilter: 'without_debt' })).customers.map((customer) => customer.name).sort()).toEqual(['Gani', 'Vali']);
    expect((await admin().listCustomers({ debtFilter: 'all', courseId: fixture.otherCourseId })).customers.map((customer) => customer.name)).toEqual(['Vali']);
    expect((await admin().listCustomers({ debtFilter: 'all', subTariffId: morningId })).customers.map((customer) => customer.name)).toEqual(['Ali']);
    expect((await admin().listCustomers({ debtFilter: 'all', query: '33333' })).customers.map((customer) => customer.name)).toEqual(['Gani']);
    const limited = await admin().listCustomers({ debtFilter: 'without_debt', limit: 1 });

    expect(limited.customers).toHaveLength(1);
    expect(limited.summaryCounts.totalCustomers).toBe(2);
  });

  it('shows an agent only customers they sold to', async () => {
    const result = await caller(fixture.otherAgentId, ['Agent']).listCustomers();

    expect(result.customers.map((customer) => customer.name)).toEqual(['Vali']);
    expect(result.summaryCounts).toEqual({ totalCustomers: 1, withDebtCustomers: 0, withoutDebtCustomers: 1 });
  });

  it('returns empty counts when nothing matches', async () => {
    const result = await admin().listCustomers({ debtFilter: 'all', query: 'nobody' });

    expect(result.customers).toEqual([]);
    expect(result.summaryCounts).toEqual({ totalCustomers: 0, withDebtCustomers: 0, withoutDebtCustomers: 0 });
  });
});
