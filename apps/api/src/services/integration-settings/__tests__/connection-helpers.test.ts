import { TRPCError } from '@trpc/server';

import {
  amoFailureHelp,
  amoFailureMessage,
  detectAmoFailureReason,
  fetchAmoCRMAccountByToken,
  getPublicApiBaseUrl,
  normalizeBaseUrl,
} from '../connection';

describe('integration connection helpers', () => {
  it('strips trailing slashes from base URLs', () => {
    expect(normalizeBaseUrl('https://example.amocrm.ru///')).toBe('https://example.amocrm.ru');
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl(undefined)).toBeNull();
  });

  it('classifies amoCRM failures from the error message', () => {
    expect(detectAmoFailureReason(new Error('Failed to decrypt integration tokens'))).toBe('decrypt_failed');
    expect(detectAmoFailureReason(new Error('Request TIMEOUT'))).toBe('network_timeout');
    expect(detectAmoFailureReason(new Error('This operation was aborted'))).toBe('network_timeout');
    expect(detectAmoFailureReason(new Error('AmoCRM API error 401'))).toBe('token_invalid');
    expect(detectAmoFailureReason(new Error('Forbidden'))).toBe('token_invalid');
    expect(detectAmoFailureReason(new Error('Failed to validate AmoCRM long-lived token (500)'))).toBe('token_invalid');
    expect(detectAmoFailureReason(new Error('socket hang up'))).toBe('amo_unavailable');
    expect(detectAmoFailureReason('timeout as a string has no message')).toBe('amo_unavailable');
    expect(detectAmoFailureReason(null)).toBe('amo_unavailable');
  });

  it('formats failure messages and help text', () => {
    expect(amoFailureMessage('AmoCRM context yuklanmadi', 'token_invalid')).toBe('AmoCRM context yuklanmadi (token_invalid)');
    expect(amoFailureHelp('decrypt_failed')).toBe("Tokenni qayta ulash kerak (AmoCRM'ni uzib, qayta ulang).");
    expect(amoFailureHelp('token_invalid')).toBe("Token eskirgan yoki noto'g'ri. Yangi token bilan qayta ulang.");
    expect(amoFailureHelp('network_timeout')).toBe('Tarmoq kechikishi kuzatildi. Qayta urining.');
    expect(amoFailureHelp('amo_unavailable')).toBeNull();
  });
});

describe('getPublicApiBaseUrl', () => {
  const keys = ['PUBLIC_API_URL', 'API_URL', 'RAILWAY_PUBLIC_DOMAIN', 'PORT'] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];

      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('prefers PUBLIC_API_URL, then API_URL, then the Railway domain, then localhost', () => {
    expect(getPublicApiBaseUrl()).toBe('http://localhost:3001');
    process.env.PORT = '4000';
    expect(getPublicApiBaseUrl()).toBe('http://localhost:4000');
    process.env.RAILWAY_PUBLIC_DOMAIN = 'api.up.railway.app/';
    expect(getPublicApiBaseUrl()).toBe('https://api.up.railway.app');
    process.env.API_URL = 'https://api.example.com/';
    expect(getPublicApiBaseUrl()).toBe('https://api.example.com');
    process.env.PUBLIC_API_URL = 'https://public.example.com';
    expect(getPublicApiBaseUrl()).toBe('https://public.example.com');
  });
});

describe('fetchAmoCRMAccountByToken', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the account and sends the token as a bearer header', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 31, name: 'Akademiya' })));

    await expect(fetchAmoCRMAccountByToken('tok', 'https://x.amocrm.ru')).resolves.toEqual({ id: 31, name: 'Akademiya' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://x.amocrm.ru/api/v4/account');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('turns a rejected token into BAD_REQUEST', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 401 }));

    await expect(fetchAmoCRMAccountByToken('tok', 'https://x.amocrm.ru')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Failed to validate AmoCRM long-lived token (401) (token_invalid)',
    });
  });

  it('turns an aborted request into TIMEOUT and rethrows other network errors', async () => {
    jest.spyOn(global, 'fetch')
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const timeout = fetchAmoCRMAccountByToken('tok', 'https://x.amocrm.ru');

    await expect(timeout).rejects.toBeInstanceOf(TRPCError);
    await expect(timeout).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: 'Failed to validate AmoCRM long-lived token (network_timeout)',
    });
    await expect(fetchAmoCRMAccountByToken('tok', 'https://x.amocrm.ru')).rejects.toThrow('fetch failed');
  });
});
