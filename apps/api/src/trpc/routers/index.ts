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
});

export type AppRouter = typeof appRouter;
