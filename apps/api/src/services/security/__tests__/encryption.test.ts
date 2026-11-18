import crypto from 'crypto';

import { logger } from '../../../lib/logger';
import { EncryptionService } from '../encryption';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

function serviceWithKey(key: string | undefined): EncryptionService {
  if (key === undefined) {
    delete process.env.ENCRYPTION_KEY;
  } else {
    process.env.ENCRYPTION_KEY = key;
  }

  return new EncryptionService();
}

function decodeEnvelope(encrypted: string): Record<string, string> {
  return JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8')) as Record<string, string>;
}

function encodeEnvelope(envelope: unknown): string {
  return Buffer.from(JSON.stringify(envelope)).toString('base64');
}

describe('EncryptionService (AES-256-GCM envelopes)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('round-trips text, including unicode', () => {
    const service = serviceWithKey('unit-test-key');

    for (const text of ['amo-access-token', "Qarzdorlik to'lovi ✅ — 1 200 000 so'm", 'x']) {
      const encrypted = service.encrypt(text);

      expect(encrypted).not.toBeNull();
      expect(service.decrypt(encrypted ?? '')).toBe(text);
    }
  });

  it('encrypts the empty string, but cannot decrypt it (an empty ciphertext fails the structure check)', () => {
    const service = serviceWithKey('unit-test-key');
    const encrypted = service.encrypt('') ?? '';

    expect(decodeEnvelope(encrypted).encrypted).toBe('');
    expect(service.decrypt(encrypted)).toBeNull();
  });

  it('writes a base64 JSON envelope with a fresh 16-byte iv, a 16-byte auth tag and version 1.0', () => {
    const service = serviceWithKey('unit-test-key');
    const first = service.encrypt('same text') ?? '';
    const second = service.encrypt('same text') ?? '';
    const envelope = decodeEnvelope(first);

    expect(Object.keys(envelope)).toEqual(['iv', 'authTag', 'encrypted', 'algorithm', 'version']);
    expect(envelope.algorithm).toBe('aes-256-gcm');
    expect(envelope.version).toBe('1.0');
    expect(envelope.iv).toMatch(/^[0-9a-f]{32}$/);
    expect(envelope.authTag).toMatch(/^[0-9a-f]{32}$/);
    // GCM is a stream mode: 9 bytes of text give 9 bytes (18 hex characters) of ciphertext.
    expect(envelope.encrypted).toMatch(/^[0-9a-f]{18}$/);
    expect(first).not.toBe(second);
    expect(decodeEnvelope(second).iv).not.toBe(envelope.iv);
  });

  it('derives the key as sha256(ENCRYPTION_KEY), so a known envelope decrypts', () => {
    const key = crypto.createHash('sha256').update('known-key').digest();
    const iv = Buffer.alloc(16, 7);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = cipher.update('hello', 'utf8', 'hex') + cipher.final('hex');
    const envelope = encodeEnvelope({
      iv: iv.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
      encrypted,
      algorithm: 'aes-256-gcm',
      version: '1.0',
    });

    expect(serviceWithKey('known-key').decrypt(envelope)).toBe('hello');
    expect(serviceWithKey('another-key').decrypt(envelope)).toBeNull();
  });

  it('rejects tampered ciphertext and auth tags', () => {
    const service = serviceWithKey('unit-test-key');
    const envelope = decodeEnvelope(service.encrypt('secret') ?? '');
    const flip = (hex: string) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

    expect(service.decrypt(encodeEnvelope({ ...envelope, encrypted: flip(envelope.encrypted ?? '') }))).toBeNull();
    expect(service.decrypt(encodeEnvelope({ ...envelope, authTag: flip(envelope.authTag ?? '') }))).toBeNull();
    expect(errorSpy).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.any(String) as unknown }), 'Decryption failed');
  });

  it('rejects envelopes with missing fields, another algorithm, or no JSON at all', () => {
    const service = serviceWithKey('unit-test-key');
    const envelope = decodeEnvelope(service.encrypt('secret') ?? '');

    expect(service.decrypt(encodeEnvelope({ ...envelope, iv: '' }))).toBeNull();
    expect(errorSpy).toHaveBeenLastCalledWith({ error: 'Invalid encrypted data structure' }, 'Decryption failed');
    expect(service.decrypt(encodeEnvelope({ ...envelope, authTag: undefined }))).toBeNull();
    expect(service.decrypt(encodeEnvelope({ ...envelope, algorithm: 'aes-128-gcm' }))).toBeNull();
    expect(errorSpy).toHaveBeenLastCalledWith({ error: 'Invalid encrypted data structure' }, 'Decryption failed');
    expect(service.decrypt(encodeEnvelope([envelope]))).toBeNull();
    expect(service.decrypt(Buffer.from('null').toString('base64'))).toBeNull();
    expect(service.decrypt('not base64 json')).toBeNull();
  });

  it('round-trips JSON and returns null for undecryptable JSON', () => {
    const service = serviceWithKey('unit-test-key');
    const tokens = { access_token: 'a', refresh_token: 'r', expires_at: 1_700_000_000, nested: { ok: true } };
    const encrypted = service.encryptJSON(tokens) ?? '';

    expect(service.decryptJSON<typeof tokens>(encrypted)).toEqual(tokens);
    expect(service.decryptJSON(service.encrypt('{not json') ?? '')).toBeNull();
    expect(errorSpy).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.any(String) as unknown }), 'JSON decryption failed');
    expect(service.decryptJSON('garbage')).toBeNull();

    const circular: Record<string, unknown> = {};

    circular.self = circular;
    expect(service.encryptJSON(circular)).toBeNull();
    expect(errorSpy).toHaveBeenLastCalledWith(expect.objectContaining({ error: expect.stringContaining('circular') as unknown }), 'JSON encryption failed');
  });

  it('is disabled without ENCRYPTION_KEY: everything returns null and is logged', () => {
    const service = serviceWithKey(undefined);

    expect(service.encrypt('x')).toBeNull();
    expect(service.decrypt('x')).toBeNull();
    expect(service.encryptJSON({ a: 1 })).toBeNull();
    expect(service.decryptJSON('x')).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('Encryption service not initialized');
  });

  it('hashes with an optional salt prefix and signs/verifies HMACs', () => {
    expect(EncryptionService.hash('data')).toBe(crypto.createHash('sha256').update('data').digest('hex'));
    expect(EncryptionService.hash('data', 'salt')).toBe(crypto.createHash('sha256').update('saltdata').digest('hex'));
    expect(EncryptionService.hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const signature = EncryptionService.generateHMAC('payload', 'secret');

    expect(signature).toBe(crypto.createHmac('sha256', 'secret').update('payload').digest('hex'));
    expect(EncryptionService.verifyHMAC('payload', signature, 'secret')).toBe(true);
    expect(EncryptionService.verifyHMAC('payload!', signature, 'secret')).toBe(false);
    expect(EncryptionService.verifyHMAC('payload', signature, 'other')).toBe(false);
    expect(EncryptionService.verifyHMAC('payload', signature.slice(2), 'secret')).toBe(false);
    expect(EncryptionService.verifyHMAC('payload', 'zz', 'secret')).toBe(false);
  });

  it('generates hex random strings of twice the byte length', () => {
    expect(EncryptionService.generateRandomString()).toMatch(/^[0-9a-f]{64}$/);
    expect(EncryptionService.generateRandomString(4)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('encryptIntegrationTokens / decryptIntegrationTokens (the module singleton)', () => {
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('round-trips tokens when the key is set at import time', async () => {
    process.env.ENCRYPTION_KEY = 'singleton-key';
    await jest.isolateModulesAsync(async () => {
      const encryption = await import('../encryption');
      const encrypted = encryption.encryptIntegrationTokens({ botToken: '123:abc' });

      expect(encryption.decryptIntegrationTokens(encrypted)).toEqual({ botToken: '123:abc' });
      expect(() => encryption.decryptIntegrationTokens('garbage')).toThrow('Failed to decrypt integration tokens');
    });
  });

  it('throws when the service is disabled', async () => {
    delete process.env.ENCRYPTION_KEY;
    await jest.isolateModulesAsync(async () => {
      const encryption = await import('../encryption');

      expect(() => encryption.encryptIntegrationTokens({ botToken: 'x' })).toThrow('Failed to encrypt integration tokens');
    });
  });
});
