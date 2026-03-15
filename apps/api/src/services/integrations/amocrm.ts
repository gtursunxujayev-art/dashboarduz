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
  }, baseUrl?: string) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.with) queryParams.set('with', params.with);

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

      const data = await response.json();
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
