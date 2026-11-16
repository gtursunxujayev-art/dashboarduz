import { router } from '../../trpc';

import { amocrmIntegrationProcedures } from './amocrm';
import { faceIdIntegrationProcedures } from './faceid';
import { faceIdMappingProcedures } from './faceid-mappings';
import { generalIntegrationProcedures } from './general';
import { metaAdsIntegrationProcedures } from './meta-ads';
import { telegramIntegrationProcedures } from './telegram';
import { telegramReportProcedures } from './telegram-reports';

export const integrationsRouter = router({
  ...generalIntegrationProcedures,
  ...amocrmIntegrationProcedures,
  ...telegramIntegrationProcedures,
  ...telegramReportProcedures,
  ...metaAdsIntegrationProcedures,
  ...faceIdIntegrationProcedures,
  ...faceIdMappingProcedures,
});
