import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, dayString, daysAgo, type MoneyFixture, seedCustomer, seedSaleChain } from '../../../../__tests__/helpers/money-fixtures';
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
let ids: {
  onlineAdmin: string;
  onlineLeader: string;
  onlineAgent: string;
  offlineLeader: string;
  offlineAgent: string;
  onlineCustomer: string;
  offlineCustomer: string;
  onlineSale: string;
  offlineSale: string;
  onlineCourse: string;
  onlineTariff: string;
};

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const asOnlineAdmin = () => caller(ids.onlineAdmin, ['OnlineAdmin']);
const asOnlineLeader = () => caller(ids.onlineLeader, ['OnlineTeamLeader']);
const asOfflineLeader = () => caller(ids.offlineLeader, ['OfflineTeamLeader']);

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  const user = (name: string, roles: string[]) => String(fixture.store.seed('User', [{ tenantId: fixture.tenantId, name, username: name.toLowerCase(), roles, authProvider: 'email' }])[0]!.id);
  const onlineAdmin = user('Olim', ['OnlineAdmin']);
  const onlineLeader = user('Lola', ['OnlineTeamLeader']);
  const onlineAgent = user('Nilufar', ['OnlineAgent']);
  const offlineLeader = user('Sardor', ['OfflineTeamLeader']);
  const offlineAgent = user('Jasur', ['OfflineAgent']);
  const [onlineCourse] = fixture.store.seed('Course', [{ tenantId: fixture.tenantId, name: 'Online English', category: 'online' }]);
  const [onlineTariff] = fixture.store.seed('Tariff', [{ tenantId: fixture.tenantId, courseId: onlineCourse!.id, name: 'Online Standard' }]);
  const onlineCustomer = seedCustomer(fixture, '998901110000', 'Online mijoz');
  const offlineCustomer = seedCustomer(fixture, '998902220000', 'Offline mijoz');
  const { saleId: onlineSale } = seedSaleChain(fixture, {
    customerId: onlineCustomer,
    managerUserId: onlineAgent,
    agreementAmount: 2_000_000,
    firstPayment: 500_000,
    entryDate: daysAgo(10),
    courseId: String(onlineCourse!.id),
    tariffId: String(onlineTariff!.id),
  });
  const { saleId: offlineSale } = seedSaleChain(fixture, {
    customerId: offlineCustomer,
    managerUserId: offlineAgent,
    agreementAmount: 3_000_000,
    firstPayment: 1_000_000,
    entryDate: daysAgo(10),
  });

  ids = {
    onlineAdmin,
    onlineLeader,
    onlineAgent,
    offlineLeader,
    offlineAgent,
    onlineCustomer,
    offlineCustomer,
    onlineSale,
    offlineSale,
    onlineCourse: String(onlineCourse!.id),
    onlineTariff: String(onlineTariff!.id),
  };
});

describe('group data scope: reads', () => {
  it('shows team leaders and OnlineAdmin only their group, agents only themselves, Manager everything', async () => {
    const incomeIds = async (roles: JWTPayload['roles'], userId: string) => (await caller(userId, roles).listIncomes()).map((row) => row.id).sort();

    expect(await incomeIds(['OnlineTeamLeader'], ids.onlineLeader)).toEqual([ids.onlineSale]);
    expect(await incomeIds(['OnlineAdmin'], ids.onlineAdmin)).toEqual([ids.onlineSale]);
    expect(await incomeIds(['OfflineTeamLeader'], ids.offlineLeader)).toEqual([ids.offlineSale]);
    expect(await incomeIds(['OfflineAgent'], ids.offlineAgent)).toEqual([ids.offlineSale]);
    expect(await incomeIds(['Manager'], fixture.managerId)).toEqual([ids.onlineSale, ids.offlineSale].sort());
  });

  it('limits the customer list to customers with an income by the group', async () => {
    const customers = await asOnlineLeader().listCustomers();

    expect(customers.customers.map((customer) => customer.id)).toEqual([ids.onlineCustomer]);
  });

  it('offers team leaders only themselves in the manager picker but OnlineAdmin the whole online group', async () => {
    const leaderManagers = (await asOnlineLeader().formOptions()).managers.map((manager) => manager.id);
    const adminManagers = (await asOnlineAdmin().formOptions()).managers.map((manager) => manager.id).sort();

    expect(leaderManagers).toEqual([ids.onlineLeader]);
    expect(adminManagers).toEqual([ids.onlineAdmin, ids.onlineLeader, ids.onlineAgent].sort());
  });
});

