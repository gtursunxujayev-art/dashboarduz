import {
  buildContactListQuery,
  buildEventListQuery,
  buildLeadByIdQuery,
  buildLeadListQuery,
  buildNoteListQuery,
  buildTaskListQuery,
  buildUserListQuery,
  toUnixSecondsParam,
  withQueryString,
} from '../amocrm-query';

const decoded = (query: URLSearchParams) => decodeURIComponent(query.toString());

describe('amoCRM query helpers', () => {
  it('turns dates into whole Unix seconds', () => {
    expect(toUnixSecondsParam(new Date('2026-01-01T00:00:00.999Z'))).toBe('1767225600');
    expect(toUnixSecondsParam(new Date(0))).toBe('0');
  });

  it('appends the query only when it is not empty', () => {
    expect(withQueryString('/api/v4/leads', new URLSearchParams())).toBe('/api/v4/leads');
    expect(withQueryString('/api/v4/leads', new URLSearchParams({ page: '2' }))).toBe('/api/v4/leads?page=2');
  });
});

describe('buildLeadListQuery', () => {
  it('is empty without options and skips zero paging values', () => {
    expect(buildLeadListQuery().toString()).toBe('');
    expect(buildLeadListQuery({ page: 0, limit: 0, pipelineIds: [], statusFilters: [] }).toString()).toBe('');
  });

  it('keeps the parameter order and indexes the status filters', () => {
    expect(decoded(buildLeadListQuery({
      order: { field: 'id', direction: 'asc' },
      updatedAtFrom: new Date('2026-01-03T00:00:00Z'),
      responsibleUserIds: ['5'],
      statusFilters: [{ pipelineId: '1', statusId: '2' }],
      pipelineIds: ['1'],
      query: 'Ali Vali',
      with: 'contacts',
      limit: 10,
      page: 1,
    }))).toBe(
      'page=1&limit=10&with=contacts&query=Ali+Vali&filter[pipeline_id][]=1'
      + '&filter[statuses][0][pipeline_id]=1&filter[statuses][0][status_id]=2'
      + '&filter[responsible_user_id][]=5&filter[updated_at][from]=1767398400&order[id]=asc',
    );
  });

  it('sends a created-at bound on its own', () => {
    expect(decoded(buildLeadListQuery({ createdAtTo: new Date('2026-01-02T00:00:00Z') }))).toBe('filter[created_at][to]=1767312000');
  });
});

describe('the other list queries', () => {
  it('builds contacts, lead-by-id and users queries', () => {
    expect(buildContactListQuery({ query: 'x', limit: 5, page: 2 }).toString()).toBe('page=2&limit=5&query=x');
    expect(buildContactListQuery().toString()).toBe('');
    expect(buildLeadByIdQuery({ with: 'contacts,catalog_elements' }).toString()).toBe('with=contacts%2Ccatalog_elements');
    expect(buildLeadByIdQuery({}).toString()).toBe('');
    expect(buildUserListQuery({ page: 1, limit: 250 }).toString()).toBe('page=1&limit=250');
  });

  it('puts the task updated-at window first and lets completed win over completedOnly', () => {
    expect(decoded(buildTaskListQuery({
      entityType: 'leads',
      dateTo: new Date('2026-01-02T00:00:00Z'),
      completedOnly: false,
      responsibleUserIds: ['3'],
      page: 2,
      updatedAtTo: new Date('2026-01-04T00:00:00Z'),
    }))).toBe(
      'filter[updated_at][to]=1767484800&page=2&filter[responsible_user_id][]=3&filter[is_completed]=0'
      + '&filter[complete_till][to]=1767312000&filter[entity_type]=leads',
    );
    expect(buildTaskListQuery({ completed: true, completedOnly: false }).get('filter[is_completed]')).toBe('1');
    expect(buildTaskListQuery({}).has('filter[is_completed]')).toBe(false);
  });

  it('caps the notes page size at 250 and orders oldest-updated first on request', () => {
    expect(decoded(buildNoteListQuery({ limit: 1000, orderByUpdatedAsc: true, noteTypes: ['call_in'] })))
      .toBe('order[updated_at]=asc&limit=250&filter[note_type][]=call_in');
    expect(buildNoteListQuery({ limit: 40, entityIds: ['9', '8'] }).getAll('filter[entity_id][]')).toEqual(['9', '8']);
    expect(buildNoteListQuery({ limit: 40 }).get('limit')).toBe('40');
    expect(buildNoteListQuery({ orderByUpdatedAsc: false }).toString()).toBe('');
  });

  it('builds the events query with authors and entity', () => {
    expect(decoded(buildEventListQuery({ entityType: 'lead', userIds: ['1', '2'], dateFrom: new Date('2026-01-01T00:00:00Z') })))
      .toBe('filter[created_at][from]=1767225600&filter[created_by][]=1&filter[created_by][]=2&filter[entity]=lead');
    expect(buildEventListQuery({ userIds: [] }).toString()).toBe('');
  });
});
