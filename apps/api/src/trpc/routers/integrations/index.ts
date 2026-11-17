import { router } from '../../trpc';

import { amocrmIntegrationProcedures } from './amocrm';
import { faceIdIntegrationProcedures } from './faceid';
import { faceIdMappingProcedures } from './faceid-mappings';
import { generalIntegrationProcedures } from './general';
import { leadSnapshotProcedures } from './lead-snapshot';
import { metaAdsIntegrationProcedures } from './meta-ads';
import { telegramIntegrationProcedures } from './telegram';
import { telegramReportProcedures } from './telegram-reports';

export const integrationsRouter = router({
  ...generalIntegrationProcedures,
  ...amocrmIntegrationProcedures,
  ...leadSnapshotProcedures,
  ...telegramIntegrationProcedures,
  ...telegramReportProcedures,
  ...metaAdsIntegrationProcedures,
  ...faceIdIntegrationProcedures,
  ...faceIdMappingProcedures,
});
