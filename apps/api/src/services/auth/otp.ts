// OTP service abstraction - supports Firebase Auth or Twilio Verify

import { logger } from '../../lib/logger';

export interface OTPProvider {
  sendOTP(phone: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  verifyOTP(phone: string, code: string): Promise<{ success: boolean; verified: boolean; error?: string }>;
}

// Firebase Auth implementation
class FirebaseOTPProvider implements OTPProvider {
  private admin: any;
  private initialized: boolean = false;

  constructor() {
    // Initialize Firebase Admin SDK
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccount) {
      try {
        // Parse service account JSON
        const serviceAccountJson = JSON.parse(serviceAccount);
        
        // Initialize Firebase Admin
        // Note: In a real implementation, you would import and initialize firebase-admin
        // For now, we'll simulate the initialization
        this.admin = {
          auth: () => ({
            generateSignInWithPhoneNumber: async (phone: string) => {
              // Simulate Firebase phone auth
              return { verificationId: `firebase-verification-${Date.now()}` };
            },
            verifyPhoneNumber: async (verificationId: string, code: string) => {
              // Simulate verification
              return { success: true };
            }
          })
        };
        
        this.initialized = true;
        logger.info('Firebase OTP provider initialized');
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to initialize Firebase OTP provider');
        this.initialized = false;
      }
    } else {
      logger.warn('FIREBASE_SERVICE_ACCOUNT not set, Firebase OTP provider disabled');
    }
  }

  async sendOTP(phone: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!this.initialized) {
        throw new Error('Firebase OTP provider not initialized');
      }

      // Validate phone number format
      if (!this.isValidPhoneNumber(phone)) {
        throw new Error('Invalid phone number format');
      }

      logger.info({ phone }, 'Sending OTP via Firebase');
      
      // In production, this would use Firebase Admin SDK
      // const result = await this.admin.auth().generateSignInWithPhoneNumber(phone, {});
      
      // For now, simulate successful OTP send
      const verificationId = `firebase-${Date.now()}-${phone}`;
      
      // Store verification session in Redis (simulated)
      await this.storeVerificationSession(verificationId, phone);
      
      logger.info({ phone, verificationId }, 'OTP sent via Firebase (simulated)');
      
      return { 
        success: true, 
        messageId: verificationId,
      };
    } catch (error: any) {
      logger.error({ error: error.message, phone }, 'Firebase OTP send error');
      return { 
        success: false, 
        error: error.message || 'Failed to send OTP' 
      };
    }
  }

  async verifyOTP(phone: string, code: string): Promise<{ success: boolean; verified: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        throw new Error('Firebase OTP provider not initialized');
      }

      // Validate code format (6 digits)
      if (!/^\d{6}$/.test(code)) {
        return { success: true, verified: false };
      }

      logger.info({ phone }, 'Verifying OTP via Firebase');
      
      // In production, this would verify with Firebase
      // const result = await this.admin.auth().verifyPhoneNumber(verificationId, code);
      
      // For now, simulate verification by checking against stored sessions
      const verified = await this.checkVerificationCode(phone, code);
      
      if (verified) {
        logger.info({ phone }, 'OTP verified successfully via Firebase');
        return { success: true, verified: true };
      } else {
        logger.warn({ phone }, 'OTP verification failed via Firebase');
        return { success: true, verified: false };
      }
    } catch (error: any) {
      logger.error({ error: error.message, phone }, 'Firebase OTP verify error');
      return { 
        success: false, 
        verified: false,
        error: error.message || 'Failed to verify OTP' 
      };
    }
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Basic phone validation - adjust based on your requirements
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
  }

  private async storeVerificationSession(verificationId: string, phone: string): Promise<void> {
    // In production, store in Redis with expiration
    // For now, simulate storage
    const session = {
      verificationId,
      phone,
      code: Math.floor(100000 + Math.random() * 900000).toString(),
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    };
    
    // Simulate Redis storage
    (global as any).firebaseSessions = (global as any).firebaseSessions || {};
    (global as any).firebaseSessions[verificationId] = session;
    
    logger.debug({ verificationId, phone }, 'Stored Firebase verification session');
  }

  private async checkVerificationCode(phone: string, code: string): Promise<boolean> {
    // In production, check against Firebase
    // For now, check against simulated sessions
    const sessions = (global as any).firebaseSessions || {};
    
    for (const verificationId in sessions) {
      const session = sessions[verificationId];
      if (session.phone === phone && 
          session.code === code && 
          session.expiresAt > Date.now()) {
        
        // Clean up session
        delete (global as any).firebaseSessions[verificationId];
        return true;
      }
    }
    
    return false;
  }
}

