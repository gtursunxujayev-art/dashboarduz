import dotenv from 'dotenv';

import app from './app';
import { logger } from './lib/logger';
import { reportError } from './services/observability';

dotenv.config();

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

function startApiServer(): void {
  app.listen(Number(PORT), HOST, () => {
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const publicUrl = railwayDomain ? `https://${railwayDomain}` : process.env.PUBLIC_API_URL;

    logger.info({ port: PORT }, 'API server started');
    logger.info(`API server running on ${HOST}:${PORT}`);
    if (publicUrl) {
      logger.info(`Public API URL: ${publicUrl}`);
      logger.info(`Public tRPC endpoint: ${publicUrl}/api/trpc`);
    }
  });
}

Promise.resolve().then(startApiServer).catch((error: any) => {
  reportError('Failed to start API server', {
    error: error?.message || String(error),
  });
  process.exit(1);
});
