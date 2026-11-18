/**
 * Fixture builders on top of InMemoryPrisma for the money-path unit tests: one tenant with an Admin, a sales
 * Agent, a Finance user and a course with a tariff, plus helpers to seed sales and repayments and to build a tRPC
 * context. Amounts are whole so'm, as in the schema.
 */
import { randomUUID } from 'crypto';

import type { JWTPayload } from '@dashboarduz/shared';
import type { Request, Response } from 'express';

import type { Context } from '../../trpc/context';

import { InMemoryPrisma } from './in-memory-prisma';

export type MoneyFixture = {
  store: InMemoryPrisma;
  tenantId: string;
  adminId: string;
  agentId: string;
  otherAgentId: string;
  financeId: string;
  managerId: string;
  courseId: string;
  tariffId: string;
  otherCourseId: string;
  otherTariffId: string;
};

export function createMoneyFixture(): MoneyFixture {
  const store = new InMemoryPrisma();
  const [tenant] = store.seed('Tenant', [{ name: 'Test tenant' }]);
  const tenantId = String(tenant!.id);
  const user = (name: string, roles: string[]) => String(store.seed('User', [{ tenantId, name, username: name.toLowerCase(), roles, authProvider: 'email' }])[0]!.id);
  const adminId = user('Admin', ['Admin']);
  const agentId = user('Aziz', ['Agent']);
  const otherAgentId = user('Bobur', ['Agent']);
  const financeId = user('Feruza', ['Finance']);
  const managerId = user('Malika', ['Manager']);
  const [course, otherCourse] = store.seed('Course', [
    { tenantId, name: 'Foundation English', category: 'offline' },
    { tenantId, name: 'IELTS Intensive', category: 'intensive' },
  ]);
  const [tariff, otherTariff] = store.seed('Tariff', [
    { tenantId, courseId: course!.id, name: 'Standard' },
    { tenantId, courseId: otherCourse!.id, name: 'VIP' },
  ]);

  return {
    store,
    tenantId,
    adminId,
    agentId,
    otherAgentId,
    financeId,
    managerId,
    courseId: String(course!.id),
    tariffId: String(tariff!.id),
    otherCourseId: String(otherCourse!.id),
    otherTariffId: String(otherTariff!.id),
  };
}

export function seedCustomer(fixture: MoneyFixture, customerNumber: string, name = `Customer ${customerNumber}`): string {
  return String(fixture.store.seed('Customer', [{ tenantId: fixture.tenantId, customerNumber, name }])[0]!.id);
}

/**
 * Seeds a sale with consistent stored debts: `remainingDebtAmount` is the chain debt after the given repayments, as
 * the app keeps it. Returns the sale id and the repayment ids in order.
 */
export function seedSaleChain(fixture: MoneyFixture, params: {
  customerId: string;
  managerUserId?: string;
  agreementAmount: number;
  firstPayment: number;
  entryDate: Date;
  repayments?: Array<{ amount: number; entryDate: Date; managerUserId?: string }>;
  courseId?: string;
  tariffId?: string;
  lifecycleStatus?: string;
}): { saleId: string; repaymentIds: string[] } {
  const managerUserId = params.managerUserId ?? fixture.agentId;
  const courseId = params.courseId ?? fixture.courseId;
  const tariffId = params.tariffId ?? fixture.tariffId;
  const lifecycleStatus = params.lifecycleStatus ?? 'active';
  const saleId = randomUUID();
  let debt = Math.max(params.agreementAmount - params.firstPayment, 0);
  const repaymentRows = (params.repayments ?? []).map((repayment, index) => {
    const before = debt;

    debt = Math.max(before - repayment.amount, 0);

    return {
      id: randomUUID(),
      tenantId: fixture.tenantId,
      customerId: params.customerId,
      managerUserId: repayment.managerUserId ?? managerUserId,
      type: 'repayment',
      relatedDebtIncomeId: saleId,
      courseId,
      tariffId,
      entryDate: repayment.entryDate,
      createdAt: new Date(repayment.entryDate.getTime() + index + 1),
      debtAmount: before,
      paymentAmount: repayment.amount,
      remainingDebtAmount: debt,
      lifecycleStatus,
    };
  });

  fixture.store.seed('Income', [{
    id: saleId,
    tenantId: fixture.tenantId,
    customerId: params.customerId,
    managerUserId,
    type: 'new_sale',
    courseId,
    tariffId,
    entryDate: params.entryDate,
    createdAt: params.entryDate,
    coursePriceAmount: params.agreementAmount,
    debtAmount: params.agreementAmount,
    paymentAmount: params.firstPayment,
    remainingDebtAmount: debt,
    lifecycleStatus,
  }, ...repaymentRows]);

  return { saleId, repaymentIds: repaymentRows.map((row) => row.id) };
}

/** A tRPC context for `userId`, as createContext builds it from a verified JWT. */
export function contextFor(fixture: MoneyFixture, userId: string, roles: JWTPayload['roles']): Context {
  const user: JWTPayload = { userId, tenantId: fixture.tenantId, roles };

  return { req: {} as Request, res: {} as Response, user, tenantId: fixture.tenantId };
}

/** A date `days` days before now, at 10:00 UTC, so it is always in the past for "no future entries" checks. */
export function daysAgo(days: number): Date {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  date.setUTCHours(10, 0, 0, 0);

  return date;
}

/** A Date at 12:00 Tashkent time on `day` of the Tashkent calendar month `monthsBack` months before now. */
export function tashkentMonthDay(monthsBack: number, day: number, now = new Date()): Date {
  const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);

  return new Date(Date.UTC(tashkentNow.getUTCFullYear(), tashkentNow.getUTCMonth() - monthsBack, day, 7));
}

/** YYYY-MM of the Tashkent calendar month `monthsBack` months before now. */
export function tashkentMonthKey(monthsBack: number, now = new Date()): string {
  return tashkentMonthDay(monthsBack, 1, now).toISOString().slice(0, 7);
}

/** YYYY-MM-DD of a Date, for procedure inputs that take a day string. */
export function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Gives the fixture tenant an active Telegram integration. Tenant notifications use only the tenant's own token
 * (never TELEGRAM_BOT_TOKEN), so tests that expect a send need this; mock `decryptIntegrationTokens` to read it.
 */
export function seedActiveTelegramIntegration(fixture: MoneyFixture, tokensEncrypted = 'encrypted-test-token'): void {
  fixture.store.seed('Integration', [{ tenantId: fixture.tenantId, type: 'telegram', status: 'active', tokensEncrypted }]);
}
