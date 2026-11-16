import { router } from '../../trpc';

import { adjustmentReviewProcedures } from './adjustment-review';
import { adjustmentProcedures } from './adjustments';
import { catalogProcedures } from './catalog';
import { customerCourseProcedures } from './customer-courses';
import { customerListProcedures } from './customer-list';
import { customerProcedures } from './customers';
import { formOptionsProcedures } from './form-options';
import { historicalImportProcedures } from './historical-import';
import { incomeProcedures } from './income';
import { incomeListProcedures } from './income-lists';
import { incomeUpdateProcedures } from './income-update';
import { paymentHistoryProcedures } from './payment-history';

export const customerIncomeRouter = router({
  ...formOptionsProcedures,
  ...catalogProcedures,
  ...incomeProcedures,
  ...incomeUpdateProcedures,
  ...historicalImportProcedures,
  ...incomeListProcedures,
  ...paymentHistoryProcedures,
  ...adjustmentProcedures,
  ...adjustmentReviewProcedures,
  ...customerProcedures,
  ...customerCourseProcedures,
  ...customerListProcedures,
});
