import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) {
    return false;
  }

  const calculatedHash = scryptSync(password, salt, KEY_LENGTH);
  const storedBuffer = Buffer.from(hash, 'hex');

  if (calculatedHash.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(calculatedHash, storedBuffer);
}
