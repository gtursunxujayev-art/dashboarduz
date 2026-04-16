// Environment variable validation on application startup

import { z } from 'zod';

// Environment schema
const envSchema = z.object({
  // Database
      DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_NAME: z.string().optional(),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  
  // Redis
  REDIS_URL: z.string().url().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().optional(),
  
  // JWT & Security
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().optional(),
  
  // OTP Provider
  OTP_PROVIDER: z.enum(['firebase', 'twilio']).default('twilio'),
  
  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  
  // Firebase
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  
  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OFLINE_GROUP_ID: z.string().optional(),
  OFFLINE_GROUP_ID: z.string().optional(),
  OFLINE_GROUP_IDS: z.string().optional(),
  OFFLINE_GROUP_IDS: z.string().optional(),
  ONLINE_GROUP_ID: z.string().optional(),
  ONLINE_GROUP_IDS: z.string().optional(),
  PAYMENT_RETURN_GROUP_ID: z.string().optional(),
  PAYMENT_RETURN_GROUP_IDS: z.string().optional(),
  REFUND_GROUP_ID: z.string().optional(),
  REFUND_GROUP_IDS: z.string().optional(),
  RETURN_GROUP_ID: z.string().optional(),
  RETURN_GROUP_IDS: z.string().optional(),
  KORPORATIV_GROUP_ID: z.string().optional(),
  KORPORATIV_GROUP_IDS: z.string().optional(),
  CORPORATE_GROUP_ID: z.string().optional(),
  CORPORATE_GROUP_IDS: z.string().optional(),
  CORPORATE_CALL_GROUP_ID: z.string().optional(),
  CORPORATE_CALL_GROUP_IDS: z.string().optional(),
  TELEGRAM_DEBUG_KEY: z.string().optional(),
  
  // AmoCRM
  AMOCRM_BASE_URL: z.string().url().default('https://www.amocrm.ru'),
  AMOCRM_LONG_LIVED_TOKEN: z.string().optional(),
  
  // UTeL VoIP
  UTEL_API_URL: z.string().url().optional(),
  UTEL_API_TOKEN: z.string().optional(),
  UTEL_WEBHOOK_SECRET: z.string().optional(),
  
  // AWS S3 Storage
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  
  // Email Service (SendGrid)
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  SENDGRID_FROM_NAME: z.string().optional(),
  
  // SMS Service (Twilio - additional for SMS notifications)
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_SMS_FROM_NUMBER: z.string().optional(),
  
  // Firebase (additional)
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  
  // Database Pool Configuration
  DB_POOL_MIN: z.string().optional(),
  DB_POOL_MAX: z.string().optional(),
  DB_SSL: z.string().optional(),
  
  // Redis Configuration
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.string().optional(),
  
  // Monitoring
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  LOGGING_SERVICE_URL: z.string().url().optional(),
  
  // API
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.string().default('3001'),
  API_URL: z.string().url().optional(),
  PUBLIC_API_URL: z.string().url().optional(),
  FRONTEND_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().optional(),
  
  // Frontend
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().optional(),
  RATE_LIMIT_MAX_REQUESTS_FREE: z.string().optional(),
  RATE_LIMIT_MAX_REQUESTS_PRO: z.string().optional(),
  RATE_LIMIT_MAX_REQUESTS_ENTERPRISE: z.string().optional(),
  
  // Feature Flags
  FEATURE_WEBHOOKS_ENABLED: z.string().optional(),
  FEATURE_NOTIFICATIONS_ENABLED: z.string().optional(),
  FEATURE_EXPORTS_ENABLED: z.string().optional(),
  FEATURE_SYNC_ENABLED: z.string().optional(),
  FEATURE_ANALYTICS_ENABLED: z.string().optional(),
  
  // Secrets Management
  SECRETS_PROVIDER: z.enum(['aws', 'vault', 'local']).optional(),
  VAULT_ADDR: z.string().url().optional(),
  VAULT_TOKEN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig | null = null;

// Helper function to construct DATABASE_URL from individual components
function constructDatabaseUrl(): string | undefined {
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME;
  const username = process.env.DB_USERNAME;
  const password = process.env.DB_PASSWORD;
  const ssl = process.env.DB_SSL || 'require';
  
  if (host && name && username && password) {
    // URL encode password to handle special characters
    const encodedPassword = encodeURIComponent(password);
    // Add SSL parameters for production environments
    const sslParam = ssl === 'true' || ssl === 'require' ? '?sslmode=require' : '';
    return `postgresql://${username}:${encodedPassword}@${host}:${port}/${name}${sslParam}`;
  }
  
  return undefined;
}

export function validateEnv(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }

  // Skip validation if SKIP_ENV_VALIDATION is true
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    console.log('[Config] Skipping environment validation (SKIP_ENV_VALIDATION=true)');
    // Return a minimal valid config
    validatedEnv = {
      JWT_SECRET: process.env.JWT_SECRET || 'dummy-secret-for-skip-validation-mode',
      JWT_EXPIRES_IN: '7d',
      OTP_PROVIDER: 'twilio',
      AMOCRM_BASE_URL: 'https://www.amocrm.ru',
      NODE_ENV: 'development',
      PORT: '3001',
      SENTRY_ENVIRONMENT: 'development',
    } as EnvConfig;
    return validatedEnv;
  }

    try {
    // First, check if we need to construct DATABASE_URL from individual components
    if (!process.env.DATABASE_URL) {
      const constructedUrl = constructDatabaseUrl();
      if (constructedUrl) {
        process.env.DATABASE_URL = constructedUrl;
        console.log('[Config] Constructed DATABASE_URL from individual components');
      } else {
        console.warn('[Config] DATABASE_URL is not set and cannot be constructed from individual components');
        console.warn('[Config] Database connections will fail if DATABASE_URL is required');
      }
    } else {
      // Log that DATABASE_URL is set (but don't log the actual URL for security)
      console.log('[Config] DATABASE_URL is set');
    }
    
    validatedEnv = envSchema.parse(process.env);
    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new Error(
        `Environment validation failed:\n${missingVars.join('\n')}\n\n` +
        'Please check your environment variables configuration.'
      );
    }
    throw error;
  }
}

