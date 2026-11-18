/**
 * Low-level amoCRM HTTP: bearer headers, the abort-based timeout, and turning a non-OK response into
 * a logged, thrown error. Which endpoints use the timeout is decided in `amocrm.ts`.
 */
import { errorName } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { asObject } from '../../lib/object';

/** What to log and throw when amoCRM answers with a non-OK status. */
export type AmoFailure = {
  /** Logged with `{ error: <body text>, status, ...logContext }`. */
  logMessage: string;
  /** Thrown as `<failureMessage>: <status> <statusText>`. */
  failureMessage: string;
  logContext?: Record<string, unknown>;
};

export function amoJsonHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * The `message` property of a thrown value as it is (`undefined` for non-objects). Our catch blocks
 * log and re-throw exactly this, so a value without a message still reads "undefined".
 */
export function thrownMessage(error: unknown): unknown {
  return asObject(error)?.message;
}

/** `fetch` that aborts after `timeoutMs`, reported as `AmoCRM request timeout after <n>ms`. */
export async function fetchWithAbortTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (errorName(error) === 'AbortError') {
      throw new Error(`AmoCRM request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureAmoOk(response: Response, failure: AmoFailure): Promise<Response> {
  if (!response.ok) {
    const errorText = await response.text();

    logger.error({ error: errorText, status: response.status, ...failure.logContext }, failure.logMessage);
    throw new Error(`${failure.failureMessage}: ${response.status} ${response.statusText}`);
  }

  return response;
}

/** GET with the bearer token and no timeout. */
export async function amoGet(url: string, accessToken: string, failure: AmoFailure): Promise<Response> {
  return ensureAmoOk(await fetch(url, { headers: amoJsonHeaders(accessToken) }), failure);
}

/** GET with the bearer token, aborted after `timeoutMs`. */
export async function amoGetWithTimeout(
  url: string,
  accessToken: string,
  failure: AmoFailure,
  timeoutMs: number,
): Promise<Response> {
  return ensureAmoOk(await fetchWithAbortTimeout(url, { headers: amoJsonHeaders(accessToken) }, timeoutMs), failure);
}

/** POST / PATCH a JSON body with the bearer token (no timeout); resolves to the parsed answer. */
export async function amoSendJson(
  url: string,
  accessToken: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  failure: AmoFailure,
): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: amoJsonHeaders(accessToken),
    body: JSON.stringify(body),
  });

  return (await ensureAmoOk(response, failure)).json() as Promise<unknown>;
}

/** Logs `{ error: <message> }` under `logMessage` and throws `<prefix>: <message>`. */
export function rethrowAmoError(error: unknown, logMessage: string, prefix: string): never {
  const message = thrownMessage(error);

  logger.error({ error: message }, logMessage);
  throw new Error(`${prefix}: ${String(message)}`);
}

/** True when `data._embedded[key]` is present (truthy), as the list endpoints promise. */
export function hasEmbeddedList(data: unknown, key: string): boolean {
  return Boolean(asObject(asObject(data)?._embedded)?.[key]);
}
