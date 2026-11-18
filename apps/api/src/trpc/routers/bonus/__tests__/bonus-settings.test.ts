import type { JWTPayload } from '@dashboarduz/shared';

import type { InMemoryPrisma } from '../../../../__tests__/helpers/in-memory-prisma';
import { contextFor, createMoneyFixture, type MoneyFixture, tashkentMonthKey } from '../../../../__tests__/helpers/money-fixtures';
import { bonusRouter } from '../index';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  forTenant: () => mockStore.client(),
}));

let fixture: MoneyFixture;

const caller = (userId: string, roles: JWTPayload['roles']) => bonusRouter.createCaller(contextFor(fixture, userId, roles));
const admin = () => caller(fixture.adminId, ['Admin']);
const salary = () => (fixture.store.rows('Tenant')[0]!.settings as { salary: Record<string, unknown> }).salary;
const audits = () => fixture.store.rows('AuditLog').map((log) => log.action);

const simple = (percent: number) => ({ mode: 'simple' as const, tierBasis: 'sales_count' as const, simplePercent: percent, tiers: [] });

beforeEach(() => {
  fixture = createMoneyFixture();
  mockStore = fixture.store;
  fixture.store.tables.get('Tenant')![0]!.settings = { theme: 'dark', salary: { bonusMode: 'on_income', bonusPercentages: { offline: 7 } } };
});

