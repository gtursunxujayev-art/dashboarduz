import crypto from 'crypto';

import { AmoCRMService, amocrmService } from '../amocrm';

type FetchCall = { url: string; init: RequestInit | undefined };

const BASE_URL = 'https://example.amocrm.ru/';

function fakeResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  const response: Pick<Response, 'ok' | 'status' | 'statusText' | 'json' | 'text'> = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  };

  return response as Response;
}

/** Replaces global fetch; each call gets the next queued response (the last one repeats). */
function mockFetch(...responses: Response[]): FetchCall[] {
  const calls: FetchCall[] = [];
  let index = 0;

  global.fetch = jest.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses[Math.min(index, responses.length - 1)] ?? fakeResponse(undefined, 204);

    index += 1;

    return Promise.resolve(response);
  });

  return calls;
}

function at(calls: FetchCall[], index: number): FetchCall {
  const call = calls[index];

  if (!call) throw new Error(`no fetch call #${index}`);

  return call;
}

function abortingFetch(): void {
  global.fetch = jest.fn(() => {
    const error = new Error('This operation was aborted');

    error.name = 'AbortError';

    return Promise.reject(error);
  });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('AmoCRMService request URLs', () => {
  it('builds the leads query with every filter in a fixed order', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { leads: [{ id: 1 }] } }));

    const result = await amocrmService.fetchLeads('tok', '', {
      page: 2,
      limit: 50,
      with: 'contacts',
      query: 'Ali',
      pipelineIds: ['11', '12'],
      statusFilters: [{ pipelineId: '11', statusId: '142' }, { pipelineId: '12', statusId: '143' }],
      responsibleUserIds: ['7'],
      createdAtFrom: new Date('2026-01-01T00:00:00.900Z'),
      createdAtTo: new Date('2026-01-02T00:00:00.000Z'),
      updatedAtFrom: new Date('2026-01-03T00:00:00.000Z'),
      order: { field: 'updated_at', direction: 'desc' },
    }, BASE_URL);

    expect(result).toEqual({ _embedded: { leads: [{ id: 1 }] } });
    expect(calls).toHaveLength(1);
    expect(decodeURIComponent(at(calls, 0).url)).toBe(
      'https://example.amocrm.ru/api/v4/leads?page=2&limit=50&with=contacts&query=Ali'
      + '&filter[pipeline_id][]=11&filter[pipeline_id][]=12'
      + '&filter[statuses][0][pipeline_id]=11&filter[statuses][0][status_id]=142'
      + '&filter[statuses][1][pipeline_id]=12&filter[statuses][1][status_id]=143'
      + '&filter[responsible_user_id][]=7'
      + '&filter[created_at][from]=1767225600&filter[created_at][to]=1767312000'
      + '&filter[updated_at][from]=1767398400&order[updated_at]=desc',
    );
    expect(at(calls, 0).init).toEqual({ headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' } });
  });

  it('omits the query string when no lead filter is given', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { leads: [] } }));

    await amocrmService.fetchLeads('tok', '', undefined, BASE_URL);

    expect(at(calls, 0).url).toBe('https://example.amocrm.ru/api/v4/leads');
  });

  it('builds the contacts, lead-by-id and users URLs', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { contacts: [], users: [] } }));

    await amocrmService.fetchContacts('tok', '', { page: 1, limit: 5, query: 'x y' }, BASE_URL);
    await amocrmService.fetchLeadById('tok', '99', { with: 'contacts' }, BASE_URL);
    await amocrmService.fetchLeadById('tok', '98', undefined, BASE_URL);
    await amocrmService.fetchUsers('tok', { page: 3, limit: 250 }, BASE_URL);

    expect(calls.map((call) => call.url)).toEqual([
      'https://example.amocrm.ru/api/v4/contacts?page=1&limit=5&query=x+y',
      'https://example.amocrm.ru/api/v4/leads/99?with=contacts',
      'https://example.amocrm.ru/api/v4/leads/98',
      'https://example.amocrm.ru/api/v4/users?page=3&limit=250',
    ]);
  });

  it('builds the tasks query (updated window first, completed beats completedOnly)', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { tasks: [] } }));

    await amocrmService.fetchTasks('tok', {
      page: 1,
      limit: 250,
      responsibleUserIds: ['1', '2'],
      completed: false,
      completedOnly: true,
      dateFrom: new Date('2026-01-01T00:00:00.000Z'),
      dateTo: new Date('2026-01-02T00:00:00.000Z'),
      entityType: 'leads',
      updatedAtFrom: new Date('2026-01-03T00:00:00.000Z'),
      updatedAtTo: new Date('2026-01-04T00:00:00.000Z'),
    }, BASE_URL);
    await amocrmService.fetchTasks('tok', { completedOnly: true, responsibleUserIds: [] }, BASE_URL);

    expect(decodeURIComponent(at(calls, 0).url)).toBe(
      'https://example.amocrm.ru/api/v4/tasks?filter[updated_at][from]=1767398400&filter[updated_at][to]=1767484800'
      + '&page=1&limit=250&filter[responsible_user_id][]=1&filter[responsible_user_id][]=2'
      + '&filter[is_completed]=0&filter[complete_till][from]=1767225600&filter[complete_till][to]=1767312000'
      + '&filter[entity_type]=leads',
    );
    expect(decodeURIComponent(at(calls, 1).url)).toBe('https://example.amocrm.ru/api/v4/tasks?filter[is_completed]=1');
  });

  it('builds the notes query and caps the page size at 250', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { notes: [{ id: 5 }] } }));

    const notes = await amocrmService.fetchNotes('tok', 'contacts', {
      page: 2,
      limit: 900,
      noteTypes: ['call_in', 'call_out'],
      entityIds: ['3'],
      updatedAtFrom: new Date('2026-01-01T00:00:00.000Z'),
      updatedAtTo: new Date('2026-01-02T00:00:00.000Z'),
      orderByUpdatedAsc: true,
    }, BASE_URL);

    expect(notes).toEqual([{ id: 5 }]);
    expect(decodeURIComponent(at(calls, 0).url)).toBe(
      'https://example.amocrm.ru/api/v4/contacts/notes?order[updated_at]=asc&page=2&limit=250'
      + '&filter[note_type][]=call_in&filter[note_type][]=call_out&filter[entity_id][]=3'
      + '&filter[updated_at][from]=1767225600&filter[updated_at][to]=1767312000',
    );
  });

  it('builds the events query', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { events: [] } }));

    await amocrmService.fetchEvents('tok', {
      page: 4,
      limit: 100,
      dateFrom: new Date('2026-01-01T00:00:00.000Z'),
      dateTo: new Date('2026-01-02T00:00:00.000Z'),
      userIds: ['8', '9'],
      entityType: 'lead',
    }, BASE_URL);

    expect(decodeURIComponent(at(calls, 0).url)).toBe(
      'https://example.amocrm.ru/api/v4/events?page=4&limit=100&filter[created_at][from]=1767225600'
      + '&filter[created_at][to]=1767312000&filter[created_by][]=8&filter[created_by][]=9&filter[entity]=lead',
    );
  });

  it('sends account, pipelines, tasks, notes and events through the timeout wrapper only', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { leads: [], contacts: [] } }));

    await amocrmService.fetchAccountInfo('tok', BASE_URL);
    await amocrmService.fetchPipelines('tok', BASE_URL);
    await amocrmService.fetchTasks('tok', {}, BASE_URL);
    await amocrmService.fetchNotes('tok', 'leads', {}, BASE_URL);
    await amocrmService.fetchEvents('tok', {}, BASE_URL);
    await amocrmService.fetchLeadCustomFields('tok', BASE_URL);
    await amocrmService.fetchLeads('tok', '', {}, BASE_URL);
    await amocrmService.fetchContacts('tok', '', {}, BASE_URL);
    await amocrmService.fetchUsers('tok', {}, BASE_URL);
    await amocrmService.fetchLeadById('tok', '1', {}, BASE_URL);

    expect(calls.map((call) => [call.url.replace('https://example.amocrm.ru', ''), Boolean(call.init?.signal)])).toEqual([
      ['/api/v4/account', true],
      ['/api/v4/leads/pipelines', true],
      ['/api/v4/tasks', true],
      ['/api/v4/leads/notes', true],
      ['/api/v4/events', true],
      ['/api/v4/leads/custom_fields', false],
      ['/api/v4/leads', false],
      ['/api/v4/contacts', false],
      ['/api/v4/users', false],
      ['/api/v4/leads/1', false],
    ]);
  });
});

