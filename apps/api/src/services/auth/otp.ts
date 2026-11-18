// Phone OTP via Twilio Verify.

import { messagePropertyOfError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { asObjectOrEmpty } from '../../lib/object';

export interface OTPProvider {
  sendOTP(phone: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  verifyOTP(phone: string, code: string): Promise<{ success: boolean; verified: boolean; error?: string }>;
}

/** The `sid` of a Twilio Verify response, when it is a string. */
function twilioSid(data: Record<string, unknown>): string | undefined {
  return typeof data.sid === 'string' ? data.sid : undefined;
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

      const data = asObjectOrEmpty(await response.json() as unknown);
      
      logger.info({ phone, sid: data.sid }, 'OTP sent via Twilio Verify');
      
      return { 
        success: true, 
        messageId: twilioSid(data),
      };
    } catch (error: unknown) {
      const message = messagePropertyOfError(error);

      logger.error({ error: message, phone }, 'Twilio OTP send error');

      return { 
        success: false, 
        error: message || 'Failed to send OTP via Twilio' 
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

      const data = asObjectOrEmpty(await response.json() as unknown);
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
    } catch (error: unknown) {
      const message = messagePropertyOfError(error);

      logger.error({ error: message, phone }, 'Twilio OTP verify error');

      return { 
        success: false, 
        verified: false,
        error: message || 'Failed to verify OTP via Twilio' 
      };
    }
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Basic E.164 format validation
    const e164Regex = /^\+[1-9]\d{1,14}$/;

    return e164Regex.test(phone);
  }
}

export const otpService: OTPProvider = new TwilioOTPProvider();
