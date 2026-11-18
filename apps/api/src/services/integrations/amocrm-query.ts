/**
 * Query strings for the amoCRM v4 list endpoints. Pure: options in, URLSearchParams out.
 * The parameter order is part of the contract (tests pin the exact strings).
 */
import type {
  AmoCRMContactQuery,
  AmoCRMEventQuery,
  AmoCRMLeadQuery,
  AmoCRMNoteQuery,
  AmoCRMPageQuery,
  AmoCRMTaskQuery,
} from './amocrm-types';

/** The most items amoCRM returns per page on the leads, users, tasks and notes lists. */
export const AMOCRM_MAX_PAGE_SIZE = 250;

/** A date as the whole Unix seconds amoCRM filters expect. */
export function toUnixSecondsParam(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
}

/** `path?query`, or just `path` when the query is empty. */
export function withQueryString(path: string, query: URLSearchParams): string {
  const text = query.toString();

  return text ? `${path}?${text}` : path;
}

function setPaging(query: URLSearchParams, params: AmoCRMPageQuery | undefined): void {
  if (params?.page) query.set('page', params.page.toString());
  if (params?.limit) query.set('limit', params.limit.toString());
}

/** Sets `filter[<field>][from]` / `[to]` for the bounds that are given. */
function setTimeWindow(query: URLSearchParams, field: string, from: Date | undefined, to: Date | undefined): void {
  if (from) query.set(`filter[${field}][from]`, toUnixSecondsParam(from));
  if (to) query.set(`filter[${field}][to]`, toUnixSecondsParam(to));
}

function appendEach(query: URLSearchParams, key: string, values: string[] | undefined): void {
  values?.forEach((value) => query.append(key, value));
}

/** `GET /leads`: paging, `with`, search, pipeline / status / responsible filters, time windows, order. */
export function buildLeadListQuery(params?: AmoCRMLeadQuery): URLSearchParams {
  const query = new URLSearchParams();

  setPaging(query, params);
  if (params?.with) query.set('with', params.with);
  if (params?.query) query.set('query', params.query);
  appendEach(query, 'filter[pipeline_id][]', params?.pipelineIds);
  params?.statusFilters?.forEach((statusFilter, index) => {
    query.append(`filter[statuses][${index}][pipeline_id]`, statusFilter.pipelineId);
    query.append(`filter[statuses][${index}][status_id]`, statusFilter.statusId);
  });
  appendEach(query, 'filter[responsible_user_id][]', params?.responsibleUserIds);
  setTimeWindow(query, 'created_at', params?.createdAtFrom, params?.createdAtTo);
  setTimeWindow(query, 'updated_at', params?.updatedAtFrom, undefined);
  if (params?.order) query.set(`order[${params.order.field}]`, params.order.direction);

  return query;
}

/** `GET /contacts`: paging and search. */
export function buildContactListQuery(params?: AmoCRMContactQuery): URLSearchParams {
  const query = new URLSearchParams();

  setPaging(query, params);
  if (params?.query) query.set('query', params.query);

  return query;
}

/** `GET /leads/:id`: only `with`. */
export function buildLeadByIdQuery(params?: { with?: string }): URLSearchParams {
  const query = new URLSearchParams();

  if (params?.with) query.set('with', params.with);

  return query;
}

/** `GET /users`: paging only. */
export function buildUserListQuery(params?: AmoCRMPageQuery): URLSearchParams {
  const query = new URLSearchParams();

  setPaging(query, params);

  return query;
}

/** `completed` when it is a boolean, else `completedOnly` when that is, else no filter. */
function resolveCompletedFilter(params: AmoCRMTaskQuery | undefined): boolean | null {
  if (typeof params?.completed === 'boolean') return params.completed;
  if (typeof params?.completedOnly === 'boolean') return params.completedOnly;

  return null;
}

/** `GET /tasks`: the updated-at window first, then paging, responsible users, completion, due window, entity type. */
export function buildTaskListQuery(params?: AmoCRMTaskQuery): URLSearchParams {
  const query = new URLSearchParams();

  setTimeWindow(query, 'updated_at', params?.updatedAtFrom, params?.updatedAtTo);
  setPaging(query, params);
  appendEach(query, 'filter[responsible_user_id][]', params?.responsibleUserIds);
  const completed = resolveCompletedFilter(params);

  if (completed !== null) query.set('filter[is_completed]', completed ? '1' : '0');
  setTimeWindow(query, 'complete_till', params?.dateFrom, params?.dateTo);
  if (params?.entityType) query.set('filter[entity_type]', params.entityType);

  return query;
}

/** `GET /<entity>/notes`: optional oldest-updated-first order, paging (at most 250), note types, entities, updated window. */
export function buildNoteListQuery(params?: AmoCRMNoteQuery): URLSearchParams {
  const query = new URLSearchParams();

  if (params?.orderByUpdatedAsc) query.set('order[updated_at]', 'asc');
  setPaging(query, { page: params?.page, limit: params?.limit && Math.min(params.limit, AMOCRM_MAX_PAGE_SIZE) });
  appendEach(query, 'filter[note_type][]', params?.noteTypes);
  appendEach(query, 'filter[entity_id][]', params?.entityIds);
  setTimeWindow(query, 'updated_at', params?.updatedAtFrom, params?.updatedAtTo);

  return query;
}

/** `GET /events`: paging, created-at window, authors (`filter[created_by][]`), entity. */
export function buildEventListQuery(params?: AmoCRMEventQuery): URLSearchParams {
  const query = new URLSearchParams();

  setPaging(query, params);
  setTimeWindow(query, 'created_at', params?.dateFrom, params?.dateTo);
  appendEach(query, 'filter[created_by][]', params?.userIds);
  if (params?.entityType) query.set('filter[entity]', params.entityType);

  return query;
}
