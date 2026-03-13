// Telegram Login verification service

import crypto from 'crypto';

export interface TelegramUserData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export class TelegramAuthService {
  private botToken: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  }

  // Verify Telegram Login Widget data
  verifyLoginData(data: TelegramUserData): boolean {
    try {
      const { hash, ...dataToCheck } = data;
      
      // Create data check string
      const dataCheckArr: string[] = [];
      Object.keys(dataToCheck)
        .sort()
        .forEach((key) => {
          dataCheckArr.push(`${key}=${(dataToCheck as any)[key]}`);
        });

      const dataCheckString = dataCheckArr.join('\n');
      
      // Create secret key
      const secretKey = crypto
        .createHash('sha256')
        .update(this.botToken)
        .digest();

      // Calculate hash
      const hmac = crypto
        .createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      // Check if hash matches
      return hmac === hash;
    } catch (error) {
      console.error('[Telegram Auth] Verification error:', error);
      return false;
    }
  }

  // Get bot info (for verification)
  async getBotInfo(): Promise<{
    id: number;
    username: string;
    first_name: string;
  } | null> {
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.result;
    } catch (error) {
      console.error('[Telegram Auth] Get bot info error:', error);
      return null;
    }
  }

  // Validate auth date (check if data is not too old)
  validateAuthDate(authDate: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 24 * 60 * 60; // 24 hours in seconds
    
    return now - authDate <= maxAge;
  }

  // Complete verification with all checks
  verifyUser(data: TelegramUserData): {
    isValid: boolean;
    user?: {
      id: number;
      firstName: string;
      lastName?: string;
      username?: string;
      photoUrl?: string;
    };
    error?: string;
  } {
    // Check if bot token is configured
    if (!this.botToken) {
      return {
        isValid: false,
        error: 'Telegram bot token not configured',
      };
    }

    // Validate auth date
    if (!this.validateAuthDate(data.auth_date)) {
      return {
        isValid: false,
        error: 'Authentication data expired',
      };
    }

    // Verify hash
    if (!this.verifyLoginData(data)) {
      return {
        isValid: false,
        error: 'Invalid Telegram authentication hash',
      };
    }

    // Return user data
    return {
      isValid: true,
      user: {
        id: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        username: data.username,
        photoUrl: data.photo_url,
      },
    };
  }

  // Get user profile photos
  async getUserProfilePhotos(userId: number): Promise<any> {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getUserProfilePhotos?user_id=${userId}`
      );
      
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[Telegram Auth] Get photos error:', error);
      return null;
    }
  }
}

export const telegramAuthService = new TelegramAuthService();
