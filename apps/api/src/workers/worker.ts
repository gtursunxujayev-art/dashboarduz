// Main worker entry point
// This file is executed by worker containers

import { initializeWorkers } from '../services/queue/queues';
import { log, LogLevel } from '../services/observability';
import { initSentry } from '../services/observability';

// Initialize observability
initSentry();

// Initialize queue workers
try {
  initializeWorkers();
  log(LogLevel.INFO, 'Worker service started');
} catch (error: any) {
  log(LogLevel.ERROR, 'Failed to start worker service', { error: error.message });
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log(LogLevel.INFO, 'SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log(LogLevel.INFO, 'SIGINT received, shutting down gracefully');
  process.exit(0);
});
