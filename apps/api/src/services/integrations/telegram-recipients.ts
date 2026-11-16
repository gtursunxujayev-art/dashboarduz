type TelegramRecipientRecord = {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  started: boolean;
  selectedForReports: boolean;
  startedAt: string | null;
  lastSeenAt: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }

  return fallback;
}

function buildDisplayName(row: {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();

  if (fullName) {
    return fullName;
  }
  if (row.username) {
    return `@${row.username}`;
  }

  return row.chatId;
}

export function parseTelegramRecipients(config: unknown): TelegramRecipientRecord[] {
  const configObject = asObject(config);
  const recipientsRaw = Array.isArray(configObject?.telegramReportRecipients)
    ? configObject?.telegramReportRecipients
    : [];
  const recipientsMap = new Map<string, TelegramRecipientRecord>();

  for (const rawItem of recipientsRaw) {
    const row = asObject(rawItem);

    if (!row) {
      continue;
    }

    const chatId = normalizeString(row.chatId);

    if (!chatId) {
      continue;
    }

    const username = normalizeString(row.username);
    const firstName = normalizeString(row.firstName);
    const lastName = normalizeString(row.lastName);
    const startedAt = normalizeString(row.startedAt);
    const lastSeenAt = normalizeString(row.lastSeenAt);

    recipientsMap.set(chatId, {
      chatId,
      username,
      firstName,
      lastName,
      displayName: normalizeString(row.displayName) || buildDisplayName({ chatId, username, firstName, lastName }),
      started: normalizeBoolean(row.started, true),
      selectedForReports: normalizeBoolean(row.selectedForReports, false),
      startedAt,
      lastSeenAt,
    });
  }

  return Array.from(recipientsMap.values())
    .sort((a, b) => {
      const left = `${a.displayName}`.toLowerCase();
      const right = `${b.displayName}`.toLowerCase();

      if (left < right) return -1;
      if (left > right) return 1;

      return 0;
    });
}

export function applyTelegramRecipientsToConfig(
  config: unknown,
  recipients: TelegramRecipientRecord[],
): Record<string, unknown> {
  const configObject = asObject(config) || {};
  const normalizedRecipients = recipients.map((recipient) => ({
    chatId: recipient.chatId,
    username: recipient.username || null,
    firstName: recipient.firstName || null,
    lastName: recipient.lastName || null,
    displayName: recipient.displayName,
    started: recipient.started,
    selectedForReports: recipient.selectedForReports,
    startedAt: recipient.startedAt || null,
    lastSeenAt: recipient.lastSeenAt || null,
  }));

  const reportRecipientChatIds = normalizedRecipients
    .filter((recipient) => recipient.started && recipient.selectedForReports)
    .map((recipient) => recipient.chatId);

  return {
    ...configObject,
    telegramReportRecipients: normalizedRecipients,
    reportRecipientChatIds,
  };
}

export type { TelegramRecipientRecord };
