import { router } from '../../trpc';

import { bonusOperationProcedures } from './operations';
import { bonusPlanProcedures } from './plans';
import { bonusPolicyProcedures } from './policy';
import { bonusSettingsProcedures } from './settings';

export const bonusRouter = router({
  ...bonusPolicyProcedures,
  ...bonusOperationProcedures,
  ...bonusSettingsProcedures,
  ...bonusPlanProcedures,
});
