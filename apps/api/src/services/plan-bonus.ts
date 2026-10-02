import { normalizeSubTariffName, type PlanBonusPeriodMode, type SalaryPlanBonus } from '../trpc/routers/dashboard/helpers';
import { getTashkentMonthKey, type SaleClosure } from './bonus-engine';

export type PlanProgress = {
  planId: string;
  name: string;
  periodMode: PlanBonusPeriodMode;
  target: number;
  fact: number;
  completionPercent: number;
  completedUnits: number;
  earnedAmount: number;
};

function closureMatchesPlan(closure: SaleClosure, plan: SalaryPlanBonus, subTariffNameById: Map<string, string>): boolean {
  if (plan.courseCategory !== closure.category) return false;
  if (plan.courseId && plan.courseId !== closure.courseId) return false;
  if (plan.tariffId && plan.tariffId !== closure.tariffId) return false;
  if (plan.subTariffId && plan.subTariffId !== closure.profileSubTariffId) return false;
  if (!plan.tariffId && plan.subTariffName) {
    const saleSubTariffName = closure.profileSubTariffId ? subTariffNameById.get(closure.profileSubTariffId) || '' : '';
    if (!saleSubTariffName || saleSubTariffName !== normalizeSubTariffName(plan.subTariffName)) return false;
  }
  return true;
}

/**
 * Plan ("reja") bonus for a viewed range, credited to the agent who closed each sale.
 * - monthly: each calendar month is its own plan; units = floor(closures in that month / target), summed.
 * - all_time: lifetime closures; only units newly reached inside the range are paid, so a reward is paid once.
 */
export function computePlanProgressByAgent(params: {
  plans: SalaryPlanBonus[];
  closures: SaleClosure[];
  agentIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
  subTariffNameById: Map<string, string>;
}): Map<string, PlanProgress[]> {
  const result = new Map<string, PlanProgress[]>();
  const startMs = params.rangeStart.getTime();
  const endMs = params.rangeEnd.getTime();

  for (const agentId of params.agentIds) {
    const agentClosures = params.closures.filter((closure) => (
      closure.closerUserId === agentId && closure.closedAt.getTime() <= endMs
    ));
    const progress = params.plans.map((plan): PlanProgress => {
      const matching = agentClosures.filter((closure) => closureMatchesPlan(closure, plan, params.subTariffNameById));
      const target = Math.max(plan.targetClosedSales, 1);
      let fact: number;
      let completedUnits: number;
      if (plan.periodMode === 'all_time') {
        fact = matching.length;
        const before = matching.filter((closure) => closure.closedAt.getTime() < startMs).length;
        completedUnits = Math.floor(fact / target) - Math.floor(before / target);
      } else {
        const inRange = matching.filter((closure) => closure.closedAt.getTime() >= startMs);
        fact = inRange.length;
        const countByMonth = new Map<string, number>();
        for (const closure of inRange) {
          const key = getTashkentMonthKey(closure.closedAt);
          countByMonth.set(key, (countByMonth.get(key) || 0) + 1);
        }
        completedUnits = [...countByMonth.values()].reduce((sum, count) => sum + Math.floor(count / target), 0);
      }
      return {
        planId: plan.id,
        name: plan.name,
        periodMode: plan.periodMode,
        target: plan.targetClosedSales,
        fact,
        completionPercent: plan.targetClosedSales > 0 ? Number(((fact / plan.targetClosedSales) * 100).toFixed(1)) : 0,
        completedUnits,
        earnedAmount: completedUnits * plan.bonusAmount,
      };
    });
    result.set(agentId, progress);
  }
  return result;
}