// Twilio Verify implementation
class TwilioOTPProvider implements OTPProvider {
  private accountSid: string;
  private authToken: string;
  private serviceSid: string;
  private initialized: boolean = false;

  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID || '';
    
    if (this.accountSid && this.authToken && this.serviceSid) {
      this.initialized = true;
      logger.info('Twilio OTP provider initialized');
    } else {
      logger.warn('Twilio credentials not fully configured, Twilio OTP provider disabled');
    }
  }

  async sendOTP(phone: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!this.initialized) {
        throw new Error('Twilio OTP provider not initialized');
      }

      // Validate phone number format
      if (!this.isValidPhoneNumber(phone)) {
        throw new Error('Invalid phone number format');
      }

      logger.info({ phone }, 'Sending OTP via Twilio Verify');
      
      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${this.serviceSid}/Verifications`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ 
            To: phone, 
            Channel: 'sms',
            // Optional: Customize message
            // CustomMessage: 'Your verification code for Dashboarduz is: {code}'
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ phone, status: response.status, error: errorText }, 'Twilio OTP send failed');
        throw new Error(`Twilio API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      logger.info({ phone, sid: data.sid }, 'OTP sent via Twilio Verify');
      
      return { 
        success: true, 
        messageId: data.sid 
      };
    } catch (error: any) {
      logger.error({ error: error.message, phone }, 'Twilio OTP send error');
      return { 
        success: false, 
        error: error.message || 'Failed to send OTP via Twilio' 
      };
    }
  }

  async verifyOTP(phone: string, code: string): Promise<{ success: boolean; verified: boolean; error?: string }> {
    try {
      if (!this.initialized) {
        throw new Error('Twilio OTP provider not initialized');
      }

      // Validate code format
      if (!/^\d{4,10}$/.test(code)) {
        return { success: true, verified: false };
      }

      logger.info({ phone }, 'Verifying OTP via Twilio Verify');
      
      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${this.serviceSid}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ 
            To: phone, 
            Code: code 
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        
        // Handle specific Twilio error codes
        if (response.status === 404) {
          // Verification not found or expired
          return { success: true, verified: false };
        }
        
        logger.error({ phone, status: response.status, error: errorText }, 'Twilio OTP verify failed');
        return { 
          success: false, 
          verified: false,
          error: `Twilio API error: ${response.status} ${response.statusText}`
        };
      }

      const data = await response.json();
      const verified = data.status === 'approved';
      
      if (verified) {
        logger.info({ phone, sid: data.sid }, 'OTP verified successfully via Twilio');
      } else {
        logger.warn({ phone, status: data.status }, 'OTP verification failed via Twilio');
      }
      
      return { 
        success: true, 
        verified 
      };
    } catch (error: any) {
      logger.error({ error: error.message, phone }, 'Twilio OTP verify error');
      return { 
        success: false, 
        verified: false,
        error: error.message || 'Failed to verify OTP via Twilio' 
      };
    }
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Basic E.164 format validation
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test(phone);
  }
}

// Factory to get OTP provider based on env
export function getOTPProvider(): OTPProvider {
  const provider = process.env.OTP_PROVIDER || 'twilio';
  
  logger.info({ provider }, 'Initializing OTP provider');
  
  switch (provider) {
    case 'twilio':
      return new TwilioOTPProvider();
    case 'firebase':
      return new FirebaseOTPProvider();
    default:
      logger.warn({ provider }, 'Unknown OTP provider, defaulting to Twilio');
      return new TwilioOTPProvider();
  }
}

// Rate limiting for OTP requests
export class OTPRateLimiter {
  private static readonly MAX_ATTEMPTS_PER_HOUR = 5;
  private static readonly MAX_ATTEMPTS_PER_DAY = 20;
  private static readonly RESEND_COOLDOWN_SECONDS = 60;

  static async checkRateLimit(phone: string, action: 'send' | 'verify'): Promise<{ allowed: boolean; retryAfter?: number; error?: string }> {
    // In production, implement Redis-based rate limiting
    // For now, return always allowed
    return { allowed: true };
  }

  static async recordAttempt(phone: string, action: 'send' | 'verify', success: boolean): Promise<void> {
    // In production, record in Redis
    logger.debug({ phone, action, success }, 'Recorded OTP attempt');
  }
}

export const otpService = getOTPProvider();
