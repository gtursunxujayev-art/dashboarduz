import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

/** `salt:hash` (hex) for a password. The hashing is synchronous; the promise is kept for callers. */
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');

  return Promise.resolve(`${salt}:${hash}`);
}

/** Whether `password` matches a `salt:hash` value from {@link hashPassword}; malformed values give `false`. */
export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');

  if (!salt || !hash) {
    return Promise.resolve(false);
  }

  const calculatedHash = scryptSync(password, salt, KEY_LENGTH);
  const storedBuffer = Buffer.from(hash, 'hex');

  if (calculatedHash.length !== storedBuffer.length) {
    return Promise.resolve(false);
  }

  return Promise.resolve(timingSafeEqual(calculatedHash, storedBuffer));
}
