import dotenv from 'dotenv';
import app from './app';
import { log, LogLevel } from './services/observability';
import { ensureSchemaCompatibility } from './services/db/schema-compatibility';

dotenv.config();

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';

async function startApiServer() {
  await ensureSchemaCompatibility();

  app.listen(Number(PORT), HOST, () => {
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const publicUrl = railwayDomain ? `https://${railwayDomain}` : process.env.PUBLIC_API_URL;

    log(LogLevel.INFO, 'API server started', { port: PORT });
    console.log(`API server running on ${HOST}:${PORT}`);
    if (publicUrl) {
      console.log(`Public API URL: ${publicUrl}`);
      console.log(`Public tRPC endpoint: ${publicUrl}/api/trpc`);
    }
  });
}

startApiServer().catch((error: any) => {
  log(LogLevel.ERROR, 'Failed to start API server', {
    error: error?.message || String(error),
  });
  process.exit(1);
});
