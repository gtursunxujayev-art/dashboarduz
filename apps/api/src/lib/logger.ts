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
