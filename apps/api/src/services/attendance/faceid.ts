import crypto from 'crypto';

import { type Prisma, systemPrisma } from '@dashboarduz/db';

import { recomputeAttendanceDaySummary } from './day-summary';
import { parseBranchWhitelist, parseUnmatchedUserPolicy, resolveMatchedUserId } from './faceid-matching';
import { parseFaceIdEvent } from './faceid-payload';

export { type FaceIdPayload } from './faceid-payload';
export { recomputeAttendanceDaySummary, recomputeAttendanceSummariesForRange } from './day-summary';

/** FaceID webhook tokens are stored and compared as SHA-256 hex digests. */
export function hashFaceIdWebhookToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function ingestFaceIdEvent(params: {
  tenantId: string;
  integrationConfig: unknown;
  payload: unknown;
}): Promise<{
  ignored: boolean;
  reason?: string;
  eventId?: string;
  userId?: string | null;
  localDate?: string;
}> {
  const parsed = parseFaceIdEvent(params.payload);

  if (!parsed) {
    return {
      ignored: true,
      reason: 'unsupported_event',
    };
  }

  const branchWhitelist = parseBranchWhitelist(params.integrationConfig);

  if (branchWhitelist.size > 0) {
    const incomingBranch = String(parsed.branchName || '').trim().toLowerCase();

    if (!incomingBranch || !branchWhitelist.has(incomingBranch)) {
      return {
        ignored: true,
        reason: 'branch_filtered',
      };
    }
  }

  const match = await resolveMatchedUserId({
    tenantId: params.tenantId,
    parsed,
    integrationConfig: params.integrationConfig,
  });

  const unmatchedUserPolicy = parseUnmatchedUserPolicy(params.integrationConfig);

  if (!match.userId && unmatchedUserPolicy === 'ignore') {
    return {
      ignored: true,
      reason: match.matchReason || 'unmatched_user',
    };
  }

  const rawPayloadWithMatchMeta = {
    ...parsed.rawPayload,
    __matchMeta: {
      matchReason: match.matchReason,
      matchStepTried: match.matchStepTried,
      rawUser: match.rawUser,
    },
  };

  const eventFields = {
    userId: match.userId,
    externalUserId: parsed.externalUserId,
    externalPhone: parsed.externalPhone,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    externalRole: parsed.externalRole,
    eventType: parsed.eventType,
    action: parsed.action,
    eventAt: parsed.eventAt,
    localDate: parsed.localDate,
    localTime: parsed.localTime,
    source: parsed.source,
    branchName: parsed.branchName,
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    lateMinutes: parsed.lateMinutes,
    rawPayload: rawPayloadWithMatchMeta as Prisma.InputJsonValue,
  };

  const created = await systemPrisma.attendanceEvent.upsert({
    where: {
      tenantId_idempotencyKey: {
        tenantId: params.tenantId,
        idempotencyKey: parsed.idempotencyKey,
      },
    },
    create: {
      tenantId: params.tenantId,
      ...eventFields,
      idempotencyKey: parsed.idempotencyKey,
    },
    update: eventFields,
    select: {
      id: true,
      userId: true,
      localDate: true,
    },
  });

  if (created.userId) {
    await recomputeAttendanceDaySummary({
      db: systemPrisma,
      tenantId: params.tenantId,
      userId: created.userId,
      localDate: created.localDate,
    });
  }

  return {
    ignored: false,
    eventId: created.id,
    userId: created.userId,
    localDate: created.localDate,
  };
}
