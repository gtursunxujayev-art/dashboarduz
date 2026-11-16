export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export function sanitizeTelegram(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}
