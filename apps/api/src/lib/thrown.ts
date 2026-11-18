/**
 * Text out of a thrown value, written to match the `error?.message || ...` expressions that `catch (error: any)`
 * blocks used before (unlike `errorMessage` in `./errors`, an empty `message` falls through to the fallback).
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
