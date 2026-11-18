import type { OTPProvider } from '../otp';

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: 'AC_test',
  TWILIO_AUTH_TOKEN: 'auth_test',
  TWILIO_VERIFY_SERVICE_SID: 'VA_test',
} as const;
const ENV_KEYS = Object.keys(TWILIO_ENV) as Array<keyof typeof TWILIO_ENV>;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type FetchCall = { url: string; init: RequestInit };

let fetchCalls: FetchCall[] = [];

function mockFetch(respond: () => Response | Promise<Response>): void {
  jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
    fetchCalls.push({ url: String(input), init: init ?? {} });

    return Promise.resolve(respond());
  });
}

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });
}

async function loadOtpService(configured: boolean): Promise<OTPProvider> {
  for (const key of ENV_KEYS) {
    if (configured) {
      process.env[key] = TWILIO_ENV[key];
    } else {
      delete process.env[key];
    }
  }

  const loaded: { service?: OTPProvider } = {};

  await jest.isolateModulesAsync(async () => {
    loaded.service = (await import('../otp')).otpService;
  });

  if (!loaded.service) {
    throw new Error('otp module did not load');
  }

  return loaded.service;
}

function formBody(call: FetchCall | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(call?.init.body ?? '')));
}

describe('Twilio Verify OTP provider (fetch mocked)', () => {
  beforeEach(() => {
    fetchCalls = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('sends an SMS verification with basic auth and returns the verification sid', async () => {
    const service = await loadOtpService(true);

    mockFetch(() => jsonResponse({ sid: 'VE123', status: 'pending' }, 201, 'Created'));

    await expect(service.sendOTP('+998901234567')).resolves.toEqual({ success: true, messageId: 'VE123' });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe('https://verify.twilio.com/v2/Services/VA_test/Verifications');
    expect(fetchCalls[0]?.init.method).toBe('POST');
    expect(fetchCalls[0]?.init.headers).toEqual({
      Authorization: `Basic ${Buffer.from('AC_test:auth_test').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(formBody(fetchCalls[0])).toEqual({ To: '+998901234567', Channel: 'sms' });
  });

  it('refuses phone numbers that are not E.164 without calling Twilio', async () => {
    const service = await loadOtpService(true);

    mockFetch(() => jsonResponse({}));

    for (const phone of ['998901234567', '+0123456', '+1234567890123456', '']) {
      await expect(service.sendOTP(phone)).resolves.toEqual({ success: false, error: 'Invalid phone number format' });
    }
    expect(fetchCalls).toHaveLength(0);
  });

  it('reports Twilio HTTP errors and network failures on send', async () => {
    const service = await loadOtpService(true);

    mockFetch(() => new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }));
    await expect(service.sendOTP('+998901234567')).resolves.toEqual({ success: false, error: 'Twilio API error: 429 Too Many Requests' });

    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(service.sendOTP('+998901234567')).resolves.toEqual({ success: false, error: 'fetch failed' });
  });

  it('is disabled without credentials', async () => {
    const service = await loadOtpService(false);

    mockFetch(() => jsonResponse({}));

    await expect(service.sendOTP('+998901234567')).resolves.toEqual({ success: false, error: 'Twilio OTP provider not initialized' });
    await expect(service.verifyOTP('+998901234567', '123456')).resolves.toEqual({
      success: false,
      verified: false,
      error: 'Twilio OTP provider not initialized',
    });
    expect(fetchCalls).toHaveLength(0);
  });

  it('verifies a code: approved is verified, anything else is not', async () => {
    const service = await loadOtpService(true);
    let status = 'approved';

    mockFetch(() => jsonResponse({ sid: 'VE123', status }));

    await expect(service.verifyOTP('+998901234567', '123456')).resolves.toEqual({ success: true, verified: true });
    expect(fetchCalls[0]?.url).toBe('https://verify.twilio.com/v2/Services/VA_test/VerificationCheck');
    expect(formBody(fetchCalls[0])).toEqual({ To: '+998901234567', Code: '123456' });

    status = 'pending';
    await expect(service.verifyOTP('+998901234567', '654321')).resolves.toEqual({ success: true, verified: false });
  });

  it('rejects malformed codes locally and treats 404 as an expired verification', async () => {
    const service = await loadOtpService(true);

    mockFetch(() => new Response('not found', { status: 404, statusText: 'Not Found' }));

    for (const code of ['123', '12345678901', '12a456', '']) {
      await expect(service.verifyOTP('+998901234567', code)).resolves.toEqual({ success: true, verified: false });
    }
    expect(fetchCalls).toHaveLength(0);

    await expect(service.verifyOTP('+998901234567', '1234')).resolves.toEqual({ success: true, verified: false });
    expect(fetchCalls).toHaveLength(1);
  });

  it('reports other Twilio HTTP errors and network failures on verify', async () => {
    const service = await loadOtpService(true);

    mockFetch(() => new Response('boom', { status: 500, statusText: 'Internal Server Error' }));
    await expect(service.verifyOTP('+998901234567', '123456')).resolves.toEqual({
      success: false,
      verified: false,
      error: 'Twilio API error: 500 Internal Server Error',
    });

    jest.restoreAllMocks();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('socket hang up'));
    await expect(service.verifyOTP('+998901234567', '123456')).resolves.toEqual({
      success: false,
      verified: false,
      error: 'socket hang up',
    });
  });
});
