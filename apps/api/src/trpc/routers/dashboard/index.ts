import { router } from '../../trpc';

import { financeSummaryProcedures } from './finance-summary';
import { incomeDynamicsProcedures } from './income-dynamics';
import { incomeOverviewProcedures } from './income-overview';
import { layoutProcedures } from './layout';
import { leadOverviewProcedures } from './lead-overview';
import { liveLeaderboardProcedures } from './live-leaderboard';
import { salaryProcedures } from './salary';
import { settingsProcedures } from './settings';
import { summaryProcedures } from './summary';
import { widgetProcedures } from './widgets';

export const dashboardRouter = router({
  ...summaryProcedures,
  ...financeSummaryProcedures,
  ...salaryProcedures,
  ...layoutProcedures,
  ...widgetProcedures,
  ...settingsProcedures,
  ...liveLeaderboardProcedures,
  ...incomeOverviewProcedures,
  ...incomeDynamicsProcedures,
  ...leadOverviewProcedures,
});
