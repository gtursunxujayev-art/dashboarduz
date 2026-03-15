import { router } from '../trpc';
import { authRouter } from './auth';
import { integrationsRouter } from './integrations';
import { leadsRouter } from './leads';
import { sellersRouter } from './sellers';
import { callsRouter } from './calls';
import { notificationsRouter } from './notifications';
import { usersRouter } from './users';
import { tenantRouter } from './tenant';
import { dashboardRouter } from './dashboard';
import { customerIncomeRouter } from './customer-income';

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
});

export type AppRouter = typeof appRouter;
