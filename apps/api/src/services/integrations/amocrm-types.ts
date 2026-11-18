/**
 * Shapes of the amoCRM v4 API payloads we read, and of the query options our client accepts.
 * `amocrm.ts` re-exports all of them, so callers keep importing from there.
 */

export interface AmoCRMTokens {
  access_token: string;
  token_type?: string;
  source?: 'long_lived_token';
}

export interface AmoCRMAccountInfo {
  id?: number | string;
  name?: string;
  domain?: string;
  subdomain?: string;
}

/** The `_links` block of a paged list; a `next.href` means another page exists. */
export interface AmoCRMListLinks {
  next?: {
    href?: string;
  };
}

export interface AmoCRMLeadCustomFieldsResponse {
  _embedded?: {
    custom_fields?: Array<{
      id?: number | string;
      name?: string;
      code?: string;
    }>;
  };
}

export interface AmoCRMLeadPipelineStatus {
  id?: number | string;
  name?: string;
  sort?: number;
  type?: number;
}

export interface AmoCRMLeadPipeline {
  id?: number | string;
  name?: string;
  sort?: number;
  _embedded?: {
    statuses?: AmoCRMLeadPipelineStatus[];
  };
}

export interface AmoCRMLeadPipelinesResponse {
  _embedded?: {
    pipelines?: AmoCRMLeadPipeline[];
  };
}

export interface AmoCRMUser {
  id?: number | string;
  name?: string;
  email?: string;
  login?: string;
  is_active?: boolean;
  rights?: {
    is_admin?: boolean;
  };
}

export interface AmoCRMUsersResponse {
  _embedded?: {
    users?: AmoCRMUser[];
  };
  _links?: AmoCRMListLinks;
}

export interface AmoCRMLead {
  id?: number | string;
  name?: string;
  status_id?: number | string;
  pipeline_id?: number | string;
  source_id?: number | string;
  loss_reason_id?: number | string;
  responsible_user_id?: number | string;
  created_at?: number | string;
  updated_at?: number | string;
  custom_fields_values?: Array<{
    field_id?: number | string;
    field_name?: string;
    field_code?: string;
    values?: Array<{
      value?: unknown;
    }>;
  }>;
  _embedded?: {
    contacts?: Array<Record<string, unknown>>;
  };
  [key: string]: unknown;
}

export interface AmoCRMLeadListResponse {
  _embedded?: {
    leads?: AmoCRMLead[];
  };
  _links?: AmoCRMListLinks;
}

/** A lead as sent to `POST /leads` or `PATCH /leads/:id` (amoCRM field names). */
export type AmoCRMLeadPayload = Record<string, unknown>;

export interface AmoCRMTask {
  id?: number | string;
  responsible_user_id?: number | string;
  entity_type?: string;
  is_completed?: boolean | number;
  complete_till?: number | string;
  updated_at?: number | string;
  created_at?: number | string;
  [key: string]: unknown;
}

export interface AmoCRMTaskListResponse {
  _embedded?: {
    tasks?: AmoCRMTask[];
  };
  _links?: AmoCRMListLinks;
}

export interface AmoCRMEvent {
  id?: number | string;
  type?: string;
  created_at?: number | string;
  created_by?: number | string;
  entity_type?: string;
  [key: string]: unknown;
}

export interface AmoCRMNote {
  id?: number | string;
  entity_id?: number | string;
  note_type?: string;
  created_at?: number | string;
  updated_at?: number | string;
  created_by?: number | string;
  responsible_user_id?: number | string;
  params?: {
    duration?: number | string;
    phone?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AmoCRMNoteListResponse {
  _embedded?: {
    notes?: AmoCRMNote[];
  };
}

export interface AmoCRMEventListResponse {
  _embedded?: {
    events?: AmoCRMEvent[];
  };
  _links?: AmoCRMListLinks;
}

/** `page` / `limit` of a paged list request (each is sent only when truthy). */
export interface AmoCRMPageQuery {
  page?: number;
  limit?: number;
}

/** One `filter[statuses][]` entry: a status within a pipeline. */
export interface AmoCRMStatusFilter {
  pipelineId: string;
  statusId: string;
}

export interface AmoCRMLeadQuery extends AmoCRMPageQuery {
  with?: string;
  query?: string;
  pipelineIds?: string[];
  statusFilters?: AmoCRMStatusFilter[];
  responsibleUserIds?: string[];
  createdAtFrom?: Date;
  createdAtTo?: Date;
  updatedAtFrom?: Date;
  order?: { field: 'id' | 'created_at' | 'updated_at'; direction: 'asc' | 'desc' };
}

export interface AmoCRMContactQuery extends AmoCRMPageQuery {
  query?: string;
}

export interface AmoCRMTaskQuery extends AmoCRMPageQuery {
  responsibleUserIds?: string[];
  /** Wins over `completedOnly` when both are booleans. */
  completed?: boolean;
  completedOnly?: boolean;
  /** `complete_till` window. */
  dateFrom?: Date;
  dateTo?: Date;
  entityType?: string;
  /** Tasks changed in this window (used by the snapshot job). */
  updatedAtFrom?: Date;
  updatedAtTo?: Date;
  /** Per-request limit; background jobs can afford to wait longer than a page. */
  timeoutMs?: number;
}

export type AmoCRMNoteEntityType = 'leads' | 'contacts' | 'companies';

export interface AmoCRMNoteQuery extends AmoCRMPageQuery {
  noteTypes?: string[];
  entityIds?: string[];
  updatedAtFrom?: Date;
  updatedAtTo?: Date;
  /** Oldest-updated first, so a capped run can resume from the last note it saw. */
  orderByUpdatedAsc?: boolean;
}

export interface AmoCRMEventQuery extends AmoCRMPageQuery {
  /** `created_at` window. */
  dateFrom?: Date;
  dateTo?: Date;
  userIds?: string[];
  entityType?: string;
  /** Per-request limit; background jobs can afford to wait longer than a page. */
  timeoutMs?: number;
}
