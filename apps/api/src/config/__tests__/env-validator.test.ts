// Startup environment validation. Each test loads a fresh copy of the module, because it caches the result.
type EnvValidator = typeof import('../env-validator');

const savedEnv = { ...process.env };

function freshValidator(env: Record<string, string | undefined>): EnvValidator {
  process.env = { ...env };
  let loaded: EnvValidator | undefined;

  jest.isolateModules(() => {
    loaded = jest.requireActual<EnvValidator>('../env-validator');
  });
  if (!loaded) throw new Error('env-validator did not load');

  return loaded;
}

const SECRET = 'x'.repeat(32);

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('validateEnv', () => {
  it('applies defaults to a valid environment and caches the result', () => {
    const validator = freshValidator({ JWT_SECRET: SECRET, DATABASE_URL: 'postgresql://db/app', NODE_ENV: 'production' });
    const env = validator.validateEnv();

    expect(env).toMatchObject({
      JWT_SECRET: SECRET,
      JWT_EXPIRES_IN: '7d',
      AMOCRM_BASE_URL: 'https://www.amocrm.ru',
      SENTRY_ENVIRONMENT: 'development',
      NODE_ENV: 'production',
      PORT: '3001',
    });
    process.env.PORT = '9999';
    expect(validator.getEnv()).toBe(env);
    expect(validator.env().PORT).toBe('3001');
  });

  it('builds DATABASE_URL from its parts, encoding the password', () => {
    const validator = freshValidator({
      JWT_SECRET: SECRET, DB_HOST: 'db.internal', DB_NAME: 'app', DB_USERNAME: 'svc', DB_PASSWORD: 'p@ss/word',
    });

    validator.validateEnv();
    expect(process.env.DATABASE_URL).toBe('postgresql://svc:p%40ss%2Fword@db.internal:5432/app?sslmode=require');
  });

  it('omits sslmode when DB_SSL turns it off, and leaves DATABASE_URL unset without all parts', () => {
    freshValidator({ JWT_SECRET: SECRET, DB_HOST: 'h', DB_PORT: '6543', DB_NAME: 'n', DB_USERNAME: 'u', DB_PASSWORD: 'p', DB_SSL: 'false' }).validateEnv();
    expect(process.env.DATABASE_URL).toBe('postgresql://u:p@h:6543/n');

    freshValidator({ JWT_SECRET: SECRET, DB_HOST: 'h' }).validateEnv();
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it('lists every invalid variable in one error', () => {
    const validator = freshValidator({ JWT_SECRET: 'short', REDIS_URL: 'not a url', LOG_FORMAT: 'xml' });

    let message = '';

    try {
      validator.validateEnv();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Environment validation failed:');
    expect(message).toContain('JWT_SECRET: JWT_SECRET must be at least 32 characters');
    expect(message).toContain('REDIS_URL: Invalid url');
    expect(message).toContain('LOG_FORMAT:');
    expect(message).toContain('Please check your environment variables configuration.');
  });

  it('returns a minimal config when validation is skipped', () => {
    const env = freshValidator({ SKIP_ENV_VALIDATION: 'true', JWT_SECRET: 'tiny' }).validateEnv();

    expect(env).toEqual({
      JWT_SECRET: 'tiny',
      JWT_EXPIRES_IN: '7d',
      AMOCRM_BASE_URL: 'https://www.amocrm.ru',
      NODE_ENV: 'development',
      PORT: '3001',
      SENTRY_ENVIRONMENT: 'development',
    });
  });

  it('warns about features whose variables are missing', () => {
    process.env = { JWT_SECRET: SECRET, DATABASE_URL: 'postgresql://db/app', TELEGRAM_BOT_TOKEN: '1:a', TWILIO_ACCOUNT_SID: 'AC' };
    const warnings: string[] = [];

    jest.isolateModules(() => {
      const { logger } = jest.requireActual<typeof import('../../lib/logger')>('../../lib/logger');

      jest.spyOn(logger, 'warn').mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });
      const validator = jest.requireActual<EnvValidator>('../env-validator');

      validator.validateAllFeatures();
      validator.validateFeatureRequirements('unknown-feature');
    });

    expect(warnings).toEqual([
      "[Env] Feature 'otp_twilio' requires the following environment variables: TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID",
      "[Env] Feature 'amocrm' requires the following environment variables: AMOCRM_WEBHOOK_SECRET",
    ]);
  });
});