describe('bonus rules and policy versions', () => {
  it('reads the salary config from tenant settings, for bonus readers only', async () => {
    const config = await caller(fixture.managerId, ['Manager']).getSalaryConfig();

    expect(config.bonusMode).toBe('on_income');
    expect(config.bonusRules.offline).toEqual(simple(7));
    expect(config.bonusRules.online).toEqual(simple(0));
    expect(config.fixedSalaries).toEqual([]);
    await expect(caller(fixture.agentId, ['Agent']).getSalaryConfig()).rejects.toThrow('Bonus settings are available for Admin/Manager/TeamLeader only.');
  });

  it('updateBonusRules stores sanitized rules plus the legacy simple percentages and keeps other settings', async () => {
    await admin().updateBonusRules({
      bonusMode: 'on_debt_closed',
      bonusRules: {
        online: simple(5.567),
        offline: { mode: 'tiered', tierBasis: 'sales_count', simplePercent: 3, tiers: [{ minSales: 1, maxSales: 4, percent: 4 }, { minSales: 5, maxSales: null, percent: 6 }] },
        intensive: simple(2),
        additional_service: simple(0),
      },
    });

    expect(fixture.store.rows('Tenant')[0]!.settings).toMatchObject({ theme: 'dark' });
    expect(salary()).toMatchObject({
      bonusMode: 'on_debt_closed',
      bonusPercentages: { online: 5.57, offline: 0, intensive: 2, additional_service: 0 },
    });
    expect((salary().bonusRules as Record<string, unknown>).offline).toEqual({
      mode: 'tiered',
      tierBasis: 'sales_count',
      simplePercent: 3,
      tiers: [{ minSales: 1, maxSales: 4, percent: 4 }, { minSales: 5, maxSales: null, percent: 6 }],
    });
    expect(audits()).toEqual(['bonus_rules_update']);
  });

  it('refuses overlapping or open-in-the-middle tiers', async () => {
    const tiered = (tiers: Array<{ minSales: number; maxSales: number | null; percent: number }>) => admin().updateBonusRules({
      bonusMode: 'on_income',
      bonusRules: { online: simple(1), offline: { mode: 'tiered', tierBasis: 'sales_count', simplePercent: 1, tiers }, intensive: simple(1), additional_service: simple(1) },
    });

    await expect(tiered([{ minSales: 1, maxSales: null, percent: 2 }, { minSales: 3, maxSales: null, percent: 4 }])).rejects.toThrow("Ochiq diapazon (max bo'sh) faqat oxirgi qatorda bo'lishi mumkin.");
    await expect(tiered([])).rejects.toThrow("Tiered rejimda kamida bitta diapazon bo'lishi shart.");
    await expect(tiered([{ minSales: 5, maxSales: 2, percent: 4 }])).rejects.toThrow("Diapazon tugashi boshlanishidan kichik bo'lishi mumkin emas.");
    expect(audits()).toEqual([]);
  });

  it('savePolicyVersion seeds the legacy policy once and stores the month version with course overrides', async () => {
    const month = tashkentMonthKey(0);
    const result = await admin().savePolicyVersion({
      effectiveMonth: month,
      bonusMode: 'on_income',
      bonusRules: { online: simple(1), offline: simple(9), intensive: simple(3), additional_service: simple(0) },
      courseOverrides: {
        [fixture.courseId]: { mode: 'monthly_team_income_tiered', fallbackPercent: 1, tiers: [{ minAmount: 0, maxAmount: 9_999_999, percent: 2 }, { minAmount: 10_000_000, maxAmount: null, percent: 4 }] },
      },
    });

    expect(result).toMatchObject({ success: true, effectiveMonth: month });
    const versions = fixture.store.rows('BonusPolicyVersion');

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ effectiveMonth: new Date('1970-01-01T00:00:00.000Z'), policy: { bonusMode: 'on_income', courseOverrides: {} } });
    expect(versions[1]!.policy).toMatchObject({ bonusRules: { offline: simple(9) }, courseOverrides: { [fixture.courseId]: { fallbackPercent: 1 } } });
    expect(salary()).toMatchObject({ bonusRules: { offline: simple(9) }, courseBonusOverrides: { [fixture.courseId]: { mode: 'monthly_team_income_tiered' } } });

    // Saving the same month again updates that version instead of adding one.
    await admin().savePolicyVersion({ ...result.policy, effectiveMonth: month, bonusRules: { ...result.policy.bonusRules, offline: simple(11) } });
    expect(fixture.store.rows('BonusPolicyVersion')).toHaveLength(2);

    const editor = await admin().getPolicyEditor({ effectiveMonth: month });

    expect(editor.selectedMonth).toBe(month);
    expect(editor.currentMonth).toBe(month);
    expect(editor.policy.bonusRules.offline.simplePercent).toBe(11);
    expect(editor.versions.map((version) => version.effectiveMonth)).toEqual([month, '1970-01']);
    expect(editor.courses.map((course) => course.name)).toEqual(['Foundation English', 'IELTS Intensive']);
  });

  it('savePolicyVersion refuses a past month and broken course tiers', async () => {
    const base = { bonusMode: 'on_income' as const, bonusRules: { online: simple(1), offline: simple(1), intensive: simple(1), additional_service: simple(1) } };
    const override = (tiers: Array<{ minAmount: number; maxAmount: number | null; percent: number }>) => admin().savePolicyVersion({
      ...base,
      effectiveMonth: tashkentMonthKey(0),
      courseOverrides: { [fixture.courseId]: { mode: 'monthly_team_income_tiered', fallbackPercent: 1, tiers } },
    });

    await expect(admin().savePolicyVersion({ ...base, effectiveMonth: tashkentMonthKey(1), courseOverrides: {} })).rejects.toThrow("O'tgan oy bonus siyosatini o'zgartirib bo'lmaydi.");
    await expect(override([{ minAmount: 10, maxAmount: 5, percent: 1 }])).rejects.toThrow(`${fixture.courseId}: bonus diapazoni noto'g'ri.`);
    await expect(override([{ minAmount: 0, maxAmount: null, percent: 1 }, { minAmount: 5, maxAmount: null, percent: 2 }])).rejects.toThrow(`${fixture.courseId}: ochiq diapazon faqat oxirgi tier bo'lishi mumkin.`);
    await expect(override([{ minAmount: 0, maxAmount: 10, percent: 1 }, { minAmount: 10, maxAmount: null, percent: 2 }])).rejects.toThrow(`${fixture.courseId}: tierlar kesishmasligi kerak.`);
    await expect(override([{ minAmount: 0, maxAmount: 10, percent: 1 }])).rejects.toThrow(`${fixture.courseId}: oxirgi tier ochiq bo'lishi kerak.`);
    expect(fixture.store.rows('BonusPolicyVersion')).toHaveLength(0);
  });
});

