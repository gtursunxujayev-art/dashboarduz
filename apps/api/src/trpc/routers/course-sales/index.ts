import { router } from '../../trpc';

import { courseDetailProcedures } from './course-detail';
import { courseSalesCustomerProcedures } from './customers';
import { courseSalesOptionProcedures } from './options';
import { courseSalesSummaryProcedures } from './summary';
import { courseSalesTypeCustomerProcedures } from './type-customers';
import { courseSalesTypeSummaryProcedures } from './type-summary';

export const courseSalesRouter = router({
  ...courseSalesOptionProcedures,
  ...courseSalesTypeSummaryProcedures,
  ...courseSalesTypeCustomerProcedures,
  ...courseSalesSummaryProcedures,
  ...courseSalesCustomerProcedures,
  ...courseDetailProcedures,
});
