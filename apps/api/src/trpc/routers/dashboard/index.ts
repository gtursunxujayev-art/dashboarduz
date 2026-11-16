import { router } from '../../trpc';
import { summaryProcedures } from './summary';
import { financeSummaryProcedures } from './finance-summary';
import { salaryProcedures } from './salary';
import { layoutProcedures } from './layout';
import { widgetProcedures } from './widgets';
import { settingsProcedures } from './settings';
import { liveLeaderboardProcedures } from './live-leaderboard';
import { incomeOverviewProcedures } from './income-overview';
import { leadOverviewProcedures } from './lead-overview';

export const dashboardRouter = router({
  ...summaryProcedures,
  ...financeSummaryProcedures,
  ...salaryProcedures,
  ...layoutProcedures,
  ...widgetProcedures,
  ...settingsProcedures,
  ...liveLeaderboardProcedures,
  ...incomeOverviewProcedures,
  ...leadOverviewProcedures,
});
