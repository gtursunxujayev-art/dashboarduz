import { TRPCError } from '@trpc/server';

export function normalizeBaseUrl(url?: string): string | null {
  if (!url) {
    return null;
  }

  return url.replace(/\/+$/, '');
}

type AmoFailureReason = 'decrypt_failed' | 'token_invalid' | 'network_timeout' | 'amo_unavailable';

export function detectAmoFailureReason(error: unknown): AmoFailureReason {
  const message = String((error as any)?.message || '').toLowerCase();

  if (message.includes('failed to decrypt integration tokens')) {
    return 'decrypt_failed';
  }
  if (message.includes('timeout') || message.includes('abort')) {
    return 'network_timeout';
  }
  if (
    message.includes('failed to validate amocrm long-lived token')
    || message.includes(' 401')
    || message.includes(' 403')
    || message.includes('unauthorized')
    || message.includes('forbidden')
  ) {
    return 'token_invalid';
  }

  return 'amo_unavailable';
}

export function amoFailureMessage(prefix: string, reason: AmoFailureReason): string {
  return `${prefix} (${reason})`;
}

export function amoFailureHelp(reason: AmoFailureReason): string | null {
  if (reason === 'decrypt_failed') {
    return "Tokenni qayta ulash kerak (AmoCRM'ni uzib, qayta ulang).";
  }
  if (reason === 'token_invalid') {
    return "Token eskirgan yoki noto'g'ri. Yangi token bilan qayta ulang.";
  }
  if (reason === 'network_timeout') {
    return "Tarmoq kechikishi kuzatildi. Qayta urining.";
  }

  return null;
}

export function telegramRecipientStorageErrorMessage(): string {
  return "Telegram foydalanuvchilari jadvali tayyor emas. Railway'da `npm run db:migrate:deploy` ni ishga tushiring, so'ng API va Worker'ni qayta deploy qiling.";
}

export function getPublicApiBaseUrl(): string {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_API_URL || process.env.API_URL);

  if (explicit) {
    return explicit;
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;

  if (railwayDomain) {
    return `https://${railwayDomain.replace(/\/+$/, '')}`;
  }

  const port = process.env.PORT || '3001';

  return `http://localhost:${port}`;
}

export async function fetchAmoCRMAccountByToken(accessToken: string, baseUrl: string) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.AMOCRM_REQUEST_TIMEOUT_MS || 10000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/api/v4/account`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new TRPCError({
        code: 'TIMEOUT',
        message: amoFailureMessage('Failed to validate AmoCRM long-lived token', 'network_timeout'),
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: amoFailureMessage(`Failed to validate AmoCRM long-lived token (${response.status})`, 'token_invalid'),
    });
  }

  return response.json() as Promise<{
    id?: number | string;
    name?: string;
    domain?: string;
    subdomain?: string;
  }>;
}
