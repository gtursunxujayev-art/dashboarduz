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
