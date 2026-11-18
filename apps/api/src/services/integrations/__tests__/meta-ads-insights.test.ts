import { systemPrisma as prisma } from '@dashboarduz/db';

import {
  getLeadCount,
  normalizeMetaAdAccountId,
  normalizeMetaInsightRow,
  parseMetaDate,
  syncMetaAdInsightsForTenant,
  validateMetaAdAccount,
} from '../meta-ads';

jest.mock('../../security/encryption', () => ({
  decryptIntegrationTokens: () => ({ access_token: ' meta-token ' }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Meta insight parsing', () => {
  it('normalizes ad account ids to the act_ form', () => {
    expect(normalizeMetaAdAccountId('123')).toBe('act_123');
    expect(normalizeMetaAdAccountId(' act_123 ')).toBe('act_123');
    expect(normalizeMetaAdAccountId('   ')).toBe('');
  });

  it('reads Graph API day keys as UTC midnight', () => {
    expect(parseMetaDate('2026-11-17').toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });

  it('falls back to the current UTC day for a missing or malformed day key', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-18T22:30:00.000Z'));
    try {
      expect(parseMetaDate(undefined).toISOString()).toBe('2026-11-18T00:00:00.000Z');
      expect(parseMetaDate('17.11.2026').toISOString()).toBe('2026-11-18T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('adds up every lead-like action, rounding and clamping each value', () => {
    expect(getLeadCount([
      { action_type: 'lead', value: '3' },
      { action_type: 'onsite_conversion.lead_grouped', value: '2.6' },
      { action_type: 'offsite_conversion.fb_pixel_lead', value: '-4' },
      { action_type: 'link_click', value: '50' },
      { value: '7' },
    ])).toBe(6);
    expect(getLeadCount(undefined)).toBe(0);
  });

  it('turns a raw insights row into stored values', () => {
    const row = {
      date_start: '2026-11-17',
      campaign_id: 'c1',
      campaign_name: 'Kuzgi kurs',
      adset_id: '',
      ad_id: 'a1',
      impressions: '1234.6',
      clicks: '56',
      spend: '12.5',
      ctr: '4.53',
      cpc: '0.22',
      cpm: 'n/a',
      actions: [{ action_type: 'lead', value: '4' }],
    };

    expect(normalizeMetaInsightRow(row, '987')).toEqual({
      date: new Date('2026-11-17T00:00:00.000Z'),
      accountId: '987',
      campaignId: 'c1',
      campaignName: 'Kuzgi kurs',
      adSetId: '',
      adSetName: null,
      adId: 'a1',
      adName: null,
      impressions: 1235,
      clicks: 56,
      spend: 12.5,
      ctr: 4.53,
      cpc: 0.22,
      cpm: 0,
      leads: 4,
      raw: row,
    });
  });
});

describe('Meta Graph API requests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks for the account fields and returns the body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ id: 'act_1', name: 'Main', currency: 'USD' }));

    await expect(validateMetaAdAccount('token', '1')).resolves.toEqual({ id: 'act_1', name: 'Main', currency: 'USD' });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(url.pathname).toMatch(/\/act_1$/);
    expect(url.searchParams.get('fields')).toBe('id,name,account_status,currency');
    expect(url.searchParams.get('access_token')).toBe('token');
  });

  it('surfaces the Graph API error message, else the HTTP status', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid OAuth access token.' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 42 } }, 500))
      .mockResolvedValueOnce(new Response('not json', { status: 502 }));

    await expect(validateMetaAdAccount('token', '1')).rejects.toThrow('Invalid OAuth access token.');
    await expect(validateMetaAdAccount('token', '1')).rejects.toThrow('Meta API request failed with status 500');
    await expect(validateMetaAdAccount('token', '1')).rejects.toThrow('Meta API request failed with status 502');
  });

  it('follows insights paging and upserts every row', async () => {
    jest.spyOn(prisma.integration, 'findUnique').mockResolvedValue({
      id: 'integration-1',
      status: 'active',
      tokensEncrypted: 'encrypted',
      config: { adAccountId: ' 555 ' },
    } as never);
    const integrationUpdate = jest.spyOn(prisma.integration, 'update').mockResolvedValue({} as never);
    const upsert = jest.spyOn(prisma.metaAdInsight, 'upsert').mockResolvedValue({} as never);
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: [{ date_start: '2026-11-16', campaign_id: 'c1', ad_id: 'a1', spend: '3' }],
        paging: { next: 'https://graph.facebook.com/next-page' },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ date_start: '2026-11-17', campaign_id: 'c1', ad_id: 'a2', clicks: '9' }] }));

    const result = await syncMetaAdInsightsForTenant(
      'tenant-1',
      new Date('2026-11-16T00:00:00.000Z'),
      new Date('2026-11-17T00:00:00.000Z'),
      prisma,
    );

    expect(result).toEqual({ imported: 2 });
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(firstUrl.pathname).toMatch(/\/act_555\/insights$/);
    expect(firstUrl.searchParams.get('time_range')).toBe('{"since":"2026-11-16","until":"2026-11-17"}');
    expect(firstUrl.searchParams.get('access_token')).toBe('meta-token');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://graph.facebook.com/next-page');
    expect(upsert.mock.calls.map(([args]) => args.where.tenantId_date_accountId_campaignId_adSetId_adId)).toEqual([
      { tenantId: 'tenant-1', date: new Date('2026-11-16T00:00:00.000Z'), accountId: '555', campaignId: 'c1', adSetId: '', adId: 'a1' },
      { tenantId: 'tenant-1', date: new Date('2026-11-17T00:00:00.000Z'), accountId: '555', campaignId: 'c1', adSetId: '', adId: 'a2' },
    ]);
    expect(upsert.mock.calls[0]?.[0].update).toMatchObject({ spend: 3, clicks: 0 });
    expect(upsert.mock.calls[1]?.[0].update).toMatchObject({ spend: 0, clicks: 9 });
    expect(integrationUpdate).toHaveBeenCalledWith({
      where: { id: 'integration-1' },
      data: { lastSyncAt: expect.any(Date), errorMessage: null },
    });
  });

  it('reports a failed next page with its Graph API message', async () => {
    jest.spyOn(prisma.integration, 'findUnique').mockResolvedValue({
      id: 'integration-1',
      status: 'active',
      tokensEncrypted: 'encrypted',
      config: { accountId: '555' },
    } as never);
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ data: [], paging: { next: 'https://graph.facebook.com/next-page' } }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Rate limit' } }, 429));

    await expect(syncMetaAdInsightsForTenant('tenant-1', new Date(), new Date(), prisma)).rejects.toThrow('Rate limit');
  });

  it('refuses a disconnected integration', async () => {
    jest.spyOn(prisma.integration, 'findUnique').mockResolvedValue(null);

    await expect(syncMetaAdInsightsForTenant('tenant-1', new Date(), new Date(), prisma))
      .rejects.toThrow('Meta Ads integration is not connected.');
  });
});
