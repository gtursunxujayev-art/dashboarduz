// AmoCRM integration service (token-based mode only)

import crypto from 'crypto';

import { logger } from '../../lib/logger';
import { asObject } from '../../lib/object';
import { encryptionService, EncryptionService } from '../security/encryption';

import {
  amoGet,
  amoGetWithTimeout,
  amoSendJson,
  hasEmbeddedList,
  rethrowAmoError,
  thrownMessage,
  type AmoFailure,
} from './amocrm-http';
import {
  chunkCreatedByIds,
  clampAmoPageSize,
  collectAmoPages,
  dedupeEventsById,
  resolveAmoMaxPages,
  toAmoPage,
} from './amocrm-paging';
import {
  AMOCRM_MAX_PAGE_SIZE,
  buildContactListQuery,
  buildEventListQuery,
  buildLeadByIdQuery,
  buildLeadListQuery,
  buildNoteListQuery,
  buildTaskListQuery,
  buildUserListQuery,
  withQueryString,
} from './amocrm-query';
import type {
  AmoCRMAccountInfo,
  AmoCRMContactQuery,
  AmoCRMEvent,
  AmoCRMEventListResponse,
  AmoCRMEventQuery,
  AmoCRMLead,
  AmoCRMLeadCustomFieldsResponse,
  AmoCRMLeadListResponse,
  AmoCRMLeadPayload,
  AmoCRMLeadPipelinesResponse,
  AmoCRMLeadQuery,
  AmoCRMNote,
  AmoCRMNoteEntityType,
  AmoCRMNoteListResponse,
  AmoCRMNoteQuery,
  AmoCRMPageQuery,
  AmoCRMStatusFilter,
  AmoCRMTask,
  AmoCRMTaskListResponse,
  AmoCRMTaskQuery,
  AmoCRMTokens,
  AmoCRMUser,
  AmoCRMUsersResponse,
} from './amocrm-types';

export type {
  AmoCRMAccountInfo,
  AmoCRMContactQuery,
  AmoCRMEvent,
  AmoCRMEventListResponse,
  AmoCRMEventQuery,
  AmoCRMLead,
  AmoCRMLeadCustomFieldsResponse,
  AmoCRMLeadListResponse,
  AmoCRMLeadPayload,
  AmoCRMLeadPipeline,
  AmoCRMLeadPipelineStatus,
  AmoCRMLeadPipelinesResponse,
  AmoCRMLeadQuery,
  AmoCRMListLinks,
  AmoCRMNote,
  AmoCRMNoteEntityType,
  AmoCRMNoteListResponse,
  AmoCRMNoteQuery,
  AmoCRMPageQuery,
  AmoCRMStatusFilter,
  AmoCRMTask,
  AmoCRMTaskListResponse,
  AmoCRMTaskQuery,
  AmoCRMTokens,
  AmoCRMUser,
  AmoCRMUsersResponse,
} from './amocrm-types';

/** amoCRM docs disagree on the events page size (100 in RU docs, 250 in EN); stay within the safe bound. */
const AMOCRM_EVENTS_MAX_PAGE_SIZE = 100;

const failure = (logMessage: string, failureMessage: string, logContext?: Record<string, unknown>): AmoFailure => (
  { logMessage, failureMessage, logContext }
);

/** The signature header as bytes: hex when it is all hex digits, else base64; null when it cannot be decoded. */
function decodeWebhookSignature(signature: string): Buffer | null {
  if (/^[a-fA-F0-9]+$/.test(signature)) {
    return Buffer.from(signature, 'hex');
  }
  try {
    return Buffer.from(signature, 'base64');
  } catch {
    return null;
  }
}

export class AmoCRMService {
  private defaultBaseUrl: string;
  private webhookSecret: string;
  private readonly requestTimeoutMs: number;

  constructor() {
    this.defaultBaseUrl = process.env.AMOCRM_BASE_URL || 'https://www.amocrm.ru';
    this.webhookSecret = process.env.AMOCRM_WEBHOOK_SECRET || '';
    this.requestTimeoutMs = Number(process.env.AMOCRM_REQUEST_TIMEOUT_MS || 10000);

    if (!this.webhookSecret && process.env.NODE_ENV === 'production') {
      logger.warn('AMOCRM_WEBHOOK_SECRET not set in production');
    }
  }

