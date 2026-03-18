// Main worker entry point
// This file is executed by worker containers

import { initializeWorkers } from '../services/queue/queues';
import { log, LogLevel } from '../services/observability';
import { initSentry } from '../services/observability';
import { startTelegramReportScheduler, stopTelegramReportScheduler } from '../services/reports/telegram-report-scheduler';

// Initialize observability
initSentry();

// Initialize queue workers
try {
  initializeWorkers();
  startTelegramReportScheduler();
  log(LogLevel.INFO, 'Worker service started');
} catch (error: any) {
  const details = {
    error: error?.message || String(error),
    stack: error?.stack || null,
  };
  log(LogLevel.ERROR, 'Failed to start worker service', details);
  console.error('[Worker] Startup failed:', details);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log(LogLevel.INFO, 'SIGTERM received, shutting down gracefully');
  stopTelegramReportScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  log(LogLevel.INFO, 'SIGINT received, shutting down gracefully');
  stopTelegramReportScheduler();
  process.exit(0);
});
