import { forTenant, isRlsContextEnabled } from '@dashboarduz/db';

describe('RLS context flag', () => {
  it('is off until the RLS rollout sets DATABASE_SYSTEM_URL', () => {
    expect(isRlsContextEnabled({})).toBe(false);
    expect(isRlsContextEnabled({ DATABASE_SYSTEM_URL: '  ' })).toBe(false);
    expect(isRlsContextEnabled({ DATABASE_SYSTEM_URL: 'postgres://system@db/app' })).toBe(true);
  });

  it('can be forced either way', () => {
    expect(isRlsContextEnabled({ DB_RLS_CONTEXT: 'on' })).toBe(true);
    expect(isRlsContextEnabled({ DB_RLS_CONTEXT: 'off', DATABASE_SYSTEM_URL: 'postgres://system@db/app' })).toBe(false);
  });

  it('hands back the plain client when the context is off', () => {
    const client = { marker: true } as never;

    expect(forTenant('tenant-1', 'user-1', { client, setContext: false })).toBe(client);
  });
});
