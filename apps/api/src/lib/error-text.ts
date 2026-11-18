/**
 * Typed versions of two loose ways of reading a thrown value, kept so their results stay exactly as before.
 *
 * Unlike `errorMessage` in `./errors`, both read `message` from any thrown object, not only from `Error`s.
 */

/** The `message` property of a thrown value, or `undefined` when there is none. */
function rawMessageOf(error: unknown): unknown {
  return error === null || error === undefined ? undefined : (error as { message?: unknown }).message;
}

/** The `String(error?.message || error)` idiom: the message when it is non-empty, else `String(error)` (`new Error('')` gives `'Error'`). */
export function messageOrStringOfError(error: unknown): string {
  return String(rawMessageOf(error) || error);
}

/** The `error.message` read: the message when it is a string, else `undefined`. */
export function messagePropertyOfError(error: unknown): string | undefined {
  const message = rawMessageOf(error);

  return typeof message === 'string' ? message : undefined;
}