describe('group data scope: writes', () => {
  const sale = (managerUserId: string) => ({
    type: 'new_sale' as const,
    entryDate: dayString(daysAgo(2)),
    managerUserId,
    customerNumber: '998903330000',
    customerName: 'Yangi',
    courseId: ids.onlineCourse,
    tariffId: ids.onlineTariff,
    coursePriceAmount: 1_000_000,
    paymentAmount: 200_000,
  });

  it('lets team leaders record income only for themselves', async () => {
    await expect(asOnlineLeader().createIncome(sale(ids.onlineAgent))).rejects.toThrow('You can create income records only for yourself.');
    const result = await asOnlineLeader().createIncome(sale(ids.onlineLeader));

    expect(result.income.managerUserId).toBe(ids.onlineLeader);
  });

  it('lets OnlineAdmin record income for the online group only', async () => {
    const result = await asOnlineAdmin().createIncome(sale(ids.onlineAgent));

    expect(result.income.managerUserId).toBe(ids.onlineAgent);
    await expect(asOnlineAdmin().createIncome({ ...sale(ids.offlineAgent), customerNumber: '998904440000' })).rejects.toThrow(
      'You can create income records only for users in your group.',
    );
  });

  it('lets team leaders request adjustments only on their own incomes; OnlineAdmin on the group', async () => {
    const request = { type: 'refund' as const, incomeId: ids.onlineSale, refundCardNumber: '8600123412341234' };

    await expect(asOnlineLeader().createAdjustmentRequest(request)).rejects.toThrow('Selected income was not found.');
    await expect(asOnlineAdmin().createAdjustmentRequest({ ...request, incomeId: ids.offlineSale })).rejects.toThrow('Selected income was not found.');
    expect(await asOnlineAdmin().createAdjustmentRequest(request)).toMatchObject({ type: 'refund', status: 'pending' });
  });

  it('removes team leaders from approvers and lets OnlineAdmin review only online-group requests', async () => {
    const onlineRequest = await caller(ids.onlineAgent, ['OnlineAgent']).createAdjustmentRequest({
      type: 'tariff_change', incomeId: ids.onlineSale, newCourseId: ids.onlineCourse, newTariffId: ids.onlineTariff, newAgreementAmount: 2_500_000,
    });
    const offlineRequest = await caller(ids.offlineAgent, ['OfflineAgent']).createAdjustmentRequest({
      type: 'tariff_change', incomeId: ids.offlineSale, newCourseId: fixture.otherCourseId, newTariffId: fixture.otherTariffId, newAgreementAmount: 4_000_000,
    });

    await expect(caller(ids.offlineLeader, ['TeamLeader']).approveAdjustmentRequest({ requestId: offlineRequest.id })).rejects.toThrow(
      'Admin, Manager, Tashkiliy, or Organizator role is required to approve tariff changes.',
    );
    await expect(asOfflineLeader().rejectAdjustmentRequest({ requestId: offlineRequest.id })).rejects.toThrow(
      'Admin, Manager, Tashkiliy, or Organizator role is required to reject tariff changes.',
    );
    await expect(asOnlineAdmin().approveAdjustmentRequest({ requestId: offlineRequest.id })).rejects.toThrow('Bu yozuv sizning guruhingizga tegishli emas.');
    await expect(asOnlineAdmin().rejectAdjustmentRequest({ requestId: offlineRequest.id })).rejects.toThrow('Bu yozuv sizning guruhingizga tegishli emas.');
    await asOnlineAdmin().approveAdjustmentRequest({ requestId: onlineRequest.id });

    expect(fixture.store.rows('IncomeAdjustmentRequest', { id: onlineRequest.id })[0]).toMatchObject({ status: 'approved' });
  });

  it('lets OnlineAdmin use admin income and customer edits only on the online group', async () => {
    await expect(asOnlineAdmin().updateIncome({ incomeId: ids.offlineSale, paymentAmount: 1_100_000 })).rejects.toThrow('Income entry not found.');
    await expect(asOnlineAdmin().updateIncome({ incomeId: ids.onlineSale, managerUserId: ids.offlineAgent })).rejects.toThrow(
      'Bu yozuv sizning guruhingizga tegishli emas.',
    );
    await expect(asOnlineAdmin().deleteIncome({ incomeId: ids.offlineSale })).rejects.toThrow('Income entry not found.');
    await expect(asOnlineAdmin().updateCustomerIdentity({ customerId: ids.offlineCustomer, customerNumber: '998902220000', name: 'X' })).rejects.toThrow(
      'Customer not found.',
    );
    await expect(asOnlineAdmin().updateCustomersCourseAssignment({ customerIds: [ids.onlineCustomer, ids.offlineCustomer], courseId: ids.onlineCourse })).rejects.toThrow(
      "Tanlangan mijozlarning ba'zilari sizning guruhingizga tegishli emas.",
    );
    expect(await asOnlineAdmin().updateCustomerIdentity({ customerId: ids.onlineCustomer, customerNumber: '998901110000', name: 'Yangi nom' })).toMatchObject({
      name: 'Yangi nom',
    });

    const exported = await asOnlineAdmin().exportIncomesByDateRange({ dateFrom: dayString(daysAgo(30)), dateTo: dayString(daysAgo(0)) });

    expect(exported.rows.map((row) => row.id)).toEqual([ids.onlineSale]);
    await expect(asOnlineLeader().deleteIncome({ incomeId: ids.onlineSale })).rejects.toThrow('Admin access required');
  });

  it('lets OnlineAdmin change only online courses, and team leaders no catalog at all', async () => {
    await expect(caller(ids.offlineLeader, ['TeamLeader']).createCourse({ name: 'X', category: 'offline' })).rejects.toThrow('Admin or Manager access required');
    await expect(asOnlineAdmin().createCourse({ name: 'Offline X', category: 'offline' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');
    await expect(asOnlineAdmin().createCourse({ name: 'Foundation English', category: 'online' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');
    await expect(asOnlineAdmin().updateCourse({ courseId: fixture.courseId, name: 'X' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');
    await expect(asOnlineAdmin().updateCourse({ courseId: ids.onlineCourse, category: 'offline' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');
    await expect(asOnlineAdmin().createTariff({ courseId: fixture.courseId, name: 'Y' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');
    await expect(asOnlineAdmin().updateTariff({ tariffId: fixture.tariffId, name: 'Y' })).rejects.toThrow('Faqat online kurslarni tahrirlash mumkin.');

    const created = await asOnlineAdmin().createCourse({ name: 'Online Speaking', category: 'online' });
    const tariff = await asOnlineAdmin().createTariff({ courseId: created.id, name: 'Basic' });
    const subTariff = await asOnlineAdmin().createSubTariff({ tariffId: tariff.id, name: 'Evening' });

    expect(await asOnlineAdmin().updateSubTariff({ subTariffId: subTariff.id, isActive: false })).toMatchObject({ isActive: false });
    expect(await asOnlineAdmin().updateTariff({ tariffId: ids.onlineTariff, name: 'Online Plus' })).toMatchObject({ name: 'Online Plus' });
  });
});

describe('group data scope: deleting customers', () => {
  it('lets OnlineAdmin delete an online-group customer together with its payments', async () => {
    await expect(asOnlineAdmin().deleteCustomers({ customerIds: [ids.onlineCustomer] }))
      .resolves.toEqual({ deletedCount: 1, deletedIds: [ids.onlineCustomer], deletedIncomeCount: 1, deletedRequestCount: 0 });
    expect(fixture.store.rows('Customer', { id: ids.onlineCustomer })).toEqual([]);
    expect(fixture.store.rows('Income').map((row) => row.id)).toEqual([ids.offlineSale]);
  });

  it('ignores a customer outside the online group, as if it did not exist', async () => {
    await expect(asOnlineAdmin().deleteCustomers({ customerIds: [ids.offlineCustomer] }))
      .resolves.toEqual({ deletedCount: 0, deletedIds: [], deletedIncomeCount: 0, deletedRequestCount: 0 });
    expect(fixture.store.rows('Customer', { id: ids.offlineCustomer })).toHaveLength(1);
    expect(fixture.store.rows('Income', { id: ids.offlineSale })).toHaveLength(1);
  });

  it('refuses the whole delete for OnlineAdmin when a selected customer also has incomes outside the group', async () => {
    const mixed = seedSaleChain(fixture, { customerId: ids.onlineCustomer, managerUserId: ids.offlineAgent, agreementAmount: 1_000_000, firstPayment: 200_000, entryDate: daysAgo(3) });
    const incomesBefore = fixture.store.rows('Income').length;

    await expect(asOnlineAdmin().deleteCustomers({ customerIds: [ids.onlineCustomer] }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: "Tanlangan mijozlarning ba'zilari sizning guruhingizga tegishli emas." });
    expect(fixture.store.rows('Customer')).toHaveLength(2);
    expect(fixture.store.rows('Income')).toHaveLength(incomesBefore);
    expect(fixture.store.rows('AuditLog', { action: 'customer_bulk_delete' })).toEqual([]);

    // An unscoped admin is not limited by the group: the same customer goes with all its incomes.
    await expect(caller(fixture.adminId, ['Admin']).deleteCustomers({ customerIds: [ids.onlineCustomer] }))
      .resolves.toMatchObject({ deletedCount: 1, deletedIncomeCount: 2 });
    expect(fixture.store.rows('Income', { id: mixed.saleId })).toEqual([]);
  });
});
