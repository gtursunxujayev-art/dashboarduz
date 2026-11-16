import { router } from '../../trpc';

import { userAccessProcedures } from './access';
import { userAccountProcedures } from './accounts';
import { userDirectoryProcedures } from './directory';

export const usersRouter = router({
  ...userDirectoryProcedures,
  ...userAccountProcedures,
  ...userAccessProcedures,
});
