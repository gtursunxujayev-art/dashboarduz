import { TRPCError } from '@trpc/server';

import {
  generatePassword,
  isTelegramMappingConflictError,
  rolesNeedManagerMapping,
  validateNormalizedPhoneOrThrow,
  withTelegramMappingConflict,
} from '../accounts';

describe('isTelegramMappingConflictError', () => {
  it('detects unique violations on the Telegram id, by code or by message', () => {
    expect(isTelegramMappingConflictError({ code: 'P2002', message: 'Unique constraint failed on the fields: (`telegramId`)' })).toBe(true);
    expect(isTelegramMappingConflictError(new Error('duplicate key value violates unique constraint "users_telegramid_key"'))).toBe(true);
    expect(isTelegramMappingConflictError({ message: 'TelegramId already used' })).toBe(true);
  });

  it('ignores other errors and non-objects', () => {
    expect(isTelegramMappingConflictError({ code: 'P2002', message: 'Unique constraint failed on the fields: (`username`)' })).toBe(false);
    expect(isTelegramMappingConflictError(new Error('connection lost'))).toBe(false);
    expect(isTelegramMappingConflictError('telegramid')).toBe(false);
    expect(isTelegramMappingConflictError(null)).toBe(false);
    expect(isTelegramMappingConflictError(undefined)).toBe(false);
  });
});

describe('withTelegramMappingConflict', () => {
  it('returns the write result', async () => {
    await expect(withTelegramMappingConflict(() => Promise.resolve({ id: 'u1' }))).resolves.toEqual({ id: 'u1' });
  });

  it('turns a Telegram mapping clash into CONFLICT with the Uzbek message', async () => {
    const write = () => Promise.reject(new Error('users_telegramid_key'));

    await expect(withTelegramMappingConflict(write)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Tanlangan Telegram foydalanuvchisi allaqachon boshqa akkauntga biriktirilgan.',
    });
    await expect(withTelegramMappingConflict(write)).rejects.toBeInstanceOf(TRPCError);
  });

  it('rethrows other errors unchanged', async () => {
    const original = new Error('connection lost');

    await expect(withTelegramMappingConflict(() => Promise.reject(original))).rejects.toBe(original);
  });
});

describe('validateNormalizedPhoneOrThrow', () => {
  it('keeps only digits and accepts 9 to 15 of them', () => {
    expect(validateNormalizedPhoneOrThrow('+998 (90) 123-45-67')).toBe('998901234567');
    expect(validateNormalizedPhoneOrThrow('901234567')).toBe('901234567');
    expect(validateNormalizedPhoneOrThrow('123456789012345')).toBe('123456789012345');
  });

  it('returns null for empty input', () => {
    expect(validateNormalizedPhoneOrThrow(undefined)).toBeNull();
    expect(validateNormalizedPhoneOrThrow('')).toBeNull();
    expect(validateNormalizedPhoneOrThrow('no digits')).toBeNull();
  });

  it('rejects too short and too long numbers with BAD_REQUEST', () => {
    expect(() => validateNormalizedPhoneOrThrow('12345678')).toThrow('Telefon raqam noto‘g‘ri formatda. 9-15 ta raqam kiriting.');
    expect(() => validateNormalizedPhoneOrThrow('1234567890123456')).toThrow(TRPCError);
  });
});

describe('generatePassword', () => {
  it('uses the unambiguous alphabet and the requested length', () => {
    const alphabet = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/;

    expect(generatePassword()).toHaveLength(12);
    expect(generatePassword(20)).toHaveLength(20);
    for (let index = 0; index < 50; index += 1) {
      expect(generatePassword()).toMatch(alphabet);
    }
    expect(generatePassword(0)).toBe('');
  });
});

describe('rolesNeedManagerMapping', () => {
  it('is true when any role is an agent-type role', () => {
    expect(rolesNeedManagerMapping(['Admin', 'Agent'])).toBe(true);
    expect(rolesNeedManagerMapping(['TeamLeader'])).toBe(true);
    expect(rolesNeedManagerMapping(['Admin', 'Finance'])).toBe(false);
    expect(rolesNeedManagerMapping([])).toBe(false);
  });
});
