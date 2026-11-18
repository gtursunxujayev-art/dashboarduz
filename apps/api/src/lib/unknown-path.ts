/**
 * `root?.[a]?.[b]?.[c]` for a value of unknown shape (webhook payloads, third-party API bodies).
 * Each step reads a property of an object or array; once a step lands on `null`, `undefined` or a primitive,
 * the result is `undefined`.
 */
export function valueAtPath(root: unknown, ...path: ReadonlyArray<string | number>): unknown {
  let current: unknown = root;

  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }

  return current;
}
