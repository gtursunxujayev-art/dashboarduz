import { router } from '../../trpc';

import { sellerDetailProcedures } from './detail';
import { sellerListProcedures } from './list';
import { sellerReportProcedures } from './report';

export const sellersRouter = router({
  ...sellerListProcedures,
  ...sellerDetailProcedures,
  ...sellerReportProcedures,
});
