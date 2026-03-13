import { router } from '../trpc';
import { authRouter } from './auth';
import { integrationsRouter } from './integrations';
import { leadsRouter } from './leads';
import { sellersRouter } from './sellers';

export const appRouter = router({
  auth: authRouter,
  integrations: integrationsRouter,
  leads: leadsRouter,
  sellers: sellersRouter,
});

export type AppRouter = typeof appRouter;
