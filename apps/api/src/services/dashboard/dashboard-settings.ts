import { asObject } from '../../lib/object';
import { asStringArray } from '../integrations/amocrm-live';

/** `settings.dashboard`: which amoCRM fields and stages mark a lead as qualified, and where reasons and sources live. */
export function readDashboardSettings(settings: unknown) {
  const dashboardSettings = asObject(asObject(settings)?.dashboard);

  return {
    reasonFieldKey: typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null,
    sourceFieldKey: typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null,
    qualifiedStageIds: asStringArray(dashboardSettings?.qualifiedStageIds),
    qualifiedValues: asStringArray(dashboardSettings?.qualifiedValues),
    nonQualifiedValues: asStringArray(dashboardSettings?.nonQualifiedValues),
  };
}
