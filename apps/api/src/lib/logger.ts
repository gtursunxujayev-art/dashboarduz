// src/lib/logger.ts
import pino, { type LoggerOptions } from 'pino';

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
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (process.env.NODE_ENV !== 'production') {
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
