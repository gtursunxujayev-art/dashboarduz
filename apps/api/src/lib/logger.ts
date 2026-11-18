// src/lib/logger.ts
import { pino, stdTimeFunctions, type LoggerOptions } from 'pino';

const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'access_token',
      'refresh_token',
      'secret',
      'apiKey',
      'api_key',
      'client_secret',
      'private_key',
      '*.password',
      '*.token',
      '*.access_token',
      '*.refresh_token',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      '*.client_secret',
      '*.private_key',
    ],
    censor: '**REDACTED**'
  },
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  timestamp: stdTimeFunctions.isoTime,
  // Every line names the service (the former observability log() helper added this field).
  mixin: () => ({ service: 'dashboarduz-api' }),
};

// pino-pretty runs as a transport in a worker thread. Under Jest that thread keeps each test worker alive after its
// suites finish ("A worker process has failed to exit gracefully"), so tests log plain JSON to stdout synchronously.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  };
}

export const logger = pino(loggerOptions);

/**
 * Mask a phone number for safe logging — keeps the last 4 digits, replaces
 * earlier digits with '*'. Returns undefined if the input is falsy.
 *
 * Examples: '+998901234567' -> '+*********4567', '5551234' -> '***1234'.
 */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const str = String(phone);

  return str.replace(/\d(?=\d{4})/g, '*');
}
