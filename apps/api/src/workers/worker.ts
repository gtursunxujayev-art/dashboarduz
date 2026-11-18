// Main worker entry point
// This file is executed by worker containers

import { errorMessage, errorStack } from '../lib/errors';
import { logger } from '../lib/logger';
import { startBonusAutoFinalizeScheduler, stopBonusAutoFinalizeScheduler } from '../services/bonus-auto-finalize';
import { startBonusReconcileSweeper, stopBonusReconcileSweeper } from '../services/bonus-reconcile-sweeper';
import { startAmoActivitySnapshotScheduler, stopAmoActivitySnapshotScheduler } from '../services/integrations/amocrm-activity-snapshot';
import { startAmoCallsSyncScheduler, stopAmoCallsSyncScheduler } from '../services/integrations/amocrm-call-sync';
import { startAmoLeadSnapshotScheduler, stopAmoLeadSnapshotScheduler } from '../services/integrations/amocrm-lead-snapshot';
import { initSentry , reportError } from '../services/observability';
import { startTelegramAgentPerformanceScheduler, stopTelegramAgentPerformanceScheduler } from '../services/reports/telegram-agent-performance-scheduler';
import { startTelegramGroupSummaryScheduler, stopTelegramGroupSummaryScheduler } from '../services/reports/telegram-group-summary-scheduler';
import { startTelegramReportScheduler, stopTelegramReportScheduler } from '../services/reports/telegram-report-scheduler';
import { startWebhookEventRetentionScheduler, stopWebhookEventRetentionScheduler } from '../services/webhook-event-retention';

import { initializeWorkers } from './bullmq-workers';

// Initialize observability
initSentry();

function startWorkerService(): void {
  initializeWorkers();
  startTelegramReportScheduler();
  startTelegramAgentPerformanceScheduler();
  startTelegramGroupSummaryScheduler();
  startBonusAutoFinalizeScheduler();
  startBonusReconcileSweeper();
  startWebhookEventRetentionScheduler();
  startAmoCallsSyncScheduler();
  startAmoLeadSnapshotScheduler();
  startAmoActivitySnapshotScheduler();
  logger.info('Worker service started');
}

Promise.resolve().then(startWorkerService).catch((error: unknown) => {
  const details = {
    error: errorMessage(error),
    stack: errorStack(error) ?? null,
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
  stopBonusReconcileSweeper();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopAmoLeadSnapshotScheduler();
  stopAmoActivitySnapshotScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  stopTelegramGroupSummaryScheduler();
  stopBonusAutoFinalizeScheduler();
  stopBonusReconcileSweeper();
  stopWebhookEventRetentionScheduler();
  stopAmoCallsSyncScheduler();
  stopAmoLeadSnapshotScheduler();
  stopAmoActivitySnapshotScheduler();
  stopTelegramAgentPerformanceScheduler();
  stopTelegramReportScheduler();
  process.exit(0);
});
