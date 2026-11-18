import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, type MoneyFixture } from '../../../../__tests__/helpers/money-fixtures';
import { customerIncomeRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;

const caller = (userId: string, roles: JWTPayload['roles']) => customerIncomeRouter.createCaller(contextFor(fixture, userId, roles));
const manager = () => caller(fixture.managerId, ['Manager']);

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
});

describe('course catalog', () => {
  it('creates a course with Tashkent dates, and re-creating it by name reactivates it instead of duplicating', async () => {
    const created = await manager().createCourse({ name: '  Speaking Club ', category: 'online', startDate: '2026-09-01', endDate: '2026-12-31' });

    expect(created).toMatchObject({ name: 'Speaking Club', category: 'online', isActive: true, startDate: new Date('2026-08-31T19:00:00.000Z'), endDate: new Date('2026-12-30T19:00:00.000Z') });
    await manager().updateCourse({ courseId: created.id, isFaol: false });
    const again = await manager().createCourse({ name: 'Speaking Club', category: 'offline' });

    expect(again).toMatchObject({ id: created.id, category: 'offline', isActive: true, startDate: null });
    expect(fixture.store.rows('Course', { name: 'Speaking Club' })).toHaveLength(1);
  });

  it('refuses an end date before the start date and non-managers', async () => {
    await expect(manager().createCourse({ name: 'X', category: 'online', startDate: '2026-09-02', endDate: '2026-09-01' })).rejects.toThrow(
      "Kurs tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas.",
    );
    await expect(caller(fixture.agentId, ['Agent']).createCourse({ name: 'X', category: 'online' })).rejects.toThrow();
    expect(fixture.store.rows('Course', { name: 'X' })).toHaveLength(0);
  });

  it('creates tariffs and sub-tariffs under active parents only, reusing them by name', async () => {
    const tariff = await manager().createTariff({ courseId: fixture.courseId, name: ' Premium ' });
    const again = await manager().createTariff({ courseId: fixture.courseId, name: 'Premium' });
    const subTariff = await manager().createSubTariff({ tariffId: tariff.id, name: ' Evening ' });

    expect(again.id).toBe(tariff.id);
    expect(subTariff).toMatchObject({ tariffId: tariff.id, name: 'Evening', isActive: true });

    await manager().updateCourse({ courseId: fixture.otherCourseId, isActive: false });
    await expect(manager().createTariff({ courseId: fixture.otherCourseId, name: 'Any' })).rejects.toThrow('Course not found.');
    await manager().updateTariff({ tariffId: tariff.id, isActive: false });
    await expect(manager().createSubTariff({ tariffId: tariff.id, name: 'Late' })).rejects.toThrow('Tariff not found.');
  });

  it('updates course fields and refuses an empty or unknown update', async () => {
    const updated = await manager().updateCourse({ courseId: fixture.courseId, name: ' English ', category: 'intensive', startDate: '2026-01-10', endDate: null, isHiddenFromIncomeForm: true });

    expect(updated).toMatchObject({ name: 'English', category: 'intensive', startDate: new Date('2026-01-09T19:00:00.000Z'), endDate: null, isHiddenFromIncomeForm: true });
    await expect(manager().updateCourse({ courseId: fixture.courseId })).rejects.toThrow('No fields to update.');
    await expect(manager().updateCourse({ courseId: fixture.courseId, startDate: '2026-02-02', endDate: '2026-02-01' })).rejects.toThrow(
      "Kurs tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas.",
    );
    await expect(manager().updateCourse({ courseId: '00000000-0000-4000-8000-000000000001', name: 'X' })).rejects.toThrow('Course not found.');
  });

  it('renames and toggles tariffs and sub-tariffs', async () => {
    const [subTariff] = fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'Morning' }]);

    expect(await manager().updateTariff({ tariffId: fixture.tariffId, name: ' Basic ', isFaol: false })).toMatchObject({ name: 'Basic', isActive: false });
    expect(await manager().updateSubTariff({ subTariffId: String(subTariff!.id), isActive: false })).toMatchObject({ name: 'Morning', isActive: false });
    await expect(manager().updateTariff({ tariffId: fixture.tariffId })).rejects.toThrow('No fields to update.');
    await expect(manager().updateSubTariff({ subTariffId: '00000000-0000-4000-8000-000000000001', name: 'x' })).rejects.toThrow('Sub-tariff not found.');
    await expect(manager().updateTariff({ tariffId: '00000000-0000-4000-8000-000000000001', name: 'x' })).rejects.toThrow('Tariff not found.');
  });

  it('lists every course with its tariffs, inactive ones included', async () => {
    await manager().updateCourse({ courseId: fixture.otherCourseId, isActive: false });
    const catalog = await caller(fixture.agentId, ['Agent']).courseCatalog();

    expect(catalog.map((course) => [course.name, course.tariffs.map((tariff) => tariff.name)])).toEqual([
      ['Foundation English', ['Standard']],
      ['IELTS Intensive', ['VIP']],
    ]);
  });
});
