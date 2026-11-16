/**
 * Traffic-light grading of seller KPIs, shared by the sellers list and the seller details page.
 * Thresholds are product rules; change them here only.
 */
export type KpiBadge = 'good' | 'warning' | 'critical' | 'neutral';

/** Lead-to-sale conversion: 15%+ good, 10%+ warning. */
export function getConversionBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 15) return 'good';
  if (rate >= 10) return 'warning';
  return 'critical';
}

/** Share of follow-up tasks done on time: 90%+ good, 80%+ warning. */
export function getFollowUpBadge(completed: number, overdue: number): KpiBadge {
  const total = completed + overdue;
  if (total === 0) return 'neutral';
  const rate = (completed / total) * 100;
  if (rate >= 90) return 'good';
  if (rate >= 80) return 'warning';
  return 'critical';
}

/** Share of outbound calls: 60%+ good, 50%+ warning. */
export function getOutboundBadge(outbound: number, total: number): KpiBadge {
  if (total === 0) return 'neutral';
  const rate = (outbound / total) * 100;
  if (rate >= 60) return 'good';
  if (rate >= 50) return 'warning';
  return 'critical';
}

/** Average daily talk time: 2h+ good, 1.5h+ warning; neutral without calls. */
export function getDailyTalkBadge(seconds: number | null | undefined, hasCalls: boolean): KpiBadge {
  if (!hasCalls) return 'neutral';
  const s = seconds ?? 0;
  if (s >= 7200) return 'good';
  if (s >= 5400) return 'warning';
  return 'critical';
}

/** Missed-call rate: 5% or less good, 10% or less warning. */
export function getMissedCallBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate <= 5) return 'good';
  if (rate <= 10) return 'warning';
  return 'critical';
}

/** Debt collection: 85%+ good, 70%+ warning. */
export function getDebtCollectionBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 85) return 'good';
  if (rate >= 70) return 'warning';
  return 'critical';
}

/** Refund rate: 5% or less good, 8% or less warning. */
export function getRefundBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate <= 5) return 'good';
  if (rate <= 8) return 'warning';
  return 'critical';
}

/** Payment deadlines kept: 90%+ good, 75%+ warning. */
export function getDeadlineBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 90) return 'good';
  if (rate >= 75) return 'warning';
  return 'critical';
}

/** First response to a lead: 5 min or less good, 30 min or less warning. */
export function getResponseTimeBadge(seconds: number): KpiBadge {
  if (seconds <= 0) return 'neutral';
  if (seconds <= 300) return 'good';
  if (seconds <= 1800) return 'warning';
  return 'critical';
}
