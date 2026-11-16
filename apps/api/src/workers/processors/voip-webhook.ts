import { systemPrisma } from '@dashboarduz/db';

import { normalizePhoneKeepPlus } from '../../lib/phone';
import { isAllowedUtelManagerExtension } from '../../lib/utel';

import { choosePreferredNumber, extractVoipCallEntries, normalizeVoipCall } from './voip-call-normalize';

export async function processVoIPWebhook(event: any, tenantId: string) {
  const payload = (event.rawPayload as Record<string, unknown> | null) || {};
  const provider = String(payload.provider || payload.operator || payload.vendor || payload.source || 'utel')
    .trim()
    .toLowerCase() || 'utel';
  const callEntries = extractVoipCallEntries(payload);

  if (!callEntries.length) {
    return;
  }

  const contacts = await systemPrisma.contact.findMany({
    where: {
      tenantId,
      phone: { not: null },
    },
    select: { id: true, phone: true },
    take: 5000,
  });
  let utelManagersByKey = new Map<string, string>();

  try {
    const mappedUsers = await systemPrisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        utelManagerExternalId: { not: null },
      },
      select: {
        utelManagerExternalId: true,
        name: true,
        username: true,
      },
    });

    utelManagersByKey = new Map(
      (mappedUsers as Array<{ utelManagerExternalId: string | null; name: string | null; username: string | null }>)
        .filter((user) => Boolean(user.utelManagerExternalId))
        .map((user) => ({
          ...user,
          normalizedExtension: normalizePhoneKeepPlus(String(user.utelManagerExternalId || '')),
        }))
        .filter((user) => isAllowedUtelManagerExtension(user.normalizedExtension))
        .map((user) => [
          user.normalizedExtension.toLowerCase(),
          (user.name || user.username || String(user.utelManagerExternalId || '')).trim(),
        ]),
    );
  } catch {
    utelManagersByKey = new Map();
  }

  for (let index = 0; index < callEntries.length; index += 1) {
    const entry = callEntries[index];

    if (!entry) {
      continue;
    }
    const normalizedCall = normalizeVoipCall(entry, `${provider}-${event.id}-${index}`);
    const normalizedExtension = normalizePhoneKeepPlus(normalizedCall.extension || '').toLowerCase();
    const managerFromMap = normalizedExtension && isAllowedUtelManagerExtension(normalizedExtension)
      ? utelManagersByKey.get(normalizedExtension)
      : null;
    const finalManager = normalizedCall.manager || managerFromMap || null;
    const finalMetadata = {
      ...(normalizedCall.metadata || {}),
      normalized_manager: finalManager,
      normalized_extension: normalizedCall.extension,
      normalized_phone: normalizedCall.externalPhone,
      normalized_duration: normalizedCall.duration,
    } as any;

    const existingCall = await systemPrisma.call.findUnique({
      where: {
        tenantId_provider_callIdExternal: {
          tenantId,
          provider,
          callIdExternal: normalizedCall.callIdExternal,
        },
      },
      select: {
        id: true,
        from: true,
        to: true,
        direction: true,
        duration: true,
        metadata: true,
        startedAt: true,
        endedAt: true,
      },
    });

    const mergedMetadata = {
      ...((existingCall?.metadata && typeof existingCall.metadata === 'object')
        ? existingCall.metadata as Record<string, unknown>
        : {}),
      ...finalMetadata,
    } as any;

    let upsertedCall;

    if (existingCall) {
      const existingFrom = existingCall.from || '';
      const existingTo = existingCall.to || '';
      const mergedFrom = choosePreferredNumber(existingFrom, normalizedCall.from);
      const mergedTo = choosePreferredNumber(existingTo, normalizedCall.to);
      const currentDirection = existingCall.direction || 'inbound';
      const shouldUpdateDirection = normalizedCall.directionConfidence === 'high'
        || !currentDirection;
      const existingDuration = existingCall.duration;
      const nextDuration = normalizedCall.duration !== null
        ? normalizedCall.duration
        : existingDuration;

      upsertedCall = await systemPrisma.call.update({
        where: { id: existingCall.id },
        data: {
          provider,
          from: mergedFrom,
          to: mergedTo,
          ...(normalizedCall.status ? { status: normalizedCall.status } : {}),
          ...(nextDuration !== null ? { duration: nextDuration } : {}),
          ...(normalizedCall.recordingUrl ? { recordingUrl: normalizedCall.recordingUrl } : {}),
          ...(normalizedCall.recordingId ? { recordingId: normalizedCall.recordingId } : {}),
          ...(normalizedCall.startedAt ? { startedAt: normalizedCall.startedAt } : {}),
          ...(normalizedCall.endedAt ? { endedAt: normalizedCall.endedAt } : {}),
          ...(shouldUpdateDirection ? { direction: normalizedCall.direction } : {}),
          metadata: mergedMetadata,
        },
      });
    } else {
      upsertedCall = await systemPrisma.call.create({
        data: {
          tenantId,
          provider,
          callIdExternal: normalizedCall.callIdExternal,
          from: normalizedCall.from,
          to: normalizedCall.to,
          direction: normalizedCall.direction,
          status: normalizedCall.status,
          duration: normalizedCall.duration,
          recordingUrl: normalizedCall.recordingUrl,
          recordingId: normalizedCall.recordingId,
          metadata: finalMetadata,
          startedAt: normalizedCall.startedAt,
          endedAt: normalizedCall.endedAt,
        },
      });
    }

    const matchedContact = (contacts as Array<{ id: string; phone: string | null }>).find((contact) => {
      const normalized = normalizePhoneKeepPlus(contact.phone);

      return normalized && (
        normalized === normalizedCall.externalPhone
        || normalized === normalizedCall.from
        || normalized === normalizedCall.to
      );
    });

    if (!matchedContact) {
      continue;
    }

    const lead = await systemPrisma.lead.findFirst({
      where: { tenantId, contactId: matchedContact.id },
      orderBy: { updatedAt: 'desc' },
    });

    await systemPrisma.call.update({
      where: { id: upsertedCall.id },
      data: {
        contactId: matchedContact.id,
        leadId: lead?.id || null,
      },
    });
  }
}
