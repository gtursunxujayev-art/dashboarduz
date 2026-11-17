/**
 * Enumerations used by API inputs that the web app also needs (filters, forms, labels).
 * Each list exists once: the API validates with the schema, the web app uses the type/array.
 */
import { z } from 'zod';

/** Preset report periods accepted by the dashboard, calls and course-sales procedures. */
export const REPORT_RANGES = ['today', 'week', 'month', 'custom'] as const;
export const reportRangeSchema = z.enum(REPORT_RANGES);
export type ReportRangePreset = z.infer<typeof reportRangeSchema>;

/** The sellers report also offers the last 30 days. */
export const SELLER_RANGES = ['today', 'week', 'month', 'last30days', 'custom'] as const;
export const sellerRangeSchema = z.enum(SELLER_RANGES);
export type SellerRange = z.infer<typeof sellerRangeSchema>;

/** Course categories; salary bonus rules and plan bonuses are configured per category. */
export const COURSE_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
export const courseCategorySchema = z.enum(COURSE_CATEGORIES);
export type CourseCategory = z.infer<typeof courseCategorySchema>;

/** Course categories that course-sales reports group by (additional services excluded). */
export const COURSE_TYPE_CATEGORIES = ['online', 'offline', 'intensive'] as const;
export const courseTypeCategorySchema = z.enum(COURSE_TYPE_CATEGORIES);
export type CourseTypeCategory = z.infer<typeof courseTypeCategorySchema>;

/** Salary bonus rule: one percentage, or tiers by closed sales count or closed agreement amount. */
export const SALARY_RULE_MODES = ['simple', 'tiered'] as const;
export type SalaryRuleMode = (typeof SALARY_RULE_MODES)[number];

/** What a tiered salary rule's min/max measure: the agent's closed sales count, or their closed agreement total (UZS). */
export const SALARY_TIER_BASES = ['sales_count', 'agreement_amount'] as const;
export type SalaryTierBasis = (typeof SALARY_TIER_BASES)[number];

/** When a salary bonus is earned: on each income, or when the sale's debt is closed. */
export const SALARY_BONUS_MODES = ['on_income', 'on_debt_closed'] as const;
export type SalaryBonusMode = (typeof SALARY_BONUS_MODES)[number];

/** Plan bonus period: per month, or all time. */
export const PLAN_BONUS_PERIOD_MODES = ['monthly', 'all_time'] as const;
export type PlanBonusPeriodMode = (typeof PLAN_BONUS_PERIOD_MODES)[number];

/** Attendance penalties are taken from the fixed salary or from the KPI part. */
export const penaltyTargetSchema = z.enum(['fixed', 'kpi']);
export type PenaltyTarget = z.infer<typeof penaltyTargetSchema>;

/** A reviewer's decision on a pending request. */
export const reviewActionSchema = z.enum(['approve', 'reject']);
export type ReviewAction = z.infer<typeof reviewActionSchema>;

/** Income adjustment requests (refund / tariff change) and their review status. */
export const ADJUSTMENT_TYPES = ['refund', 'tariff_change'] as const;
export const adjustmentTypeSchema = z.enum(ADJUSTMENT_TYPES);
export type AdjustmentType = z.infer<typeof adjustmentTypeSchema>;

export const ADJUSTMENT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const adjustmentStatusSchema = z.enum(ADJUSTMENT_STATUSES);
export type AdjustmentStatus = z.infer<typeof adjustmentStatusSchema>;

/** Customer list filter by outstanding debt. */
export const debtFilterSchema = z.enum(['all', 'with_debt', 'without_debt']);
export type DebtFilter = z.infer<typeof debtFilterSchema>;

/** Sales teams. */
export const managerGroupSchema = z.enum(['online', 'offline']);
export type ManagerGroup = z.infer<typeof managerGroupSchema>;

/** Funnel filter: one team or both. */
export const funnelGroupSchema = z.enum(['all', 'online', 'offline']);
export type FunnelGroup = z.infer<typeof funnelGroupSchema>;

/** Where call records come from. */
export const callsSourceSchema = z.enum(['utel', 'amocrm']);
export type CallsSource = z.infer<typeof callsSourceSchema>;

/** Topics the analytics AI can focus on. */
export const aiFocusSchema = z.enum(['sales', 'lead_quality', 'meta_targeting', 'agents', 'courses']);
export type AiFocus = z.infer<typeof aiFocusSchema>;
