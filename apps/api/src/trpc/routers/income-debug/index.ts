import { router } from '../../trpc';

import { incomeDebugIntegrityProcedures } from './integrity';
import { incomeDebugListProcedures } from './list';
import { incomeDebugRelinkProcedures } from './relink';
import { incomeDebugRepairProcedures } from './repair';

export const incomeDebugRouter = router({
  ...incomeDebugListProcedures,
  ...incomeDebugIntegrityProcedures,
  ...incomeDebugRepairProcedures,
  ...incomeDebugRelinkProcedures,
});
