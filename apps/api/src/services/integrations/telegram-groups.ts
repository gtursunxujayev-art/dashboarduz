/**
 * Telegram group ids configured through environment variables.
 *
 * Two parsers exist on purpose (see the reuse report): the routers and app.ts accept ids separated
 * by commas, semicolons or newlines and strip quotes and whitespace; the group-summary scheduler and
 * the integrations router split on commas only. They read some of the same variables.
 */

/** Ids separated by `,`, `;` or newlines; wrapping quotes and all whitespace removed; unique. */
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

/** Ids separated by commas only, trimmed, unique. */
export function parseCommaSeparatedTelegramGroupIds(value: string | null | undefined): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function parseFromEnvironment(keys: string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => parseCommaSeparatedTelegramGroupIds(process.env[key]))));
}

export function getOnlineTelegramGroupIds(): string[] {
  return parseFromEnvironment(['ONLINE_GROUP_ID', 'ONLINE_GROUP_IDS']);
}

export function getOfflineTelegramGroupIds(): string[] {
  return parseFromEnvironment([
    'OFLINE_GROUP_ID',
    'OFFLINE_GROUP_ID',
    'OFLINE_GROUP_IDS',
    'OFFLINE_GROUP_IDS',
  ]);
}
