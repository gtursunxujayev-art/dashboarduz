import { router } from '../trpc';

import { aiHelperRouter } from './ai-helper';
import { analyticsAiRouter } from './analytics-ai';
import { attendanceRouter } from './attendance';
import { authRouter } from './auth';
import { bonusRouter } from './bonus';
import { callsRouter } from './calls';
import { corporateCallsRouter } from './corporate-calls';
import { courseSalesRouter } from './course-sales';
import { customerIncomeRouter } from './customer-income';
import { dashboardRouter } from './dashboard';
import { funnelRouter } from './funnel';
import { incomeDebugRouter } from './income-debug';
import { incomeProblemsRouter } from './income-problems';
import { integrationsRouter } from './integrations';
import { leadsRouter } from './leads';
import { notificationsRouter } from './notifications';
import { reportsRouter } from './reports';
import { sellersRouter } from './sellers';
import { telegramBotRouter } from './telegram-bot';
import { tenantRouter } from './tenant';
import { usersRouter } from './users';

export const appRouter = router({
  auth: authRouter,
  integrations: integrationsRouter,
  leads: leadsRouter,
  sellers: sellersRouter,
  calls: callsRouter,
  notifications: notificationsRouter,
  users: usersRouter,
  tenant: tenantRouter,
  dashboard: dashboardRouter,
  customerIncome: customerIncomeRouter,
  bonus: bonusRouter,
  courseSales: courseSalesRouter,
  telegramBot: telegramBotRouter,
  incomeProblems: incomeProblemsRouter,
  incomeDebug: incomeDebugRouter,
  corporateCalls: corporateCallsRouter,
  attendance: attendanceRouter,
  analyticsAi: analyticsAiRouter,
  reports: reportsRouter,
  funnel: funnelRouter,
  aiHelper: aiHelperRouter,
});

export type AppRouter = typeof appRouter;

