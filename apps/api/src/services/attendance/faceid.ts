import crypto from 'crypto';
import { prisma } from '@dashboarduz/db';

const REPORT_TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // GMT+5
const REQUIRED_WORK_SECONDS_MON_TO_SAT = 9 * 60 * 60;

type FaceIdPayloadUser = {
  id?: string | number | null;
  first_name?: string | null;
  last_name?: string | null;
  phone_number?: string | null;
  role?: string | null;
};

export type FaceIdPayload = {
  event_type?: string | null;
  action?: string | null;
  user?: FaceIdPayloadUser | null;
  timestamp?: string | null;
  local_time?: string | null;
  local_date?: string | null;
  local_time_only?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  source?: string | null;
  branch_name?: string | null;
  late_minutes?: string | number | null;
};

type FaceIdParsedEvent = {
  eventType: string;
  action: 'IN' | 'OUT';
  eventAt: Date;
  localDate: string;
  localTime: string | null;
  externalUserId: string | null;
  externalPhone: string | null;
  firstName: string | null;
  lastName: string | null;
  externalRole: string | null;
  branchName: string | null;
  latitude: number | null;
  longitude: number | null;
  lateMinutes: number;
  source: string;
  idempotencyKey: string;
  rawPayload: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizePhone(value: string | null | undefined): string {
  return String(value || '').replace(/\D/g, '').trim();
}

function toReportLocal(date: Date): Date {
  return new Date(date.getTime() + REPORT_TZ_OFFSET_MS);
}

function formatReportDate(date: Date): string {
  const local = toReportLocal(date);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatReportTime(date: Date): string {
  const local = toReportLocal(date);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const ss = String(local.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function parseTimestampOrNow(inputTimestamp: string | null | undefined): Date {
  const parsed = new Date(String(inputTimestamp || '').trim());
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return new Date();
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getRawFaceIdPayload(input: unknown): Record<string, unknown> {
  const body = asObject(input) || {};
  const nestedRequest = asObject(body.request);
  if (nestedRequest) {
    return nestedRequest;
  }
  return body;
}

function buildIdempotencyKey(payload: FaceIdPayload): string {
  const source = String(payload.source || 'FACE_ID').trim().toUpperCase();
  const action = String(payload.action || '').trim().toUpperCase();
  const externalUserId = String(payload.user?.id || '').trim();
  const timestamp = String(payload.timestamp || payload.local_time || '').trim();
  const branchName = String(payload.branch_name || '').trim();
  const rawKey = `${source}:${action}:${externalUserId}:${timestamp}:${branchName}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function parseFaceIdEvent(input: unknown): FaceIdParsedEvent | null {
  const rawPayload = getRawFaceIdPayload(input);
  const payload = rawPayload as FaceIdPayload;
  const eventType = String(payload.event_type || '').trim().toLowerCase();
  if (eventType !== 'check_in_out') {
    return null;
  }

  const action = String(payload.action || '').trim().toUpperCase();
  if (action !== 'IN' && action !== 'OUT') {
    return null;
  }

  const eventAt = parseTimestampOrNow(payload.timestamp);
  const localDate = String(payload.local_date || '').trim() || formatReportDate(eventAt);
  const localTime = String(payload.local_time_only || '').trim()
    || String(payload.local_time || '').trim()
    || formatReportTime(eventAt);
  const externalPhone = normalizePhone(payload.user?.phone_number || null) || null;
  const lateMinutesRaw = parseNumeric(payload.late_minutes);
  const lateMinutes = lateMinutesRaw && Number.isFinite(lateMinutesRaw)
    ? Math.max(0, Math.floor(lateMinutesRaw))
    : 0;

  return {
    eventType,
    action,
    eventAt,
    localDate,
    localTime: localTime || null,
    externalUserId: payload.user?.id !== undefined && payload.user?.id !== null
      ? String(payload.user.id).trim()
      : null,
    externalPhone,
    firstName: String(payload.user?.first_name || '').trim() || null,
    lastName: String(payload.user?.last_name || '').trim() || null,
    externalRole: String(payload.user?.role || '').trim() || null,
    branchName: String(payload.branch_name || '').trim() || null,
    latitude: parseNumeric(payload.latitude),
    longitude: parseNumeric(payload.longitude),
    lateMinutes,
    source: String(payload.source || 'FACE_ID').trim().toUpperCase() || 'FACE_ID',
    idempotencyKey: buildIdempotencyKey(payload),
    rawPayload,
  };
}

function parseExternalUserMap(config: unknown): Record<string, string> {
  const mapHolder = asObject(config)?.userExternalMap;
  if (!mapHolder || typeof mapHolder !== 'object' || Array.isArray(mapHolder)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapHolder)) {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function parseBranchWhitelist(config: unknown): Set<string> {
  const raw = asObject(config)?.branchWhitelist;
  if (!Array.isArray(raw)) {
    return new Set();
  }

  const normalized = raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  return new Set(normalized);
}

function parseUnmatchedUserPolicy(config: unknown): 'store' | 'ignore' {
  const raw = asObject(config)?.unmatchedUserPolicy;
  const normalized = String(raw || '').trim().toLowerCase();
  return normalized === 'ignore' ? 'ignore' : 'store';
}

async function resolveMatchedUserId(params: {
  tenantId: string;
  parsed: FaceIdParsedEvent;
  integrationConfig: unknown;
}): Promise<string | null> {
  const userExternalMap = parseExternalUserMap(params.integrationConfig);
  if (params.parsed.externalUserId && userExternalMap[params.parsed.externalUserId]) {
    return userExternalMap[params.parsed.externalUserId] || null;
  }

  if (!params.parsed.externalPhone) {
    return null;
  }

  const candidates = await prisma.user.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      phone: { not: null },
    },
    select: {
      id: true,
      phone: true,
    },
    take: 5000,
  });

  const normalizedExternalPhone = normalizePhone(params.parsed.externalPhone);
  const matched = candidates.find((candidate) => normalizePhone(candidate.phone) === normalizedExternalPhone);
  return matched?.id || null;
}

function requiredSecondsForDate(localDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return REQUIRED_WORK_SECONDS_MON_TO_SAT;
  }
  const [year, month, day] = localDate.split('-').map((part) => Number.parseInt(part, 10));
  if (!year || !month || !day) {
    return REQUIRED_WORK_SECONDS_MON_TO_SAT;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utc.getUTCDay(); // 0: Sunday
  if (dayOfWeek === 0) {
    return 0;
  }
  return REQUIRED_WORK_SECONDS_MON_TO_SAT;
}

export async function recomputeAttendanceDaySummary(params: {
  tenantId: string;
  userId: string;
  localDate: string;
}): Promise<void> {
  const events = await prisma.attendanceEvent.findMany({
    where: {
      tenantId: params.tenantId,
      userId: params.userId,
      localDate: params.localDate,
    },
    orderBy: [
      { eventAt: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      action: true,
      eventAt: true,
      lateMinutes: true,
    },
  });

  let workedSeconds = 0;
  let unmatchedInCount = 0;
  let unmatchedOutCount = 0;
  let firstInAt: Date | null = null;
  let firstInLateMinutes = 0;
  let lastOutAt: Date | null = null;
  let openInAt: Date | null = null;

  for (const event of events) {
    const action = String(event.action || '').toUpperCase();
    if (action === 'IN') {
      if (openInAt) {
        unmatchedInCount += 1;
      }
      openInAt = event.eventAt;
      if (!firstInAt) {
        firstInAt = event.eventAt;
        firstInLateMinutes = Math.max(0, Math.floor(event.lateMinutes || 0));
      }
      continue;
    }

    if (action === 'OUT') {
      if (!openInAt || event.eventAt.getTime() < openInAt.getTime()) {
        unmatchedOutCount += 1;
        continue;
      }
      workedSeconds += Math.max(0, Math.floor((event.eventAt.getTime() - openInAt.getTime()) / 1000));
      openInAt = null;
      lastOutAt = event.eventAt;
    }
  }

  if (openInAt) {
    unmatchedInCount += 1;
  }

  const requiredSeconds = requiredSecondsForDate(params.localDate);
  const missingSeconds = Math.max(requiredSeconds - workedSeconds, 0);
  const absence = requiredSeconds > 0 && workedSeconds === 0;
  const lateCount = firstInLateMinutes > 0 ? 1 : 0;
  const anomalyCount = unmatchedInCount + unmatchedOutCount;

  await prisma.attendanceDaySummary.upsert({
    where: {
      tenantId_userId_summaryDate: {
        tenantId: params.tenantId,
        userId: params.userId,
        summaryDate: params.localDate,
      },
    },
    create: {
      tenantId: params.tenantId,
      userId: params.userId,
      summaryDate: params.localDate,
      workedSeconds,
      requiredSeconds,
      missingSeconds,
      lateMinutes: firstInLateMinutes,
      lateCount,
      absence,
      unmatchedInCount,
      unmatchedOutCount,
      anomalyCount,
      firstInAt: firstInAt || null,
      lastOutAt: lastOutAt || null,
      sourceUpdatedAt: new Date(),
    },
    update: {
      workedSeconds,
      requiredSeconds,
      missingSeconds,
      lateMinutes: firstInLateMinutes,
      lateCount,
      absence,
      unmatchedInCount,
      unmatchedOutCount,
      anomalyCount,
      firstInAt: firstInAt || null,
      lastOutAt: lastOutAt || null,
      sourceUpdatedAt: new Date(),
    },
  });
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
        reason: 'branch_not_allowed',
      };
    }
  }

  const matchedUserId = await resolveMatchedUserId({
    tenantId: params.tenantId,
    parsed,
    integrationConfig: params.integrationConfig,
  });

  const unmatchedUserPolicy = parseUnmatchedUserPolicy(params.integrationConfig);
  if (!matchedUserId && unmatchedUserPolicy === 'ignore') {
    return {
      ignored: true,
      reason: 'unmatched_user',
    };
  }

  const created = await prisma.attendanceEvent.upsert({
    where: {
      tenantId_idempotencyKey: {
        tenantId: params.tenantId,
        idempotencyKey: parsed.idempotencyKey,
      },
    },
    create: {
      tenantId: params.tenantId,
      userId: matchedUserId,
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
      idempotencyKey: parsed.idempotencyKey,
      rawPayload: parsed.rawPayload as any,
    },
    update: {
      userId: matchedUserId,
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
      rawPayload: parsed.rawPayload as any,
    },
    select: {
      id: true,
      userId: true,
      localDate: true,
    },
  });

  if (created.userId) {
    await recomputeAttendanceDaySummary({
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

export async function recomputeAttendanceSummariesForRange(params: {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  userId?: string;
}): Promise<{ recomputed: number }> {
  const events = await prisma.attendanceEvent.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.userId ? { userId: params.userId } : {}),
      localDate: {
        gte: params.dateFrom,
        lte: params.dateTo,
      },
      userId: { not: null },
    },
    select: {
      userId: true,
      localDate: true,
    },
    distinct: ['userId', 'localDate'],
  });

  let recomputed = 0;
  for (const event of events) {
    if (!event.userId) {
      continue;
    }
    await recomputeAttendanceDaySummary({
      tenantId: params.tenantId,
      userId: event.userId,
      localDate: event.localDate,
    });
    recomputed += 1;
  }

  return { recomputed };
}
