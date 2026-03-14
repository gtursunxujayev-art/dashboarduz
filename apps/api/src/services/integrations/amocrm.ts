// AmoCRM integration service
// Handles OAuth2, token refresh, webhook processing, and API calls

import crypto from 'crypto';
import { encryptionService, EncryptionService } from '../security/encryption';
import { logger } from '../../lib/logger';

export interface AmoCRMTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  expires_at?: number; // Calculated expiration timestamp
}

export interface AmoCRMIntegrationConfig {
  accountId: string;
  subdomain?: string;
  tokensEncrypted?: string;
  refreshTokenEncrypted?: string;
  expiresAt?: Date;
  lastRefreshedAt?: Date;
}

export interface AmoCRMAccountInfo {
  id?: number | string;
  name?: string;
  domain?: string;
  subdomain?: string;
}

export class AmoCRMService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor() {
    this.clientId = process.env.AMOCRM_CLIENT_ID || '';
    this.clientSecret = process.env.AMOCRM_CLIENT_SECRET || '';
    this.redirectUri = process.env.AMOCRM_REDIRECT_URI || '';
    this.baseUrl = process.env.AMOCRM_BASE_URL || 'https://www.amocrm.ru';
    this.webhookSecret = process.env.AMOCRM_WEBHOOK_SECRET || '';
    
    if (!this.clientId || !this.clientSecret) {
      logger.warn('AmoCRM credentials not fully configured');
    }
    
