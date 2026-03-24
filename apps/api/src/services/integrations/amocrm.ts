// AmoCRM integration service (token-based mode only)

import crypto from 'crypto';
import { encryptionService, EncryptionService } from '../security/encryption';
import { logger } from '../../lib/logger';

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
  _links?: {
    next?: {
      href?: string;
    };
  };
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
  _links?: {
    next?: {
      href?: string;
    };
  };
}

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
  _links?: {
    next?: {
      href?: string;
    };
  };
}

export interface AmoCRMEvent {
  id?: number | string;
  type?: string;
  created_at?: number | string;
  created_by?: number | string;
  entity_type?: string;
  [key: string]: unknown;
}

export interface AmoCRMEventListResponse {
  _embedded?: {
    events?: AmoCRMEvent[];
  };
  _links?: {
    next?: {
      href?: string;
    };
  };
}

export class AmoCRMService {
  private defaultBaseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.defaultBaseUrl = process.env.AMOCRM_BASE_URL || 'https://www.amocrm.ru';
    this.webhookSecret = process.env.AMOCRM_WEBHOOK_SECRET || '';

    if (!this.webhookSecret && process.env.NODE_ENV === 'production') {
      logger.warn('AMOCRM_WEBHOOK_SECRET not set in production');
    }
  }

  private resolveBaseUrl(baseUrl?: string): string {
    return (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
  }

  // Verify webhook signature using HMAC-SHA256.
  verifyWebhookSignature(payload: string | Buffer, signature: string | undefined): boolean {
    try {
      if (process.env.NODE_ENV !== 'production' && !signature && !this.webhookSecret) {
        logger.warn('Skipping AmoCRM webhook signature verification in development mode');
        return true;
      }

      if (!signature) {
        logger.warn('Missing AmoCRM webhook signature header');
        return false;
      }

      if (!this.webhookSecret) {
        logger.error('AMOCRM_WEBHOOK_SECRET not configured');
        return false;
      }

      const payloadString = typeof payload === 'string' ? payload : payload.toString('utf8');
      const expectedHex = EncryptionService.generateHMAC(payloadString, this.webhookSecret);
      const normalizedSignature = signature.trim();
      const expectedBufferHex = Buffer.from(expectedHex, 'hex');

      let providedBuffer: Buffer | null = null;
      if (/^[a-fA-F0-9]+$/.test(normalizedSignature)) {
        providedBuffer = Buffer.from(normalizedSignature, 'hex');
      } else {
        try {
          providedBuffer = Buffer.from(normalizedSignature, 'base64');
        } catch {
          providedBuffer = null;
        }
      }

      if (!providedBuffer || providedBuffer.length !== expectedBufferHex.length) {
        logger.warn('Invalid AmoCRM webhook signature format/length');
        return false;
      }

      const isValid = crypto.timingSafeEqual(providedBuffer, expectedBufferHex);
      if (!isValid) {
        logger.warn('Invalid AmoCRM webhook signature');
      }

      return isValid;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM webhook signature verification error');
      return false;
    }
  }

  async fetchAccountInfo(accessToken: string, baseUrl?: string): Promise<AmoCRMAccountInfo> {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const response = await fetch(`${resolvedBaseUrl}/api/v4/account`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM account fetch error');
      throw new Error(`Failed to fetch AmoCRM account: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMAccountInfo;
  }

  async fetchLeads(accessToken: string, _accountId: string, params?: {
    page?: number;
    limit?: number;
    with?: string;
    query?: string;
    pipelineIds?: string[];
    statusFilters?: Array<{
      pipelineId: string;
      statusId: string;
    }>;
    responsibleUserIds?: string[];
    createdAtFrom?: Date;
    createdAtTo?: Date;
  }, baseUrl?: string) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.with) queryParams.set('with', params.with);
      if (params?.query) queryParams.set('query', params.query);
      if (params?.pipelineIds) {
        params.pipelineIds.forEach((pipelineId) => {
          queryParams.append('filter[pipeline_id][]', pipelineId);
        });
      }
      if (params?.statusFilters) {
        params.statusFilters.forEach((statusFilter, index) => {
          queryParams.append(`filter[statuses][${index}][pipeline_id]`, statusFilter.pipelineId);
          queryParams.append(`filter[statuses][${index}][status_id]`, statusFilter.statusId);
        });
      }
      if (params?.responsibleUserIds) {
        params.responsibleUserIds.forEach((responsibleUserId) => {
          queryParams.append('filter[responsible_user_id][]', responsibleUserId);
        });
      }
      if (params?.createdAtFrom) {
        queryParams.set('filter[created_at][from]', Math.floor(params.createdAtFrom.getTime() / 1000).toString());
      }
      if (params?.createdAtTo) {
        queryParams.set('filter[created_at][to]', Math.floor(params.createdAtTo.getTime() / 1000).toString());
      }

      const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
      const url = `${resolvedBaseUrl}/api/v4/leads${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM fetch leads error');
        throw new Error(`Failed to fetch leads from AmoCRM: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as AmoCRMLeadListResponse;
      if (!data._embedded || !data._embedded.leads) {
        throw new Error('Invalid response structure from AmoCRM');
      }

      return data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM fetch leads error');
      throw new Error(`Failed to fetch AmoCRM leads: ${error.message}`);
    }
  }

  async fetchContacts(accessToken: string, _accountId: string, params?: {
    page?: number;
    limit?: number;
    query?: string;
  }, baseUrl?: string) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.query) queryParams.set('query', params.query);

      const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
      const url = `${resolvedBaseUrl}/api/v4/contacts${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM fetch contacts error');
        throw new Error(`Failed to fetch contacts from AmoCRM: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!data._embedded || !data._embedded.contacts) {
        throw new Error('Invalid response structure from AmoCRM');
      }

      return data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM fetch contacts error');
      throw new Error(`Failed to fetch AmoCRM contacts: ${error.message}`);
    }
  }

  async fetchLeadCustomFields(accessToken: string, baseUrl?: string): Promise<AmoCRMLeadCustomFieldsResponse> {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const response = await fetch(`${resolvedBaseUrl}/api/v4/leads/custom_fields`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM lead custom fields fetch error');
      throw new Error(`Failed to fetch AmoCRM lead custom fields: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMLeadCustomFieldsResponse;
  }

  async fetchPipelines(accessToken: string, baseUrl?: string): Promise<AmoCRMLeadPipelinesResponse> {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const response = await fetch(`${resolvedBaseUrl}/api/v4/leads/pipelines`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM pipelines fetch error');
      throw new Error(`Failed to fetch AmoCRM pipelines: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMLeadPipelinesResponse;
  }

  async fetchLeadById(accessToken: string, leadId: string, params?: {
    with?: string;
  }, baseUrl?: string): Promise<AmoCRMLead> {
    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const queryParams = new URLSearchParams();
    if (params?.with) {
      queryParams.set('with', params.with);
    }
    const url = `${resolvedBaseUrl}/api/v4/leads/${leadId}${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status, leadId }, 'AmoCRM lead fetch by id error');
      throw new Error(`Failed to fetch AmoCRM lead: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMLead;
  }

  async fetchAllLeads(accessToken: string, params?: {
    pipelineIds?: string[] | null;
    statusFilters?: Array<{
      pipelineId: string;
      statusId: string;
    }> | null;
    responsibleUserIds?: string[] | null;
    query?: string;
    createdAtFrom?: Date;
    createdAtTo?: Date;
    with?: string;
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMLead[]> {
    const pageSize = Math.min(Math.max(params?.limit || 250, 1), 250);
    const maxPages = Math.max(params?.maxPages || 1000, 1);

    const allLeads: AmoCRMLead[] = [];
    let page = 1;

    while (page <= maxPages) {
      const response = await this.fetchLeads(
        accessToken,
        '',
        {
          page,
          limit: pageSize,
          with: params?.with,
          query: params?.query,
          pipelineIds: params?.pipelineIds || undefined,
          statusFilters: params?.statusFilters || undefined,
          responsibleUserIds: params?.responsibleUserIds || undefined,
          createdAtFrom: params?.createdAtFrom,
          createdAtTo: params?.createdAtTo,
        },
        baseUrl,
      );

      const leads = Array.isArray(response._embedded?.leads) ? response._embedded?.leads : [];
      allLeads.push(...leads);

      const hasNext = Boolean(response._links?.next?.href);
      if (!hasNext || leads.length < pageSize) {
        break;
      }

      page += 1;
    }

    return allLeads;
  }

  async fetchUsers(accessToken: string, params?: {
    page?: number;
    limit?: number;
  }, baseUrl?: string): Promise<AmoCRMUsersResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.limit) queryParams.set('limit', params.limit.toString());

    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const url = `${resolvedBaseUrl}/api/v4/users${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM users fetch error');
      throw new Error(`Failed to fetch AmoCRM users: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMUsersResponse;
  }

  async fetchAllUsers(accessToken: string, params?: {
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMUser[]> {
    const pageSize = Math.min(Math.max(params?.limit || 250, 1), 250);
    const maxPages = Math.max(params?.maxPages || 50, 1);
    const allUsers: AmoCRMUser[] = [];

    let page = 1;
    while (page <= maxPages) {
      const response = await this.fetchUsers(accessToken, { page, limit: pageSize }, baseUrl);
      const users = Array.isArray(response._embedded?.users) ? response._embedded.users : [];
      allUsers.push(...users);

      const hasNext = Boolean(response._links?.next?.href);
      if (!hasNext || users.length < pageSize) {
        break;
      }
      page += 1;
    }

    return allUsers;
  }

  async fetchTasks(accessToken: string, params?: {
    page?: number;
    limit?: number;
    responsibleUserIds?: string[];
    completed?: boolean;
    completedOnly?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    entityType?: string;
  }, baseUrl?: string): Promise<AmoCRMTaskListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.responsibleUserIds?.length) {
      params.responsibleUserIds.forEach((responsibleUserId) => {
        queryParams.append('filter[responsible_user_id][]', responsibleUserId);
      });
    }
    const completedFilter = typeof params?.completed === 'boolean'
      ? params.completed
      : (typeof params?.completedOnly === 'boolean' ? params.completedOnly : null);
    if (completedFilter !== null) {
      queryParams.set('filter[is_completed]', completedFilter ? '1' : '0');
    }
    if (params?.dateFrom) {
      queryParams.set('filter[complete_till][from]', Math.floor(params.dateFrom.getTime() / 1000).toString());
    }
    if (params?.dateTo) {
      queryParams.set('filter[complete_till][to]', Math.floor(params.dateTo.getTime() / 1000).toString());
    }
    if (params?.entityType) {
      queryParams.set('filter[entity_type]', params.entityType);
    }

    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const url = `${resolvedBaseUrl}/api/v4/tasks${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM tasks fetch error');
      throw new Error(`Failed to fetch AmoCRM tasks: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMTaskListResponse;
  }

  async fetchAllTasks(accessToken: string, params?: {
    responsibleUserIds?: string[] | null;
    completed?: boolean;
    completedOnly?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    entityType?: string;
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMTask[]> {
    const pageSize = Math.min(Math.max(params?.limit || 250, 1), 250);
    const maxPages = Math.max(params?.maxPages || 100, 1);
    const allTasks: AmoCRMTask[] = [];

    let page = 1;
    while (page <= maxPages) {
      const response = await this.fetchTasks(
        accessToken,
        {
          page,
          limit: pageSize,
          responsibleUserIds: params?.responsibleUserIds || undefined,
          completed: params?.completed,
          completedOnly: params?.completedOnly,
          dateFrom: params?.dateFrom,
          dateTo: params?.dateTo,
          entityType: params?.entityType,
        },
        baseUrl,
      );
      const tasks = Array.isArray(response._embedded?.tasks) ? response._embedded.tasks : [];
      allTasks.push(...tasks);

      const hasNext = Boolean(response._links?.next?.href);
      if (!hasNext || tasks.length < pageSize) {
        break;
      }
      page += 1;
    }

    return allTasks;
  }

  async fetchEvents(accessToken: string, params?: {
    page?: number;
    limit?: number;
    dateFrom?: Date;
    dateTo?: Date;
    userIds?: string[];
    entityType?: string;
  }, baseUrl?: string): Promise<AmoCRMEventListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    if (params?.dateFrom) {
      queryParams.set('filter[created_at][from]', Math.floor(params.dateFrom.getTime() / 1000).toString());
    }
    if (params?.dateTo) {
      queryParams.set('filter[created_at][to]', Math.floor(params.dateTo.getTime() / 1000).toString());
    }
    if (params?.userIds?.length) {
      params.userIds.forEach((userId) => {
        queryParams.append('filter[created_by][]', userId);
      });
    }
    if (params?.entityType) {
      queryParams.set('filter[entity]', params.entityType);
    }

    const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
    const url = `${resolvedBaseUrl}/api/v4/events${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ error: errorText, status: response.status }, 'AmoCRM events fetch error');
      throw new Error(`Failed to fetch AmoCRM events: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as AmoCRMEventListResponse;
  }

  async fetchAllEvents(accessToken: string, params?: {
    dateFrom?: Date;
    dateTo?: Date;
    userIds?: string[] | null;
    entityType?: string;
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMEvent[]> {
    const pageSize = Math.min(Math.max(params?.limit || 250, 1), 250);
    const maxPages = Math.max(params?.maxPages || 100, 1);
    const allEvents: AmoCRMEvent[] = [];

    let page = 1;
    while (page <= maxPages) {
      const response = await this.fetchEvents(
        accessToken,
        {
          page,
          limit: pageSize,
          dateFrom: params?.dateFrom,
          dateTo: params?.dateTo,
          userIds: params?.userIds || undefined,
          entityType: params?.entityType,
        },
        baseUrl,
      );
      const events = Array.isArray(response._embedded?.events) ? response._embedded.events : [];
      allEvents.push(...events);

      const hasNext = Boolean(response._links?.next?.href);
      if (!hasNext || events.length < pageSize) {
        break;
      }
      page += 1;
    }

    return allEvents;
  }

  async createLead(accessToken: string, leadData: any, baseUrl?: string) {
    try {
      const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
      const response = await fetch(`${resolvedBaseUrl}/api/v4/leads`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([leadData]),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM create lead error');
        throw new Error(`Failed to create lead in AmoCRM: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM create lead error');
      throw new Error(`Failed to create AmoCRM lead: ${error.message}`);
    }
  }

  async updateLead(accessToken: string, leadId: number, leadData: any, baseUrl?: string) {
    try {
      const resolvedBaseUrl = this.resolveBaseUrl(baseUrl);
      const response = await fetch(`${resolvedBaseUrl}/api/v4/leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(leadData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM update lead error');
        throw new Error(`Failed to update lead in AmoCRM: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM update lead error');
      throw new Error(`Failed to update AmoCRM lead: ${error.message}`);
    }
  }

  encryptTokens(tokens: AmoCRMTokens): string | null {
    try {
      const encrypted = encryptionService.encryptJSON(tokens);
      if (!encrypted) {
        throw new Error('Failed to encrypt tokens');
      }
      return encrypted;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to encrypt AmoCRM tokens');
      return null;
    }
  }

  decryptTokens(encryptedTokens: string): AmoCRMTokens | null {
    try {
      const tokens = encryptionService.decryptJSON<AmoCRMTokens>(encryptedTokens);
      if (!tokens) {
        throw new Error('Failed to decrypt tokens');
      }
      return tokens;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to decrypt AmoCRM tokens');
      return null;
    }
  }
}

export const amocrmService = new AmoCRMService();
