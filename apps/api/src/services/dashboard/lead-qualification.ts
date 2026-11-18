/**
 * Whether an amoCRM lead counts as qualified or non-qualified, by the tenant's dashboard settings
 * (`settings.dashboard`, see {@link readDashboardSettings}). Shared by the summary and the lead overview cards.
 */
import type { AmoCRMLead } from '../integrations/amocrm';
import { extractLeadValue } from '../integrations/amocrm-live';

import { isMappedValue } from './catalog-fields';

export type LeadQualificationRules = {
  reasonFieldKey: string | null;
  qualifiedValues: string[];
  nonQualifiedValues: string[];
  qualifiedStageIds: string[];
};

export type LeadQualification = {
  /** The lead's value in the reason field (`reasonFieldKey`), if any. */
  reasonValue: string | null;
  qualified: boolean;
  nonQualified: boolean;
};

/**
 * Qualified: the lead sits in one of the qualified stages, or, when no stages are configured, its reason value is
 * one of the qualified values. Non-qualified: its reason value is one of the non-qualified values.
 */
export function classifyLeadQualification(lead: AmoCRMLead, rules: LeadQualificationRules): LeadQualification {
  const reasonValue = extractLeadValue(lead, rules.reasonFieldKey);
  const stageId = lead.status_id === null || lead.status_id === undefined ? null : String(lead.status_id);
  const qualified = rules.qualifiedStageIds.length > 0
    ? Boolean(stageId && rules.qualifiedStageIds.includes(stageId))
    : isMappedValue(reasonValue, rules.qualifiedValues);
  const nonQualified = rules.nonQualifiedValues.length > 0 && isMappedValue(reasonValue, rules.nonQualifiedValues);

  return { reasonValue, qualified, nonQualified };
}