    if (!this.webhookSecret && process.env.NODE_ENV === 'production') {
      logger.warn('AMOCRM_WEBHOOK_SECRET not set in production');
    }
  }

  // Get OAuth2 authorization URL
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      state: state || '',
    });
    return `${this.baseUrl}/oauth?${params.toString()}`;
  }

  // Exchange authorization code for tokens
  async exchangeCode(code: string): Promise<AmoCRMTokens> {
    try {
      const response = await fetch(`${this.baseUrl}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM token exchange error');
        throw new Error(`Failed to exchange code for tokens: ${response.status} ${response.statusText}`);
      }

      const tokens = await response.json();
      
      // Validate required fields
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Invalid token response from AmoCRM');
      }

      return tokens;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM exchange code error');
      throw new Error(`AmoCRM OAuth failed: ${error.message}`);
    }
  }

  // Refresh access token
  async refreshToken(refreshToken: string): Promise<AmoCRMTokens> {
    try {
      const response = await fetch(`${this.baseUrl}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          redirect_uri: this.redirectUri,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ error: errorText, status: response.status }, 'AmoCRM token refresh error');
        throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`);
      }

      const tokens = await response.json();
      
      if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error('Invalid token refresh response from AmoCRM');
      }

      return tokens;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM refresh token error');
      throw new Error(`AmoCRM token refresh failed: ${error.message}`);
    }
  }

  // Verify webhook signature using HMAC-SHA256
  verifyWebhookSignature(payload: string | Buffer, signature: string | undefined): boolean {
    try {
      // In development mode, allow bypass with warning
      if (process.env.NODE_ENV !== 'production') {
        if (!signature && !this.webhookSecret) {
          logger.warn('Skipping webhook signature verification in development mode');
          return true;
        }
      }
      
      // Require signature in production
      if (!signature) {
        logger.warn('Missing webhook signature header');
        return false;
      }
      
      // Require webhook secret
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
        logger.warn('Invalid webhook signature format/length');
        return false;
      }

      const isValid = crypto.timingSafeEqual(providedBuffer, expectedBufferHex);
      
      if (!isValid) {
        logger.warn('Invalid webhook signature');
      }
      
      return isValid;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Webhook signature verification error');
      return false;
    }
  }

  async fetchAccountInfo(accessToken: string): Promise<AmoCRMAccountInfo> {
    const response = await fetch(`${this.baseUrl}/api/v4/account`, {
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

  // Fetch leads from AmoCRM (polling fallback)
  async fetchLeads(accessToken: string, accountId: string, params?: {
    page?: number;
    limit?: number;
    with?: string;
    filter?: any;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.with) queryParams.set('with', params.with);

      const url = `${this.baseUrl}/api/v4/leads${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      
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
      
      // Validate response structure
      if (!data._embedded || !data._embedded.leads) {
        throw new Error('Invalid response structure from AmoCRM');
      }

      return data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM fetch leads error');
      throw new Error(`Failed to fetch AmoCRM leads: ${error.message}`);
    }
  }

  // Fetch contacts from AmoCRM
  async fetchContacts(accessToken: string, accountId: string, params?: {
    page?: number;
    limit?: number;
    query?: string;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.page) queryParams.set('page', params.page.toString());
      if (params?.limit) queryParams.set('limit', params.limit.toString());
      if (params?.query) queryParams.set('query', params.query);

      const url = `${this.baseUrl}/api/v4/contacts${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      
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

  // Create lead in AmoCRM
  async createLead(accessToken: string, leadData: any) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v4/leads`, {
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

  // Update lead in AmoCRM
  async updateLead(accessToken: string, leadId: number, leadData: any) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v4/leads/${leadId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(leadData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AmoCRM] Update lead error:', errorText);
        throw new Error(`Failed to update lead in AmoCRM: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      logger.error({ error: error.message }, 'AmoCRM update lead error');
      throw new Error(`Failed to update AmoCRM lead: ${error.message}`);
    }
  }

  // Encrypt tokens for storage
  encryptTokens(tokens: AmoCRMTokens): string | null {
    try {
      // Calculate expiration timestamp
      const tokensWithExpiry = {
        ...tokens,
        expires_at: Date.now() + (tokens.expires_in * 1000) - 300000, // 5 minutes buffer
      };
      
      const encrypted = encryptionService.encryptJSON(tokensWithExpiry);
      if (!encrypted) {
        throw new Error('Failed to encrypt tokens');
      }
      
      return encrypted;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to encrypt AmoCRM tokens');
      return null;
    }
  }

  // Decrypt tokens from storage
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

  // Check if tokens need refresh (with buffer)
  needsRefresh(expiresAt: Date | number): boolean {
    const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    
    return Date.now() >= (expiryTime - bufferTime);
  }

  // Refresh tokens with exponential backoff
  async refreshTokensWithBackoff(
    refreshToken: string, 
    maxAttempts: number = 3,
    initialDelay: number = 1000
  ): Promise<AmoCRMTokens> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.info({ attempt }, 'Refreshing AmoCRM tokens');
        return await this.refreshToken(refreshToken);
      } catch (error: any) {
        lastError = error;
        
        if (attempt === maxAttempts) {
          break;
        }
        
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000;
        const totalDelay = delay + jitter;
        
        logger.warn({ 
          attempt, 
          delay: totalDelay,
          error: error.message 
        }, 'Token refresh failed, retrying');
        
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }
    }
    
    throw new Error(`Failed to refresh tokens after ${maxAttempts} attempts: ${lastError?.message}`);
  }

  // Get valid access token (refreshes if needed)
  async getValidAccessToken(
    encryptedTokens: string,
    onRefresh?: (newTokens: AmoCRMTokens) => Promise<void>
  ): Promise<string> {
    try {
      const tokens = this.decryptTokens(encryptedTokens);
      if (!tokens) {
        throw new Error('Failed to decrypt tokens');
      }
      
      // Check if tokens need refresh
      if (tokens.expires_at && this.needsRefresh(tokens.expires_at)) {
        logger.info('Refreshing expired AmoCRM tokens');
        
        const newTokens = await this.refreshTokensWithBackoff(tokens.refresh_token);
        const newEncryptedTokens = this.encryptTokens(newTokens);
        
        if (!newEncryptedTokens) {
          throw new Error('Failed to encrypt refreshed tokens');
        }
        
        // Notify caller about refresh
        if (onRefresh) {
          await onRefresh(newTokens);
        }
        
        return newTokens.access_token;
      }
      
      return tokens.access_token;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get valid access token');
      throw error;
    }
  }
}

export const amocrmService = new AmoCRMService();