  private resolveBaseUrl(baseUrl?: string): string {
    return (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
  }

  /** `<base>/api/v4/<path>[?query]`. */
  private apiUrl(baseUrl: string | undefined, path: string, query = new URLSearchParams()): string {
    return withQueryString(`${this.resolveBaseUrl(baseUrl)}/api/v4/${path}`, query);
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
      const expected = Buffer.from(EncryptionService.generateHMAC(payloadString, this.webhookSecret), 'hex');
      const provided = decodeWebhookSignature(signature.trim());

      if (!provided || provided.length !== expected.length) {
        logger.warn('Invalid AmoCRM webhook signature format/length');

        return false;
      }

      const isValid = crypto.timingSafeEqual(provided, expected);

      if (!isValid) {
        logger.warn('Invalid AmoCRM webhook signature');
      }

      return isValid;
    } catch (error: unknown) {
      logger.error({ error: thrownMessage(error) }, 'AmoCRM webhook signature verification error');

      return false;
    }
  }

  async fetchAccountInfo(accessToken: string, baseUrl?: string): Promise<AmoCRMAccountInfo> {
    const response = await amoGetWithTimeout(
      this.apiUrl(baseUrl, 'account'),
      accessToken,
      failure('AmoCRM account fetch error', 'Failed to fetch AmoCRM account'),
      this.requestTimeoutMs,
    );

    return (await response.json()) as AmoCRMAccountInfo;
  }

  async fetchLeads(accessToken: string, _accountId: string, params?: AmoCRMLeadQuery, baseUrl?: string): Promise<AmoCRMLeadListResponse> {
    try {
      const response = await amoGet(
        this.apiUrl(baseUrl, 'leads', buildLeadListQuery(params)),
        accessToken,
        failure('AmoCRM fetch leads error', 'Failed to fetch leads from AmoCRM'),
      );

      // amoCRM answers an empty result set (or a page past the end) with 204 No Content.
      if (response.status === 204) {
        return { _embedded: { leads: [] } };
      }

      const data: unknown = await response.json();

      if (!hasEmbeddedList(data, 'leads')) {
        throw new Error('Invalid response structure from AmoCRM');
      }

      return data as AmoCRMLeadListResponse;
    } catch (error: unknown) {
      return rethrowAmoError(error, 'AmoCRM fetch leads error', 'Failed to fetch AmoCRM leads');
    }
  }

  async fetchContacts(accessToken: string, _accountId: string, params?: AmoCRMContactQuery, baseUrl?: string): Promise<Record<string, unknown>> {
    try {
      const response = await amoGet(
        this.apiUrl(baseUrl, 'contacts', buildContactListQuery(params)),
        accessToken,
        failure('AmoCRM fetch contacts error', 'Failed to fetch contacts from AmoCRM'),
      );
      const body = asObject(await response.json());

      if (!body || !hasEmbeddedList(body, 'contacts')) {
        throw new Error('Invalid response structure from AmoCRM');
      }

      return body;
    } catch (error: unknown) {
      return rethrowAmoError(error, 'AmoCRM fetch contacts error', 'Failed to fetch AmoCRM contacts');
    }
  }

  async fetchLeadCustomFields(accessToken: string, baseUrl?: string): Promise<AmoCRMLeadCustomFieldsResponse> {
    const response = await amoGet(
      this.apiUrl(baseUrl, 'leads/custom_fields'),
      accessToken,
      failure('AmoCRM lead custom fields fetch error', 'Failed to fetch AmoCRM lead custom fields'),
    );

    return (await response.json()) as AmoCRMLeadCustomFieldsResponse;
  }

  async fetchPipelines(accessToken: string, baseUrl?: string): Promise<AmoCRMLeadPipelinesResponse> {
    try {
      const response = await amoGetWithTimeout(
        this.apiUrl(baseUrl, 'leads/pipelines'),
        accessToken,
        failure('AmoCRM pipelines fetch error', 'Failed to fetch AmoCRM pipelines'),
        this.requestTimeoutMs,
      );

      return (await response.json()) as AmoCRMLeadPipelinesResponse;
    } catch (error: unknown) {
      const message = thrownMessage(error);

      logger.error({ error: message || String(error) }, 'AmoCRM pipelines fetch exception');
      throw new Error(`Failed to fetch AmoCRM pipelines: ${String(message || 'unknown_error')}`);
    }
  }

