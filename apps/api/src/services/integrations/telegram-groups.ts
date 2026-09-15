export function parseTelegramGroupIds(value: string | null | undefined): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function parseFromEnvironment(keys: string[]): string[] {
  return Array.from(new Set(keys.flatMap((key) => parseTelegramGroupIds(process.env[key]))));
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
