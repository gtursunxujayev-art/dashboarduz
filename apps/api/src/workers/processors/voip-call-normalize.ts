import { getCaseInsensitiveValue, textFromUnknownOrEmpty } from '../../lib/object';
import { isLikelyExternalPhone, normalizePhoneKeepPlus } from '../../lib/phone';
import { normalizeCallDirection } from '../../lib/utel';

function parseCallDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const asNumber = Number(trimmed);

    if (!Number.isNaN(asNumber)) {
      return parseCallDate(asNumber);
    }

    // UTeL often sends local date_time without timezone in GMT+5.
    const normalized = trimmed.replace(' ', 'T');
    const localDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

    if (localDateMatch) {
      const [, y, m, d, hh, mm, ss] = localDateMatch;
      const utcMillis = Date.UTC(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh) - 5,
        Number(mm),
        Number(ss),
      );
      const parsedFromLocal = new Date(utcMillis);

      return Number.isNaN(parsedFromLocal.getTime()) ? null : parsedFromLocal;
    }

    const parsed = new Date(trimmed);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getObjectCandidates(entry: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  const nestedKeys = [
    'call',
    'data',
    'payload',
    'event',
    'params',
    'meta',
    'details',
    'call_data',
    'call_history',
    'cdr',
    'record',
    'event_data',
  ];
  const queue: Record<string, unknown>[] = [entry];
  const seen = new Set<Record<string, unknown>>();

  while (queue.length > 0) {
    const current = queue.shift() as Record<string, unknown>;

    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    candidates.push(current);

    for (const nestedKey of nestedKeys) {
      const nested = current[nestedKey];

      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        queue.push(nested as Record<string, unknown>);
      }
    }
  }

  return candidates;
}

function pickVoipValue(entry: Record<string, unknown>, keys: string[]): unknown {
  const candidates = getObjectCandidates(entry);

  for (const candidate of candidates) {
    for (const key of keys) {
      const value = getCaseInsensitiveValue(candidate, key);

      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return value;
      }
    }
  }

  return undefined;
}

function isInternalNumber(value: string): boolean {
  const digits = value.replace(/\D/g, '');

  return digits.length > 0 && digits.length <= 6;
}

type NormalizedVoipCall = {
  callIdExternal: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  duration: number | null;
  directionConfidence: 'high' | 'low';
  externalPhone: string | null;
  extension: string | null;
  manager: string | null;
  recordingUrl: string | null;
  recordingId: string | null;
  metadata: Record<string, unknown>;
};

export function choosePreferredNumber(existing: string | null | undefined, incoming: string | null | undefined): string {
  const existingNormalized = normalizePhoneKeepPlus(existing || '');
  const incomingNormalized = normalizePhoneKeepPlus(incoming || '');

  if (!existingNormalized && incomingNormalized) {
    return incomingNormalized;
  }

  if (!incomingNormalized) {
    return existingNormalized;
  }

  const existingInternal = isInternalNumber(existingNormalized);
  const incomingInternal = isInternalNumber(incomingNormalized);

  if (existingInternal && !incomingInternal) {
    return incomingNormalized;
  }

  return existingNormalized || incomingNormalized;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.includes(':')) {
      const parts = trimmed.split(':').map((part) => Number.parseInt(part, 10));

      if (parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
        const hhOrMm = parts[0] ?? 0;
        const mmOrSs = parts[1] ?? 0;
        const maybeSs = parts[2] ?? 0;
        const seconds = parts.length === 2
          ? (hhOrMm * 60 + mmOrSs)
          : (hhOrMm * 3600 + mmOrSs * 60 + maybeSs);

        return Math.max(0, seconds);
      }
    }

    const parsed = Number.parseInt(trimmed, 10);

    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
}

export function extractVoipCallEntries(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const candidates: unknown[] = [
    payload.call,
    payload.event,
    payload.data,
    payload.recentCalls,
    payload.calls,
    payload.call_events,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object',
      );
    }

    if (candidate && typeof candidate === 'object') {
      return [candidate as Record<string, unknown>];
    }
  }

  return [payload];
}

