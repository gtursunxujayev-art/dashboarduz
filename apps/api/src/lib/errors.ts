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