describe('bonus plans', () => {
  const plan = () => ({
    name: '  Offline closer  ',
    periodMode: 'monthly' as const,
    courseCategory: 'offline' as const,
    courseId: fixture.courseId,
    tariffId: fixture.tariffId,
    targetClosedSales: 5,
    bonusAmount: 500_000,
  });

  it('creates, updates and deletes a plan in tenant settings', async () => {
    fixture.store.seed('SubTariff', [{ tenantId: fixture.tenantId, tariffId: fixture.tariffId, name: 'morning' }]);
    const created = await admin().createPlan(plan());

    expect(created.plan).toMatchObject({ name: 'Offline closer', isActive: true, courseId: fixture.courseId, tariffId: fixture.tariffId, subTariffId: null, targetClosedSales: 5, bonusAmount: 500_000 });
    expect((await caller(fixture.managerId, ['Manager']).listPlans()).plans).toHaveLength(1);

    const updated = await admin().updatePlan({ id: created.plan.id, bonusAmount: 750_000, isActive: false, tariffId: null, subTariffName: '  Morning  ' });

    // Without a tariff the sub-tariff is matched by its normalized name across the course's tariffs.
    expect(updated.plan).toMatchObject({ bonusAmount: 750_000, isActive: false, tariffId: null, subTariffId: null, subTariffName: 'morning' });
    await expect(admin().deletePlan({ id: created.plan.id })).resolves.toEqual({ success: true });
    expect((await admin().listPlans()).plans).toEqual([]);
    expect(audits()).toEqual(['bonus_plan_create', 'bonus_plan_update', 'bonus_plan_delete']);
  });

  it('refuses scopes that do not match the catalog', async () => {
    await expect(admin().createPlan({ ...plan(), courseCategory: 'online' })).rejects.toThrow('Tanlangan kurs turi va kurs kategoriyasi mos emas.');
    await expect(admin().createPlan({ ...plan(), courseId: null })).rejects.toThrow('Kurs/Subtarif tanlash uchun avval kurs tanlang.');
    await expect(admin().createPlan({ ...plan(), tariffId: fixture.otherTariffId })).rejects.toThrow('Tanlangan tarif topilmadi.');
    await expect(admin().createPlan({ ...plan(), tariffId: null, subTariffName: 'Evening' })).rejects.toThrow('Tanlangan kurs uchun subtarif topilmadi.');
    await expect(admin().updatePlan({ id: '00000000-0000-4000-8000-000000000001', bonusAmount: 1 })).rejects.toThrow('Bonus plan not found.');
    await expect(admin().deletePlan({ id: '00000000-0000-4000-8000-000000000001' })).rejects.toThrow('Bonus plan not found.');
    await expect(caller(fixture.agentId, ['Agent']).listPlans()).rejects.toThrow('Bonus plans are available for Admin/Manager/TeamLeader only.');
  });

  it('lists the active course catalog for plan scopes', async () => {
    const { courses } = await admin().catalogOptions();

    expect(courses.map((course) => course.name)).toEqual(expect.arrayContaining(['Foundation English', 'IELTS Intensive']));
  });
});

describe('salary settings', () => {
  it('keeps fixed salaries only for active agents with a positive amount', async () => {
    await admin().updateFixedSalaries({
      fixedSalaries: [
        { userId: fixture.agentId, amount: 4_000_000 },
        { userId: fixture.otherAgentId, amount: 0 },
        { userId: fixture.financeId, amount: 3_000_000 },
      ],
    });

    expect(salary().fixedSalaries).toEqual([{ userId: fixture.agentId, amount: 4_000_000 }]);
    expect((await admin().getSalaryConfig()).fixedSalaries).toEqual([{ userId: fixture.agentId, amount: 4_000_000 }]);
  });

  it('stores KPI settings and refuses an empty or zero-threshold selection', async () => {
    const thresholds = { conversion: { full: 20, half: 10 }, callCount: { full: 0, half: 0 } };

    await admin().updateKpiSettings({ monthlyKpiAmount: 1_000_000, selectedMetrics: ['conversion', 'conversion'], thresholds });
    expect(salary().kpiSettings).toMatchObject({ enabled: true, monthlyBudget: 1_000_000, selectedMetrics: ['conversion'], thresholds: { conversion: { full: 20, half: 10 }, callCount: { full: 0, half: 0 } } });

    await expect(admin().updateKpiSettings({ monthlyKpiAmount: 1, selectedMetrics: [], thresholds })).rejects.toThrow("Kamida bitta KPI ko'rsatkichini tanlang.");
    await expect(admin().updateKpiSettings({ monthlyKpiAmount: 1, selectedMetrics: ['callCount'], thresholds })).rejects.toThrow(
      "Tanlangan KPI (callCount) uchun full/half threshold 0 dan katta bo'lishi kerak.",
    );
  });

  it('forces absence penalties onto the fixed salary', async () => {
    await admin().updateAttendancePenaltySettings({
      lateMinutePenaltyUZS: 1_000,
      missingHourPenaltyUZS: 20_000,
      absenceDayPenaltyUZS: 100_000,
      applyToFixedSalary: false,
      applyToKpi: true,
      latePenaltyTarget: 'kpi',
      missingHourPenaltyTarget: 'kpi',
      absenceDayPenaltyTarget: 'kpi',
      monthlyPenaltyCapUZS: 500_000,
    });

    expect(salary().attendancePenaltySettings).toEqual({
      lateMinutePenaltyUZS: 1_000,
      missingHourPenaltyUZS: 20_000,
      absenceDayPenaltyUZS: 100_000,
      applyToFixedSalary: true,
      applyToKpi: true,
      latePenaltyTarget: 'kpi',
      missingHourPenaltyTarget: 'kpi',
      absenceDayPenaltyTarget: 'fixed',
      monthlyPenaltyCapUZS: 500_000,
    });
    expect((await admin().getSalaryConfig()).attendancePenaltySettings).toMatchObject({ absenceDayPenaltyUZS: 100_000, absenceDayPenaltyTarget: 'fixed' });
  });
});
