import jwt from 'jsonwebtoken';
import type { JWTPayload } from '@dashboarduz/shared';
import { logger } from '../../lib/logger';

const DEFAULT_JWT_SECRET = 'change-me-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  logger.error({ msg: 'CRITICAL: JWT_SECRET unset (or default) in production; using insecure default value. Tokens are forgeable.' });
}

export function signJWT(payload: JWTPayload): string {
  return jwt.sign(payload as object, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function verifyJWT(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}