describe('AmoCRMService responses and errors', () => {
  it('answers 204 No Content with an empty result per endpoint', async () => {
    mockFetch(fakeResponse(undefined, 204, 'No Content'));

    await expect(amocrmService.fetchLeads('tok', '', {}, BASE_URL)).resolves.toEqual({ _embedded: { leads: [] } });
    await expect(amocrmService.fetchTasks('tok', {}, BASE_URL)).resolves.toEqual({});
    await expect(amocrmService.fetchEvents('tok', {}, BASE_URL)).resolves.toEqual({});
    await expect(amocrmService.fetchNotes('tok', 'leads', {}, BASE_URL)).resolves.toEqual([]);
  });

  it('wraps HTTP failures in the per-endpoint messages', async () => {
    mockFetch(fakeResponse({ error: 'nope' }, 500, 'Internal Server Error'));

    await expect(amocrmService.fetchLeads('tok', '', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM leads: Failed to fetch leads from AmoCRM: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchContacts('tok', '', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM contacts: Failed to fetch contacts from AmoCRM: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchAccountInfo('tok', BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM account: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchLeadCustomFields('tok', BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM lead custom fields: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchPipelines('tok', BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM pipelines: Failed to fetch AmoCRM pipelines: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchLeadById('tok', '5', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM lead: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchUsers('tok', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM users: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchTasks('tok', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM tasks: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchNotes('tok', 'leads', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM notes: 500 Internal Server Error'),
    );
    await expect(amocrmService.fetchEvents('tok', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM events: 500 Internal Server Error'),
    );
    await expect(amocrmService.createLead('tok', { name: 'x' }, BASE_URL)).rejects.toThrow(
      new Error('Failed to create AmoCRM lead: Failed to create lead in AmoCRM: 500 Internal Server Error'),
    );
    await expect(amocrmService.updateLead('tok', 3, { name: 'x' }, BASE_URL)).rejects.toThrow(
      new Error('Failed to update AmoCRM lead: Failed to update lead in AmoCRM: 500 Internal Server Error'),
    );
  });

  it('rejects lead and contact lists without an _embedded list', async () => {
    mockFetch(fakeResponse({ _embedded: {} }));

    await expect(amocrmService.fetchLeads('tok', '', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM leads: Invalid response structure from AmoCRM'),
    );
    await expect(amocrmService.fetchContacts('tok', '', {}, BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM contacts: Invalid response structure from AmoCRM'),
    );
  });

  it('turns an aborted request into a timeout error naming the limit', async () => {
    abortingFetch();

    await expect(amocrmService.fetchTasks('tok', { timeoutMs: 1234 }, BASE_URL)).rejects.toThrow(
      new Error('AmoCRM request timeout after 1234ms'),
    );
    await expect(amocrmService.fetchAccountInfo('tok', BASE_URL)).rejects.toThrow(
      new Error('AmoCRM request timeout after 10000ms'),
    );
    await expect(amocrmService.fetchPipelines('tok', BASE_URL)).rejects.toThrow(
      new Error('Failed to fetch AmoCRM pipelines: AmoCRM request timeout after 10000ms'),
    );
  });

  it('passes other network errors through unchanged', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('fetch failed')));

    await expect(amocrmService.fetchEvents('tok', {}, BASE_URL)).rejects.toThrow(new TypeError('fetch failed'));
  });

  it('posts a new lead as a one-item array and patches an existing one', async () => {
    const calls = mockFetch(fakeResponse({ _embedded: { leads: [{ id: 77 }] } }));

    const created = await amocrmService.createLead('tok', { name: 'New', price: 10 }, BASE_URL);
    const updated = await amocrmService.updateLead('tok', 77, { status_id: 142 }, BASE_URL);

    expect(created).toEqual({ _embedded: { leads: [{ id: 77 }] } });
    expect(updated).toEqual({ _embedded: { leads: [{ id: 77 }] } });
    expect(calls).toEqual([
      {
        url: 'https://example.amocrm.ru/api/v4/leads',
        init: {
          method: 'POST',
          headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
          body: '[{"name":"New","price":10}]',
        },
      },
      {
        url: 'https://example.amocrm.ru/api/v4/leads/77',
        init: {
          method: 'PATCH',
          headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
          body: '{"status_id":142}',
        },
      },
    ]);
  });
});

describe('AmoCRMService paging', () => {
  function page(key: 'leads' | 'users' | 'tasks' | 'events', ids: Array<number | string | undefined>, next: boolean): Response {
    return fakeResponse({
      _embedded: { [key]: ids.map((id) => (id === undefined ? { type: 'no-id' } : { id })) },
      ...(next ? { _links: { next: { href: 'next' } } } : {}),
    });
  }

  it('reads lead pages until a short page, clamping the page size to 250', async () => {
    const calls = mockFetch(page('leads', [1, 2], true), page('leads', [3], true));

    const leads = await amocrmService.fetchAllLeads('tok', { limit: 2, pipelineIds: null, query: 'q' }, BASE_URL);

    expect(leads.map((lead) => lead.id)).toEqual([1, 2, 3]);
    expect(calls.map((call) => decodeURIComponent(call.url))).toEqual([
      'https://example.amocrm.ru/api/v4/leads?page=1&limit=2&query=q',
      'https://example.amocrm.ru/api/v4/leads?page=2&limit=2&query=q',
    ]);

    const clamped = mockFetch(page('leads', [1], false));

    await amocrmService.fetchAllLeads('tok', { limit: 5000 }, BASE_URL);
    expect(at(clamped, 0).url).toBe('https://example.amocrm.ru/api/v4/leads?page=1&limit=250');
  });

  it('stops reading users when there is no next link, and at maxPages', async () => {
    const noNext = mockFetch(page('users', [1, 2], false));

    expect(await amocrmService.fetchAllUsers('tok', { limit: 2 }, BASE_URL)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(noNext).toHaveLength(1);

    const capped = mockFetch(page('users', [1], true));

    expect(await amocrmService.fetchAllUsers('tok', { limit: 1, maxPages: 3 }, BASE_URL)).toHaveLength(3);
    expect(capped.map((call) => call.url)).toEqual([
      'https://example.amocrm.ru/api/v4/users?page=1&limit=1',
      'https://example.amocrm.ru/api/v4/users?page=2&limit=1',
      'https://example.amocrm.ru/api/v4/users?page=3&limit=1',
    ]);
  });

  it('reads task pages with the filters on every page', async () => {
    const calls = mockFetch(page('tasks', [1], true), page('tasks', [], true));

    const tasks = await amocrmService.fetchAllTasks('tok', { limit: 1, completedOnly: true, entityType: 'leads' }, BASE_URL);

    expect(tasks).toEqual([{ id: 1 }]);
    expect(calls.map((call) => decodeURIComponent(call.url))).toEqual([
      'https://example.amocrm.ru/api/v4/tasks?page=1&limit=1&filter[is_completed]=1&filter[entity_type]=leads',
      'https://example.amocrm.ru/api/v4/tasks?page=2&limit=1&filter[is_completed]=1&filter[entity_type]=leads',
    ]);
  });

  it('clamps the events page size to 100, de-duplicates by id and keeps events without an id', async () => {
    const calls = mockFetch(page('events', ['a', 'b', undefined], false), page('events', ['b', 'c', undefined], false));

    const events = await amocrmService.fetchAllEvents('tok', {
      limit: 500,
      userIds: [...Array.from({ length: 12 }, (_, i) => String(i + 1)), '1', ''],
    }, BASE_URL);

    expect(events).toEqual([{ id: 'a' }, { id: 'b' }, { type: 'no-id' }, { id: 'c' }, { type: 'no-id' }]);
    expect(calls.map((call) => new URL(call.url).searchParams.getAll('filter[created_by][]'))).toEqual([
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      ['11', '12'],
    ]);
    expect(new URL(at(calls, 0).url).searchParams.get('limit')).toBe('100');
  });

  it('reads events without a user filter in one chunk', async () => {
    const calls = mockFetch(page('events', [1], false));

    await amocrmService.fetchAllEvents('tok', { userIds: null }, BASE_URL);

    expect(calls.map((call) => call.url)).toEqual(['https://example.amocrm.ru/api/v4/events?page=1&limit=100']);
  });
});

describe('AmoCRMService webhook signatures', () => {
  const secret = 'webhook-secret';
  const payload = '{"leads":{"add":[{"id":"1"}]}}';
  const expectedHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  function serviceWithSecret(value: string | undefined): AmoCRMService {
    const previous = process.env.AMOCRM_WEBHOOK_SECRET;

    if (value === undefined) delete process.env.AMOCRM_WEBHOOK_SECRET;
    else process.env.AMOCRM_WEBHOOK_SECRET = value;
    const service = new AmoCRMService();

    if (previous === undefined) delete process.env.AMOCRM_WEBHOOK_SECRET;
    else process.env.AMOCRM_WEBHOOK_SECRET = previous;

    return service;
  }

  it('accepts hex and base64 signatures of the payload', () => {
    const service = serviceWithSecret(secret);

    expect(service.verifyWebhookSignature(payload, expectedHex)).toBe(true);
    expect(service.verifyWebhookSignature(Buffer.from(payload), ` ${expectedHex.toUpperCase()} `)).toBe(true);
    expect(service.verifyWebhookSignature(payload, Buffer.from(expectedHex, 'hex').toString('base64'))).toBe(true);
  });

  it('rejects missing, short and wrong signatures', () => {
    const service = serviceWithSecret(secret);

    expect(service.verifyWebhookSignature(payload, undefined)).toBe(false);
    expect(service.verifyWebhookSignature(payload, 'abcd')).toBe(false);
    expect(service.verifyWebhookSignature(payload, expectedHex.replace(/^./, expectedHex[0] === '0' ? '1' : '0'))).toBe(false);
  });

  it('skips verification outside production when neither a secret nor a signature is set', () => {
    const service = serviceWithSecret(undefined);

    expect(service.verifyWebhookSignature(payload, undefined)).toBe(true);
    expect(service.verifyWebhookSignature(payload, expectedHex)).toBe(false);
  });
});
