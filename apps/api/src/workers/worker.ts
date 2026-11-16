// Main worker entry point
// This file is executed by worker containers

import { logger } from '../lib/logger';
import { startBonusAutoFinalizeScheduler, stopBonusAutoFinalizeScheduler } from '../services/bonus-auto-finalize';
import { startAmoCallsSyncScheduler, stopAmoCallsSyncScheduler } from '../services/integrations/amocrm-call-sync';
import { initSentry , reportError } from '../services/observability';
import { initializeWorkers } from '../services/queue/queues';
import { startTelegramAgentPerformanceScheduler, stopTelegramAgentPerformanceScheduler } from '../services/reports/telegram-agent-performance-scheduler';
import { startTelegramGroupSummaryScheduler, stopTelegramGroupSummaryScheduler } from '../services/reports/telegram-group-summary-scheduler';
import { startTelegramReportScheduler, stopTelegramReportScheduler } from '../services/reports/telegram-report-scheduler';
import { startWebhookEventRetentionScheduler, stopWebhookEventRetentionScheduler } from '../services/webhook-event-retention';

// Initialize observability
initSentry();

function startWorkerService(): void {
  initializeWorkers();
  startTelegramReportScheduler();
  startTelegramAgentPerformanceScheduler();
  startTelegramGroupSummaryScheduler();
  startBonusAutoFinalizeScheduler();
  startWebhookEventRetentionScheduler();
  startAmoCallsSyncScheduler();
  logger.info('Worker service started');
}

Promise.resolve().then(startWorkerService).catch((error: any) => {
  const details = {
    error: error?.message || String(error),
    stack: error?.stack || null,
  };

  reportError('Failed to start worker service', details);
  logger.error({ ...details }, '[Worker] Startup failed:');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopTelegramGroupSummaryScheduler();
  stopBonusAutoFinalizeScheduler();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  stopTelegramGroupSummaryScheduler();
  stopBonusAutoFinalizeScheduler();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});
