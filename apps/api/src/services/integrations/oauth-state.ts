import crypto from 'crypto';

interface AmoCRMStatePayload {
  tenantId: string;
  userId: string;
  nonce: string;
  iat: number;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 10 * 60;

function getSigningSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required for OAuth state signing');
  }
  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSignedAmoCRMState(params: {
  tenantId: string;
  userId: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AmoCRMStatePayload = {
    tenantId: params.tenantId,
    userId: params.userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    iat: now,
    exp: now + (params.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadEncoded, getSigningSecret());
  return `${payloadEncoded}.${signature}`;
}

export function verifySignedAmoCRMState(state: string): AmoCRMStatePayload {
  const [payloadEncoded, signature] = state.split('.');
  if (!payloadEncoded || !signature) {
    throw new Error('Invalid OAuth state format');
  }

  const expectedSignature = sign(payloadEncoded, getSigningSecret());
  const provided = Buffer.from(signature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error('Invalid OAuth state signature');
  }

  const payload = JSON.parse(base64UrlDecode(payloadEncoded)) as AmoCRMStatePayload;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw new Error('OAuth state expired');
  }
  if (!payload.tenantId || !payload.userId) {
    throw new Error('OAuth state payload is incomplete');
  }

  return payload;
}
