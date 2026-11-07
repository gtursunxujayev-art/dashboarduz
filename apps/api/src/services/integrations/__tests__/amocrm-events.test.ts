import { amocrmService } from '../amocrm';
import { createAmoCRMActivityDiagnostics, getAmoCRMActivityMetrics } from '../amocrm-activity';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('AmoCRM events fetching', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('splits created_by filter into chunks of at most 10 users (amoCRM limit)', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ _embedded: { events: [{ id: `e${urls.length}` }] } });
    }) as unknown as typeof fetch;

    const userIds = Array.from({ length: 18 }, (_, i) => String(1000 + i));
    const events = await amocrmService.fetchAllEvents('token', { userIds }, 'https://example.amocrm.ru');

    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const count = new URL(url).searchParams.getAll('filter[created_by][]').length;
      expect(count).toBeLessThanOrEqual(10);
    }
    expect(events).toHaveLength(2);
  });

  it('treats 204 No Content as an empty page instead of failing', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(amocrmService.fetchAllEvents('token', { userIds: ['1'] }, 'https://example.amocrm.ru')).resolves.toEqual([]);
    await expect(amocrmService.fetchAllTasks('token', { responsibleUserIds: ['1'] }, 'https://example.amocrm.ru')).resolves.toEqual([]);
  });

  it('reports HTTP errors as fetch_failed, not network_error', async () => {
    jest.spyOn(amocrmService, 'fetchAllTasks').mockResolvedValue([] as never);
    jest.spyOn(amocrmService, 'fetchAllEvents')
      .mockRejectedValue(new Error('Failed to fetch AmoCRM events: 400 Bad Request'));
    const diagnostics = createAmoCRMActivityDiagnostics();

    await getAmoCRMActivityMetrics({
      tenantId: 'events-http-error-test',
      accessToken: 'token',
      managerIds: ['10'],
      rangeStart: new Date('2026-09-15T00:00:00.000Z'),
      rangeEnd: new Date('2026-09-15T23:59:59.999Z'),
      diagnostics,
    });

    expect(diagnostics.events).toEqual({ ok: false, reason: 'fetch_failed' });
  });
});
