import { prisma } from '@dashboarduz/db';
import { parseTelegramRecipients, type TelegramRecipientRecord } from './telegram-recipients';

type RecipientUpsertInput = {
  tenantId: string;
  integrationId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  started?: boolean;
  lastSeenAt?: Date;
  lastUpdateId?: string | null;
};

function normalizeText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function displayName(input: {
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const fullName = [normalizeText(input.firstName), normalizeText(input.lastName)].filter(Boolean).join(' ');
  return fullName || (normalizeText(input.username) ? `@${normalizeText(input.username)}` : input.chatId);
}

function toRecord(row: {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  started: boolean;
  selectedForReports: boolean;
  startedAt: Date | null;
  lastSeenAt: Date | null;
}): TelegramRecipientRecord {
  return {
    chatId: row.chatId,
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    started: row.started,
    selectedForReports: row.selectedForReports,
    startedAt: row.startedAt?.toISOString() || null,
    lastSeenAt: row.lastSeenAt?.toISOString() || null,
  };
}

export async function importLegacyTelegramRecipients(params: {
  tenantId: string;
  integrationId: string;
  config: unknown;
}): Promise<void> {
  const recipients = parseTelegramRecipients(params.config);
  if (!recipients.length) return;

  await prisma.telegramRecipient.createMany({
    data: recipients.map((recipient) => ({
      tenantId: params.tenantId,
      integrationId: params.integrationId,
      chatId: recipient.chatId,
      username: recipient.username,
      firstName: recipient.firstName,
      lastName: recipient.lastName,
      displayName: recipient.displayName,
      started: recipient.started,
      selectedForReports: recipient.selectedForReports,
      startedAt: recipient.startedAt ? new Date(recipient.startedAt) : null,
      lastSeenAt: recipient.lastSeenAt ? new Date(recipient.lastSeenAt) : null,
    })),
    skipDuplicates: true,
  });
}

export async function listTelegramRecipients(params: {
  tenantId: string;
  integrationId: string;
  startedOnly?: boolean;
}): Promise<TelegramRecipientRecord[]> {
  const rows = await prisma.telegramRecipient.findMany({
    where: {
      tenantId: params.tenantId,
      integrationId: params.integrationId,
      ...(params.startedOnly ? { started: true } : {}),
    },
    orderBy: [{ displayName: 'asc' }, { chatId: 'asc' }],
    select: {
      chatId: true,
      username: true,
      firstName: true,
      lastName: true,
      displayName: true,
      started: true,
      selectedForReports: true,
      startedAt: true,
      lastSeenAt: true,
    },
  });
  return rows.map(toRecord);
}

export async function upsertTelegramRecipientRecord(input: RecipientUpsertInput) {
  const chatId = normalizeText(input.chatId);
  if (!chatId) throw new Error('chatId is required to upsert Telegram recipient');

  const username = normalizeText(input.username);
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const seenAt = input.lastSeenAt || new Date();
  const started = Boolean(input.started);
  const row = await prisma.telegramRecipient.upsert({
    where: {
      integrationId_chatId: {
        integrationId: input.integrationId,
        chatId,
      },
    },
    create: {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      chatId,
      username,
      firstName,
      lastName,
      displayName: displayName({ chatId, username, firstName, lastName }),
      started,
      startedAt: started ? seenAt : null,
      lastSeenAt: seenAt,
      lastUpdateId: normalizeText(input.lastUpdateId),
    },
    update: {
      ...(username ? { username } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ...(username || firstName || lastName
        ? { displayName: displayName({ chatId, username, firstName, lastName }) }
        : {}),
      ...(started ? { started: true } : {}),
      lastSeenAt: seenAt,
      lastUpdateId: normalizeText(input.lastUpdateId),
    },
  });

  return row;
}

export async function updateTelegramRecipientSelection(params: {
  tenantId: string;
  integrationId: string;
  selectedChatIds: string[];
}): Promise<string[]> {
  const selectedChatIds = Array.from(new Set(params.selectedChatIds.map((id) => id.trim()).filter(Boolean)));
  const available = await prisma.telegramRecipient.findMany({
    where: { tenantId: params.tenantId, integrationId: params.integrationId, started: true },
    select: { chatId: true },
  });
  const availableSet = new Set(available.map((row) => row.chatId));
  const unknown = selectedChatIds.find((chatId) => !availableSet.has(chatId));
  if (unknown) throw new Error(`Unknown Telegram recipient chat id: ${unknown}`);

  await prisma.$transaction([
    prisma.telegramRecipient.updateMany({
      where: { tenantId: params.tenantId, integrationId: params.integrationId, selectedForReports: true },
      data: { selectedForReports: false },
    }),
    prisma.telegramRecipient.updateMany({
      where: {
        tenantId: params.tenantId,
        integrationId: params.integrationId,
        started: true,
        chatId: { in: selectedChatIds },
      },
      data: { selectedForReports: true },
    }),
  ]);
  return selectedChatIds;
}