export function normalizeVoipCall(entry: Record<string, unknown>, fallbackCallId: string): NormalizedVoipCall {
  const rawDirection = textFromUnknownOrEmpty(pickVoipValue(entry, [
    'direction',
    'call_direction',
    'call_type',
    'type',
    'event',
    'event_type',
  ]));

  const phone = normalizePhoneKeepPlus(textFromUnknownOrEmpty(pickVoipValue(entry, [
    'phone',
    'phone_number',
    'client_phone',
    'client_number',
    'customer_phone',
    'customer_number',
    'external_phone',
    'external_number',
    'number',
    'callee_number',
    'destination_number',
    'dialed_number',
    'destination',
    'dst',
    'dst_num',
    'did',
    'cid_num',
  ])));
  const extensionRaw = normalizePhoneKeepPlus(textFromUnknownOrEmpty(pickVoipValue(entry, [
    'extension',
    'extension_number',
    'ext',
    'internal',
    'line',
    'line_number',
    'agent_extension',
    'agent_ext',
    'internal_number',
    'src',
    'src_num',
    'callerid',
  ])));
  const extension = isInternalNumber(extensionRaw) ? extensionRaw : '';
  const manager = textFromUnknownOrEmpty(pickVoipValue(entry, [
    'manager',
    'managerName',
    'manager_name',
    'manager_full_name',
    'agent',
    'agent_name',
    'agent_full_name',
    'responsible_name',
    'operator',
    'operator_name',
    'user',
    'user_name',
    'user_display_name',
    'employee_name',
    'extension_name',
    'ext_name',
    'employee',
    'responsible',
  ])) || null;

  let from = normalizePhoneKeepPlus(textFromUnknownOrEmpty(pickVoipValue(entry, [
    'from',
    'caller',
    'caller_id',
    'caller_number',
    'from_number',
    'src',
  ])));
  let to = normalizePhoneKeepPlus(textFromUnknownOrEmpty(pickVoipValue(entry, [
    'to',
    'callee',
    'callee_number',
    'to_number',
    'dialed_number',
    'destination',
    'dst',
  ])));

  let direction = normalizeCallDirection(rawDirection);
  const hasExplicitDirection = rawDirection.length > 0;

  if (!from && !to) {
    from = direction === 'outbound' ? extension : phone;
    to = direction === 'outbound' ? phone : extension;
  }

  if (!hasExplicitDirection && from && to) {
    const fromInternal = isInternalNumber(from);
    const toInternal = isInternalNumber(to);

    if (fromInternal && !toInternal) {
      direction = 'outbound';
    } else if (!fromInternal && toInternal) {
      direction = 'inbound';
    }
  }

  if (!hasExplicitDirection && phone && extension) {
    const fromInternal = isInternalNumber(from);
    const toInternal = isInternalNumber(to);
    const fromExternal = isLikelyExternalPhone(from);
    const toExternal = isLikelyExternalPhone(to);

    if ((fromInternal && !toInternal) || (fromInternal && toExternal)) {
      direction = 'outbound';
    } else if ((toInternal && !fromInternal) || (toInternal && fromExternal)) {
      direction = 'inbound';
    } else if (!from && extension) {
      direction = 'outbound';
    }
  }
  const directionConfidence: 'high' | 'low' = hasExplicitDirection
    || (from && to && (isInternalNumber(from) !== isInternalNumber(to)))
    || Boolean(isLikelyExternalPhone(phone))
    ? 'high'
    : 'low';

  if (direction === 'outbound') {
    if (!isLikelyExternalPhone(to) && isLikelyExternalPhone(phone)) {
      to = phone;
    }
    if (!from && extension) {
      from = extension;
    }
  } else {
    if (!isLikelyExternalPhone(from) && isLikelyExternalPhone(phone)) {
      from = phone;
    }
    if (!to && extension) {
      to = extension;
    }
  }

  const pickLikelyExternal = (values: unknown[]): string | null => {
    for (const value of values) {
      const candidate = normalizePhoneKeepPlus(textFromUnknownOrEmpty(value) || '');

      if (isLikelyExternalPhone(candidate)) {
        return candidate;
      }
    }

    return null;
  };

  const inboundExternalPhone = pickLikelyExternal([
    pickVoipValue(entry, ['caller', 'caller_number', 'customer_phone', 'client_phone', 'number', 'cid_num']),
    from,
    phone,
    to,
  ]);
  const outboundExternalPhone = pickLikelyExternal([
    from,
    pickVoipValue(entry, ['external_number', 'phone', 'client_phone', 'number', 'caller', 'caller_number']),
    to,
    phone,
  ]);
  const externalPhone = direction === 'inbound'
    ? (inboundExternalPhone || outboundExternalPhone)
    : (outboundExternalPhone || inboundExternalPhone);

  const startedAt = parseCallDate(pickVoipValue(entry, [
    'date_time',
    'start_time',
    'started_at',
    'startedAt',
    'date',
    'created_at',
    'timestamp',
    'time',
  ])) || new Date();
  const endedAt = parseCallDate(pickVoipValue(entry, [
    'end_time',
    'ended_at',
    'endedAt',
    'finished_at',
    'hangup_time',
  ]));
  const parsedDuration = parseDurationSeconds(pickVoipValue(entry, [
    'conversation',
    'duration',
    'call_duration',
    'total_duration',
    'billsec',
    'bill_sec',
    'talk_duration',
    'conversation_duration',
    'talk_seconds',
    'talk_time',
    'duration_sec',
  ]));
  const duration = parsedDuration ?? (endedAt
    ? Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000))
    : null);

  const callIdExternal = textFromUnknownOrEmpty(pickVoipValue(entry, [
    'call_id',
    'linkedid',
    'session_id',
    'uuid',
    'call_uuid',
    'uniqueid',
    'id',
    'record_id',
    'cdr_id',
  ])) || fallbackCallId;

  return {
    callIdExternal,
    from,
    to,
    direction,
    status: textFromUnknownOrEmpty(pickVoipValue(entry, ['status', 'call_status', 'state', 'result'])) || 'completed',
    startedAt,
    endedAt,
    duration,
    directionConfidence,
    externalPhone,
    extension: extension || (isInternalNumber(direction === 'outbound' ? from : to)
      ? (direction === 'outbound' ? from : to)
      : null),
    manager,
    recordingUrl: (() => {
      const value = pickVoipValue(entry, ['recording_url', 'record_url', 'record_url_mp3', 'recording_link']);

      return value ? String(value) : null;
    })(),
    recordingId: (() => {
      const value = pickVoipValue(entry, ['recording_id', 'record_id']);

      return value ? String(value) : null;
    })(),
    metadata: {
      ...entry,
      normalized_phone: externalPhone,
      normalized_extension: extension || (isInternalNumber(direction === 'outbound' ? from : to)
        ? (direction === 'outbound' ? from : to)
        : null),
      normalized_manager: manager,
      normalized_duration: duration,
      normalized_direction: direction,
      normalized_direction_confidence: directionConfidence,
    },
  };
}
