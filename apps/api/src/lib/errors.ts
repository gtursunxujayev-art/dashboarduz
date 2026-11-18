/**
 * Reading thrown values. `catch (error)` gives `unknown`; these turn it into loggable text without `any`.
 */

/** The message of an `Error`, else `String(error)`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The stack of an `Error`, else `undefined`. */
export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** The `name` of an `Error` (e.g. `AbortError`), else `undefined`. */
export function errorName(error: unknown): string | undefined {
  if (error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string') {
    return (error as { name: string }).name;
  }

  return undefined;
}

/** A string `code` property (Prisma `P2002`, Node `ECONNREFUSED`, ...), else `undefined`. */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return undefined;
}

/*
 * The two loose readings below reproduce what `catch (error: any)` blocks used to do, so their text stays exactly as
 * before: unlike {@link errorMessage} they read `message` from any thrown object, and an empty message falls through.
 */

function thrownMessageProperty(error: unknown): unknown {
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    return (error as { message?: unknown }).message;
  }

  return undefined;
}

/** `String(error?.message || error)`: the message when it is non-empty, else the thrown value itself as text. */
export function thrownText(error: unknown): string {
  return String(thrownMessageProperty(error) || error);
}

/** `error?.message || fallback`: the message when it is non-empty, else `fallback`. */
export function thrownMessageOr(error: unknown, fallback: string): string {
  const message = thrownMessageProperty(error);

  return message ? String(message) : fallback;
}

/** The `error.message` read: the message when it is a string, else `undefined`. */
export function messagePropertyOfError(error: unknown): string | undefined {
  const message = thrownMessageProperty(error);

  return typeof message === 'string' ? message : undefined;
}
