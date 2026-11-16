import type { SalaryBonusMode, SalaryBonusRules, SalaryCategory } from '../../trpc/routers/dashboard/helpers';

export const ELIGIBLE_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent', 'TeamLeader']);

export type CourseIncomeTier = {
  minAmount: number;
  maxAmount: number | null;
  percent: number;
};

export type CourseBonusOverride = {
  mode: 'monthly_team_income_tiered';
  fallbackPercent: number;
  tiers: CourseIncomeTier[];
};

export type BonusPolicy = {
  schemaVersion: 2;
  bonusMode: SalaryBonusMode;
  bonusRules: SalaryBonusRules;
  courseOverrides: Record<string, CourseBonusOverride>;
};

export type BonusCalculationItem = {
  sourceKey: string;
  sourceIncomeId: string;
  sourceSaleId: string;
  agentUserId: string;
  courseId: string | null;
  courseName: string | null;
  category: SalaryCategory;
  calculationMode: 'legacy_income' | 'legacy_debt_closed' | 'course_team_income';
  eventDate: Date;
  baseAmount: number;
  appliedPercent: number;
  bonusAmount: number;
  agreementAmount: number;
  closingIncomeId: string;
  closedCount: number;
  usedFallback: boolean;
};

export type BonusCalculationLine = {
  groupKey: string;
  agentUserId: string;
  courseId: string | null;
  category: SalaryCategory;
  calculationMode: BonusCalculationItem['calculationMode'];
  qualifyingAmount: number;
  appliedPercent: number;
  bonusAmount: number;
  sourceCount: number;
};

export type BonusMonthCalculation = {
  month: Date;
  policy: BonusPolicy;
  policyVersionId: string | null;
  sourceDigest: string;
  totalBonusAmount: number;
  lines: BonusCalculationLine[];
  items: BonusCalculationItem[];
  finalized: boolean;
  finalizedAt: Date | null;
  /** Digest in the pre-2026-09 format, so snapshots finalized before the format change still match unchanged data. */
  legacySourceDigest?: string;
};

export type BonusIncomeRow = {
  id: string;
  type: string;
  relatedDebtIncomeId: string | null;
  managerUserId: string;
  courseId: string | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  paymentAmount: number;
  remainingDebtAmount: number;
  entryDate: Date;
  createdAt: Date;
  course: { id: string; name: string; category: string } | null;
};

export type IncomeRow = BonusIncomeRow;
