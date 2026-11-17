/**
 * Telegram group ids configured through environment variables. Every reader of these settings uses
 * {@link parseTelegramGroupIds}: ids may be separated by commas, semicolons or new lines.
 */

/** The online sales group (payment messages and the online group summary). */
export const ONLINE_GROUP_ENV_KEYS = ['ONLINE_GROUP_ID', 'ONLINE_GROUP_IDS'] as const;

/** The offline sales group; `OFLINE_*` is the historical spelling and still read. */
export const OFFLINE_GROUP_ENV_KEYS = ['OFLINE_GROUP_ID', 'OFFLINE_GROUP_ID', 'OFLINE_GROUP_IDS', 'OFFLINE_GROUP_IDS'] as const;

/** Ids separated by `,`, `;` or new lines; wrapping quotes and all whitespace removed; unique. */
export function parseTelegramGroupIds(rawValue: string | null | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .split(/[,\n;]+/g)
        .map((value) => value.replace(/^['"`]+|['"`]+$/g, '').trim())
        .map((value) => value.replace(/\s+/g, ''))
        .filter(Boolean),
    ),
  );
}

/** {@link parseTelegramGroupIds} over several environment variables, unique. */
export function parseTelegramGroupIdsFromEnvKeys(keys: readonly string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => parseTelegramGroupIds(process.env[key]))));
}

export function getOnlineTelegramGroupIds(): string[] {
  return parseTelegramGroupIdsFromEnvKeys(ONLINE_GROUP_ENV_KEYS);
}

export function getOfflineTelegramGroupIds(): string[] {
  return parseTelegramGroupIdsFromEnvKeys(OFFLINE_GROUP_ENV_KEYS);
}
