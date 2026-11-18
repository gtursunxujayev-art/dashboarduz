import { createExpressMiddleware } from '@trpc/server/adapters/express';

import { createContext } from './context';
import { appRouter } from './routers';

export const trpcMiddleware = createExpressMiddleware({
  router: appRouter,
  createContext: ({ req, res }) => createContext({ req, res }),
});