  async fetchLeadById(accessToken: string, leadId: string, params?: {
    with?: string;
  }, baseUrl?: string): Promise<AmoCRMLead> {
    const response = await amoGet(
      this.apiUrl(baseUrl, `leads/${leadId}`, buildLeadByIdQuery(params)),
      accessToken,
      failure('AmoCRM lead fetch by id error', 'Failed to fetch AmoCRM lead', { leadId }),
    );

    return (await response.json()) as AmoCRMLead;
  }

  async fetchAllLeads(accessToken: string, params?: {
    pipelineIds?: string[] | null;
    statusFilters?: AmoCRMStatusFilter[] | null;
    responsibleUserIds?: string[] | null;
    query?: string;
    createdAtFrom?: Date;
    createdAtTo?: Date;
    with?: string;
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMLead[]> {
    const pageSize = clampAmoPageSize(params?.limit, AMOCRM_MAX_PAGE_SIZE, AMOCRM_MAX_PAGE_SIZE);

    return collectAmoPages(pageSize, resolveAmoMaxPages(params?.maxPages, 1000), async (page) => {
      const response = await this.fetchLeads(accessToken, '', {
        page,
        limit: pageSize,
        with: params?.with,
        query: params?.query,
        pipelineIds: params?.pipelineIds || undefined,
        statusFilters: params?.statusFilters || undefined,
        responsibleUserIds: params?.responsibleUserIds || undefined,
        createdAtFrom: params?.createdAtFrom,
        createdAtTo: params?.createdAtTo,
      }, baseUrl);

      return toAmoPage(response._embedded?.leads, response._links);
    });
  }

  async fetchUsers(accessToken: string, params?: AmoCRMPageQuery, baseUrl?: string): Promise<AmoCRMUsersResponse> {
    const response = await amoGet(
      this.apiUrl(baseUrl, 'users', buildUserListQuery(params)),
      accessToken,
      failure('AmoCRM users fetch error', 'Failed to fetch AmoCRM users'),
    );

    return (await response.json()) as AmoCRMUsersResponse;
  }

  async fetchAllUsers(accessToken: string, params?: {
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMUser[]> {
    const pageSize = clampAmoPageSize(params?.limit, AMOCRM_MAX_PAGE_SIZE, AMOCRM_MAX_PAGE_SIZE);

    return collectAmoPages(pageSize, resolveAmoMaxPages(params?.maxPages, 50), async (page) => {
      const response = await this.fetchUsers(accessToken, { page, limit: pageSize }, baseUrl);

      return toAmoPage(response._embedded?.users, response._links);
    });
  }

  async fetchTasks(accessToken: string, params?: AmoCRMTaskQuery, baseUrl?: string): Promise<AmoCRMTaskListResponse> {
    // A stalled page used to hang for minutes (no timeout) and hold up the whole paging loop.
    const response = await amoGetWithTimeout(
      this.apiUrl(baseUrl, 'tasks', buildTaskListQuery(params)),
      accessToken,
      failure('AmoCRM tasks fetch error', 'Failed to fetch AmoCRM tasks'),
      params?.timeoutMs ?? this.requestTimeoutMs,
    );

    // amoCRM answers an empty result set with 204 No Content (no JSON body).
    if (response.status === 204) {
      return {};
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
    const pageSize = clampAmoPageSize(params?.limit, AMOCRM_MAX_PAGE_SIZE, AMOCRM_MAX_PAGE_SIZE);

    return collectAmoPages(pageSize, resolveAmoMaxPages(params?.maxPages, 100), async (page) => {
      const response = await this.fetchTasks(accessToken, {
        page,
        limit: pageSize,
        responsibleUserIds: params?.responsibleUserIds || undefined,
        completed: params?.completed,
        completedOnly: params?.completedOnly,
        dateFrom: params?.dateFrom,
        dateTo: params?.dateTo,
        entityType: params?.entityType,
      }, baseUrl);

      return toAmoPage(response._embedded?.tasks, response._links);
    });
  }

  /** One page of notes of an entity type (e.g. call notes on leads or contacts). */
  async fetchNotes(accessToken: string, entityType: AmoCRMNoteEntityType, params?: AmoCRMNoteQuery, baseUrl?: string): Promise<AmoCRMNote[]> {
    const response = await amoGetWithTimeout(
      this.apiUrl(baseUrl, `${entityType}/notes`, buildNoteListQuery(params)),
      accessToken,
      failure('AmoCRM notes fetch error', 'Failed to fetch AmoCRM notes', { entityType }),
      this.requestTimeoutMs,
    );

    if (response.status === 204) {
      return [];
    }

    const data = (await response.json()) as AmoCRMNoteListResponse;

    return Array.isArray(data._embedded?.notes) ? data._embedded.notes : [];
  }

  async fetchEvents(accessToken: string, params?: AmoCRMEventQuery, baseUrl?: string): Promise<AmoCRMEventListResponse> {
    // A stalled page used to hang for minutes (no timeout) and hold up the whole paging loop.
    const response = await amoGetWithTimeout(
      this.apiUrl(baseUrl, 'events', buildEventListQuery(params)),
      accessToken,
      failure('AmoCRM events fetch error', 'Failed to fetch AmoCRM events'),
      params?.timeoutMs ?? this.requestTimeoutMs,
    );

    // amoCRM answers an empty result set with 204 No Content (no JSON body).
    if (response.status === 204) {
      return {};
    }

    return (await response.json()) as AmoCRMEventListResponse;
  }

  /** Events of all pages, querying the users in chunks amoCRM accepts; an event seen twice is kept once. */
  async fetchAllEvents(accessToken: string, params?: {
    dateFrom?: Date;
    dateTo?: Date;
    userIds?: string[] | null;
    entityType?: string;
    limit?: number;
    maxPages?: number;
  }, baseUrl?: string): Promise<AmoCRMEvent[]> {
    const pageSize = clampAmoPageSize(params?.limit, AMOCRM_EVENTS_MAX_PAGE_SIZE, AMOCRM_EVENTS_MAX_PAGE_SIZE);
    const maxPages = resolveAmoMaxPages(params?.maxPages, 100);
    const allEvents: AmoCRMEvent[] = [];

    for (const userIds of chunkCreatedByIds(params?.userIds)) {
      const events = await collectAmoPages(pageSize, maxPages, async (page) => {
        const response = await this.fetchEvents(accessToken, {
          page,
          limit: pageSize,
          dateFrom: params?.dateFrom,
          dateTo: params?.dateTo,
          userIds,
          entityType: params?.entityType,
        }, baseUrl);

        return toAmoPage(response._embedded?.events, response._links);
      });

      allEvents.push(...events);
    }

    return dedupeEventsById(allEvents);
  }

  async createLead(accessToken: string, leadData: AmoCRMLeadPayload, baseUrl?: string): Promise<unknown> {
    try {
      return await amoSendJson(
        this.apiUrl(baseUrl, 'leads'),
        accessToken,
        'POST',
        [leadData],
        failure('AmoCRM create lead error', 'Failed to create lead in AmoCRM'),
      );
    } catch (error: unknown) {
      return rethrowAmoError(error, 'AmoCRM create lead error', 'Failed to create AmoCRM lead');
    }
  }

  async updateLead(accessToken: string, leadId: number, leadData: AmoCRMLeadPayload, baseUrl?: string): Promise<unknown> {
    try {
      return await amoSendJson(
        this.apiUrl(baseUrl, `leads/${leadId}`),
        accessToken,
        'PATCH',
        leadData,
        failure('AmoCRM update lead error', 'Failed to update lead in AmoCRM'),
      );
    } catch (error: unknown) {
      return rethrowAmoError(error, 'AmoCRM update lead error', 'Failed to update AmoCRM lead');
    }
  }

  encryptTokens(tokens: AmoCRMTokens): string | null {
    try {
      const encrypted = encryptionService.encryptJSON(tokens);

      if (!encrypted) {
        throw new Error('Failed to encrypt tokens');
      }

      return encrypted;
    } catch (error: unknown) {
      logger.error({ error: thrownMessage(error) }, 'Failed to encrypt AmoCRM tokens');

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
    } catch (error: unknown) {
      logger.error({ error: thrownMessage(error) }, 'Failed to decrypt AmoCRM tokens');

      return null;
    }
  }
}

export const amocrmService = new AmoCRMService();
