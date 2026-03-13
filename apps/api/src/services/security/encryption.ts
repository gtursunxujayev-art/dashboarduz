// Encryption service for sensitive data (tokens, secrets, etc.)

import crypto from 'crypto';
import { logger } from '../../lib/logger';

export class EncryptionService {
  private algorithm: string = 'aes-256-gcm';
  private key!: Buffer;
  private initialized: boolean = false;

  constructor() {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    
    if (!encryptionKey) {
      logger.warn('ENCRYPTION_KEY not set, encryption service disabled');
      return;
    }

    // Derive a 32-byte key from the environment variable
    this.key = crypto.createHash('sha256').update(encryptionKey).digest();
    this.initialized = true;
    
    logger.info('Encryption service initialized');
  }

  encrypt(text: string): string | null {
    if (!this.initialized) {
      logger.error('Encryption service not initialized');
      return null;
    }

    try {
      // Generate a random initialization vector
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv) as crypto.CipherGCM;
      
      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      // Combine IV, auth tag, and encrypted text
      const result = {
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        encrypted,
        algorithm: this.algorithm,
        version: '1.0'
      };
      
      return Buffer.from(JSON.stringify(result)).toString('base64');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Encryption failed');
      return null;
    }
  }

  decrypt(encryptedData: string): string | null {
    if (!this.initialized) {
      logger.error('Encryption service not initialized');
      return null;
    }

    try {
      // Parse the encrypted data
      const data = JSON.parse(Buffer.from(encryptedData, 'base64').toString('utf8'));
      
      // Validate data structure
      if (!data.iv || !data.authTag || !data.encrypted || data.algorithm !== this.algorithm) {
        throw new Error('Invalid encrypted data structure');
      }
      
      const iv = Buffer.from(data.iv, 'hex');
      const authTag = Buffer.from(data.authTag, 'hex');
      const encrypted = data.encrypted;
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(authTag);
      
      // Decrypt the text
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Decryption failed');
      return null;
    }
  }

  encryptJSON(data: any): string | null {
    try {
      const jsonString = JSON.stringify(data);
      return this.encrypt(jsonString);
    } catch (error: any) {
      logger.error({ error: error.message }, 'JSON encryption failed');
      return null;
    }
  }

  decryptJSON<T = any>(encryptedData: string): T | null {
    try {
      const decrypted = this.decrypt(encryptedData);
      if (!decrypted) return null;
      
      return JSON.parse(decrypted) as T;
    } catch (error: any) {
      logger.error({ error: error.message }, 'JSON decryption failed');
      return null;
    }
  }

  // Generate a secure random string
  static generateRandomString(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  // Hash data (one-way, for verification)
  static hash(data: string, salt?: string): string {
    const hash = crypto.createHash('sha256');
    if (salt) {
      hash.update(salt);
    }
    hash.update(data);
    return hash.digest('hex');
  }

  // Generate HMAC signature
  static generateHMAC(data: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(data);
    return hmac.digest('hex');
  }

  // Verify HMAC signature
  static verifyHMAC(data: string, signature: string, secret: string): boolean {
    const expectedSignature = this.generateHMAC(data, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();

export function encryptIntegrationTokens(tokens: Record<string, unknown>): string {
  const encrypted = encryptionService.encryptJSON(tokens);
  if (!encrypted) {
    throw new Error('Failed to encrypt integration tokens');
  }
  return encrypted;
}

export function decryptIntegrationTokens<T = Record<string, unknown>>(encryptedTokens: string): T {
  const decrypted = encryptionService.decryptJSON<T>(encryptedTokens);
  if (!decrypted) {
    throw new Error('Failed to decrypt integration tokens');
  }
  return decrypted;
}