// Lazy environment validation
export function getEnv(): EnvConfig {
  return validateEnv();
}

// Backward compatibility - function that returns env
export function env(): EnvConfig {
  return getEnv();
}

// Helper to check if required vars are set for specific features
export function validateFeatureRequirements(feature: string): void {
  const requirements: Record<string, string[]> = {
    otp_twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'],
    otp_firebase: ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL'],
    telegram: ['TELEGRAM_BOT_TOKEN'],
    amocrm: ['AMOCRM_WEBHOOK_SECRET'],
    utel: [],
    sendgrid: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
    aws_s3: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'],
  };

  const required = requirements[feature];
  if (!required) {
    return;
  }

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.warn(
      `[Env] Feature '${feature}' requires the following environment variables: ${missing.join(', ')}`
    );
  }
}

// Validate all features on startup
export function validateAllFeatures(): void {
  const currentEnv = env();
  if (currentEnv.OTP_PROVIDER === 'twilio') {
    validateFeatureRequirements('otp_twilio');
  } else if (currentEnv.OTP_PROVIDER === 'firebase') {
    validateFeatureRequirements('otp_firebase');
  }

  validateFeatureRequirements('telegram');
  validateFeatureRequirements('amocrm');
  validateFeatureRequirements('utel');
  validateFeatureRequirements('sendgrid');
  validateFeatureRequirements('aws_s3');
}

// Get environment-specific configuration
export function getEnvConfig() {
  const currentEnv = env();
  return {
    isDevelopment: currentEnv.NODE_ENV === 'development',
    isStaging: currentEnv.NODE_ENV === 'staging',
    isProduction: currentEnv.NODE_ENV === 'production',
    isTest: currentEnv.NODE_ENV === 'test',
    nodeEnv: currentEnv.NODE_ENV,
    port: parseInt(currentEnv.PORT, 10),
    apiUrl: currentEnv.API_URL,
    publicApiUrl: currentEnv.PUBLIC_API_URL,
    frontendUrl: currentEnv.FRONTEND_URL,
    corsOrigin: currentEnv.CORS_ORIGIN,
    sentryEnabled: !!currentEnv.SENTRY_DSN,
    sentryEnvironment: currentEnv.SENTRY_ENVIRONMENT,
    logLevel: currentEnv.LOG_LEVEL || 'info',
    logFormat: currentEnv.LOG_FORMAT || 'json',
    rateLimitWindowMs: currentEnv.RATE_LIMIT_WINDOW_MS ? parseInt(currentEnv.RATE_LIMIT_WINDOW_MS, 10) : 60000,
    rateLimitMaxRequestsFree: currentEnv.RATE_LIMIT_MAX_REQUESTS_FREE ? parseInt(currentEnv.RATE_LIMIT_MAX_REQUESTS_FREE, 10) : 100,
    rateLimitMaxRequestsPro: currentEnv.RATE_LIMIT_MAX_REQUESTS_PRO ? parseInt(currentEnv.RATE_LIMIT_MAX_REQUESTS_PRO, 10) : 500,
    rateLimitMaxRequestsEnterprise: currentEnv.RATE_LIMIT_MAX_REQUESTS_ENTERPRISE ? parseInt(currentEnv.RATE_LIMIT_MAX_REQUESTS_ENTERPRISE, 10) : 1000,
    features: {
      webhooks: currentEnv.FEATURE_WEBHOOKS_ENABLED !== 'false',
      notifications: currentEnv.FEATURE_NOTIFICATIONS_ENABLED !== 'false',
      exports: currentEnv.FEATURE_EXPORTS_ENABLED !== 'false',
      sync: currentEnv.FEATURE_SYNC_ENABLED !== 'false',
      analytics: currentEnv.FEATURE_ANALYTICS_ENABLED !== 'false',
    },
  };
}
