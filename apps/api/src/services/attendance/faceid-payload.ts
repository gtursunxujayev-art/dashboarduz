import crypto from 'crypto';

import { normalizeDigits, shiftToTashkent, toTashkentDateKey } from '@dashboarduz/shared';

import { asObject } from '../../lib/object';

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

export type FaceIdParsedEvent = {
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

function normalizeFullNameToken(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildNormalizedFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return normalizeFullNameToken(`${String(firstName || '').trim()} ${String(lastName || '').trim()}`);
}

function formatReportTime(date: Date): string {
  const local = shiftToTashkent(date);
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

function buildFaceIdIdempotencyKey(payload: FaceIdPayload): string {
  const source = String(payload.source || 'FACE_ID').trim().toUpperCase();
  const action = String(payload.action || '').trim().toUpperCase();
  const externalUserId = String(payload.user?.id || '').trim();
  const timestamp = String(payload.timestamp || payload.local_time || '').trim();
  const branchName = String(payload.branch_name || '').trim();
  const rawKey = `${source}:${action}:${externalUserId}:${timestamp}:${branchName}`;

  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function parseFaceIdEvent(input: unknown): FaceIdParsedEvent | null {
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
  const localDate = String(payload.local_date || '').trim() || toTashkentDateKey(eventAt);
  const localTime = String(payload.local_time_only || '').trim()
    || String(payload.local_time || '').trim()
    || formatReportTime(eventAt);
  const externalPhone = normalizeDigits(payload.user?.phone_number || null) || null;
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
    idempotencyKey: buildFaceIdIdempotencyKey(payload),
    rawPayload,
  };
}
