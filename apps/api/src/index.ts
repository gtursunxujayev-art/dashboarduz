import dotenv from 'dotenv';
import app from './app';
import { log, LogLevel } from './services/observability';

dotenv.config();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  log(LogLevel.INFO, 'API server started', { port: PORT });
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`tRPC endpoint: http://localhost:${PORT}/api/trpc`);
});
