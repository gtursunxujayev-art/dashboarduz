// Main worker entry point
// This file is executed by worker containers

import { initializeWorkers } from '../services/queue/queues';
import { log, LogLevel } from '../services/observability';
import { initSentry } from '../services/observability';
import { startTelegramReportScheduler, stopTelegramReportScheduler } from '../services/reports/telegram-report-scheduler';
import { startTelegramAgentPerformanceScheduler, stopTelegramAgentPerformanceScheduler } from '../services/reports/telegram-agent-performance-scheduler';
import { startTelegramGroupSummaryScheduler, stopTelegramGroupSummaryScheduler } from '../services/reports/telegram-group-summary-scheduler';
import { startBonusAutoFinalizeScheduler, stopBonusAutoFinalizeScheduler } from '../services/bonus-auto-finalize';
import { startWebhookEventRetentionScheduler, stopWebhookEventRetentionScheduler } from '../services/webhook-event-retention';
import { startAmoCallsSyncScheduler, stopAmoCallsSyncScheduler } from '../services/integrations/amocrm-call-sync';

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
  log(LogLevel.INFO, 'Worker service started');
}

Promise.resolve().then(startWorkerService).catch((error: any) => {
  const details = {
    error: error?.message || String(error),
    stack: error?.stack || null,
  };
  log(LogLevel.ERROR, 'Failed to start worker service', details);
  console.error('[Worker] Startup failed:', details);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log(LogLevel.INFO, 'SIGTERM received, shutting down gracefully');
  stopTelegramGroupSummaryScheduler();
  stopBonusAutoFinalizeScheduler();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  log(LogLevel.INFO, 'SIGINT received, shutting down gracefully');
  stopTelegramGroupSummaryScheduler();
  stopBonusAutoFinalizeScheduler();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});
