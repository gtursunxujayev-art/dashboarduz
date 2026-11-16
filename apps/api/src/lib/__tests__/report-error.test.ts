import * as Sentry from '@sentry/node';

import { LogLevel, logWithContext, reportError } from '../../services/observability';
import { logger } from '../logger';

describe('reportError / logWithContext', () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    process.env.SENTRY_DSN = originalDsn;
    jest.restoreAllMocks();
  });

  it('logs at error level with the context fields and reports to Sentry when configured', () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const capture = jest.spyOn(Sentry, 'captureException').mockImplementation(() => '');

    process.env.SENTRY_DSN = 'https://example.invalid/1';
    reportError('Tick failed', { tenantId: 't1', error: 'boom' });

    expect(error).toHaveBeenCalledWith({ tenantId: 't1', error: 'boom' }, 'Tick failed');
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ name: 'LoggedError', message: 'Tick failed' }), expect.objectContaining({
      tags: { service: 'dashboarduz-api', tenantId: 't1' },
      extra: { tenantId: 't1', error: 'boom' },
    }));
  });

  it('does not call Sentry without a DSN, and logWithContext routes other levels to the logger', () => {
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const capture = jest.spyOn(Sentry, 'captureException').mockImplementation(() => '');

    delete process.env.SENTRY_DSN;
    reportError('No DSN');
    logWithContext(LogLevel.WARN, 'Slow request', { requestId: 'r1' });

    expect(capture).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ requestId: 'r1' }, 'Slow request');
  });
});
