import type { Request } from 'express';

import { asObject, textFromUnknown } from '../lib/object';
import { isLikelyExternalPhone, normalizePhoneKeepPlus } from '../lib/phone';
import { normalizeCallDirection } from '../lib/utel';

export function resolveVoipProvider(req: Request): string {
  const headerProvider = req.headers['x-voip-provider'];
  const queryProvider = req.query.provider;
  const bodyProvider = req.body?.provider || req.body?.operator || req.body?.vendor;

  const provider = String(
    (Array.isArray(headerProvider) ? headerProvider[0] : headerProvider)
      || (Array.isArray(queryProvider) ? queryProvider[0] : queryProvider)
      || bodyProvider
      || 'utel',
  ).trim().toLowerCase();

  return provider || 'utel';
}

function getMetadataCandidates(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const metadata = value as Record<string, unknown>;
  const candidates: Record<string, unknown>[] = [metadata];
  const nestedKeys = ['call', 'data', 'payload', 'event', 'params', 'meta', 'details', 'call_data'];

  for (const nestedKey of nestedKeys) {
    const nested = metadata[nestedKey];

    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      candidates.push(nested as Record<string, unknown>);
    }
  }

  return candidates;
}

function getCaseInsensitiveMetadataValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }

  const normalizedKey = key.toLowerCase();

  for (const [currentKey, currentValue] of Object.entries(source)) {
    if (currentKey.toLowerCase() === normalizedKey) {
      return currentValue;
    }
  }

  return undefined;
}

export function pickMetadataValue(metadata: unknown, keys: string[]): string | null {
  const candidates = getMetadataCandidates(metadata);

  for (const candidate of candidates) {
    for (const key of keys) {
      const value = getCaseInsensitiveMetadataValue(candidate, key);

      if (value !== null && value !== undefined) {
        const normalized = textFromUnknown(value);

        if (normalized) {
          return normalized;
        }
      }
    }
  }

  return null;
}

export function isLikelyInternalPhone(value: string | null): boolean {
  const normalized = normalizePhoneKeepPlus(value);
  const digits = normalized.replace(/\D/g, '');

  return digits.length > 0 && digits.length <= 6;
}

export function firstTextValue(values: unknown[]): string | null {
  for (const value of values) {
    const parsed = textFromUnknown(value);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseUtelDateTimeToUtcIso(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const raw = value.trim();

  if (!raw) {
    return null;
  }

  const withTimezone = /([zZ]|[+-]\d{2}:\d{2})$/.test(raw);

  if (withTimezone) {
    const parsed = new Date(raw);

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const normalized = raw.replace(' ', 'T');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);

  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    // UTeL sends local time in GMT+5, convert to UTC for storage.
    const utcMillis = Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh) - 5,
      Number(mm),
      Number(ss),
    );
    const parsed = new Date(utcMillis);

    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const fallback = new Date(normalized);

  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);

    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function buildCallHistoryFromFlatPayload(bodyPayload: Record<string, unknown>): Record<string, unknown> | null {
  const callHistory: Record<string, unknown> = {};
  let hasAny = false;

  for (const [key, value] of Object.entries(bodyPayload)) {
    let fieldKey: string | null = null;

    const bracketDataMatch = key.match(/^data\[call_history\]\[([^\]]+)\]$/);

    if (bracketDataMatch) {
      fieldKey = bracketDataMatch[1] || null;
    }

    const bracketDirectMatch = key.match(/^call_history\[([^\]]+)\]$/);

    if (!fieldKey && bracketDirectMatch) {
      fieldKey = bracketDirectMatch[1] || null;
    }

    const dottedDataMatch = key.match(/^data\.call_history\.([^.]+)$/);

    if (!fieldKey && dottedDataMatch) {
      fieldKey = dottedDataMatch[1] || null;
    }

    const dottedDirectMatch = key.match(/^call_history\.([^.]+)$/);

    if (!fieldKey && dottedDirectMatch) {
      fieldKey = dottedDirectMatch[1] || null;
    }

    if (fieldKey) {
      callHistory[fieldKey] = value;
      hasAny = true;
    }
  }

  return hasAny ? callHistory : null;
}

function resolveFlatEventName(bodyPayload: Record<string, unknown>): string {
  const direct = String(
    bodyPayload.event
    || bodyPayload.name
    || bodyPayload.event_type
    || '',
  ).trim().toLowerCase();

  if (direct) {
    return direct;
  }

  const fromFlatData = String(bodyPayload['data[name]'] || bodyPayload['data.name'] || '').trim().toLowerCase();

  return fromFlatData;
}

function inferUtelDirection(src: string, dst: string, rawDirection: unknown): 'inbound' | 'outbound' {
  const explicitRaw = textFromUnknown(rawDirection);
  const explicit = normalizeCallDirection(explicitRaw || undefined);

  if (explicitRaw) {
    return explicit;
  }

  const srcInternal = isLikelyInternalPhone(src);
  const dstInternal = isLikelyInternalPhone(dst);
  const srcExternal = isLikelyExternalPhone(src);
  const dstExternal = isLikelyExternalPhone(dst);

  if (srcInternal && dstExternal) {
    return 'outbound';
  }
  if (srcExternal && dstInternal) {
    return 'inbound';
  }

  return 'inbound';
}

export function prepareVoipPayload(provider: string, bodyPayload: Record<string, unknown>): {
  ignored: boolean;
  reason?: string;
  payload: Record<string, unknown>;
  eventType: string;
} {
  if (provider !== 'utel') {
    return {
      ignored: false,
      payload: { ...bodyPayload, provider },
      eventType: typeof bodyPayload.event_type === 'string' && bodyPayload.event_type.trim()
        ? bodyPayload.event_type
        : 'call_event',
    };
  }

  const dataObj = asObject(bodyPayload.data);
  const eventName = String(
    (dataObj?.name as string | undefined)
    || (bodyPayload.event as string | undefined)
    || (bodyPayload.name as string | undefined)
    || (bodyPayload.event_type as string | undefined)
    || resolveFlatEventName(bodyPayload)
    || '',
  ).trim().toLowerCase();
  const callHistory = asObject((dataObj?.call_history as unknown)
    || bodyPayload.call_history
    || bodyPayload.callHistory)
    || buildCallHistoryFromFlatPayload(bodyPayload);

  if (callHistory) {
    const pickExternal = (values: unknown[]): string => {
      for (const value of values) {
        const normalized = normalizePhoneKeepPlus(String(value || ''));

        if (isLikelyExternalPhone(normalized)) {
          return normalized;
        }
      }

      return '';
    };
    const src = normalizePhoneKeepPlus(String(callHistory.src || callHistory.from || callHistory.source || ''));
    const dst = normalizePhoneKeepPlus(String(callHistory.dst || callHistory.to || callHistory.destination || ''));
    const direction = inferUtelDirection(
      src,
      dst,
      callHistory.direction
      || callHistory.call_direction
      || dataObj?.direction
      || bodyPayload.direction
      || bodyPayload.call_direction,
    );
    const inboundPhoneCandidate = pickExternal([
      callHistory.caller,
      callHistory.caller_number,
      callHistory.client_phone,
      callHistory.client_number,
      callHistory.customer_phone,
      callHistory.number,
      callHistory.cid_num,
      callHistory.from,
      callHistory.src,
      callHistory.phone,
      callHistory.external_number,
    ]);
    const outboundPhoneCandidate = pickExternal([
      callHistory.src,
      callHistory.from,
      callHistory.caller,
      callHistory.caller_number,
      callHistory.phone,
      callHistory.external_number,
      callHistory.number,
      callHistory.dst,
      callHistory.to,
    ]);
    const destinationExternalCandidate = pickExternal([
      callHistory.dst,
      callHistory.to,
      callHistory.destination,
      callHistory.callee,
      callHistory.callee_number,
      callHistory.client_phone,
      callHistory.external_number,
      callHistory.phone,
    ]);
    const externalPhone = direction === 'inbound'
      ? (inboundPhoneCandidate || destinationExternalCandidate || outboundPhoneCandidate)
      : (outboundPhoneCandidate || destinationExternalCandidate || inboundPhoneCandidate);
    const extensionCandidate = normalizePhoneKeepPlus(String(
      callHistory.extension
      || callHistory.ext
      || (direction === 'outbound' ? src : dst)
      || '',
    ));
    const extension = isLikelyInternalPhone(extensionCandidate) ? extensionCandidate : '';
    const manager = firstTextValue([
      callHistory.manager,
      callHistory.manager_name,
      callHistory.user_name,
      callHistory.agent_name,
      callHistory.operator_name,
      callHistory.employee_name,
    ]);
    const duration = toInt(callHistory.conversation ?? callHistory.duration ?? callHistory.billsec);
    const startedAtIso = parseUtelDateTimeToUtcIso(
      callHistory.date_time
      || callHistory.start_time
      || callHistory.started_at,
    );

    const normalizedCall = {
      call_id: String(
        callHistory.call_id
        || callHistory.linkedid
        || callHistory.uniqueid
        || callHistory.uuid
        || callHistory.id
        || '',
      ).trim() || undefined,
      direction,
      from: src,
      to: dst,
      src,
      dst,
      extension,
      phone: externalPhone,
      external_number: externalPhone || undefined,
      manager_name: manager || undefined,
      duration: duration ?? undefined,
      conversation: duration ?? undefined,
      start_time: startedAtIso || undefined,
      date_time: callHistory.date_time || undefined,
      status: firstTextValue([callHistory.status, callHistory.state, bodyPayload.status, bodyPayload.state]) || 'completed',
      raw_call_history: callHistory,
    };

    return {
      ignored: false,
      eventType: 'call_saved',
      payload: {
        ...bodyPayload,
        provider,
        event_type: 'call_saved',
        call: normalizedCall,
        call_history: callHistory,
      },
    };
  }

  if (eventName && eventName !== 'call_saved') {
    return {
      ignored: true,
      reason: `ignored_utel_event_${eventName}`,
      payload: { ...bodyPayload, provider },
      eventType: eventName,
    };
  }

  return {
    ignored: true,
    reason: 'ignored_utel_event_missing_call_history',
    payload: { ...bodyPayload, provider },
    eventType: eventName || 'call_event',
  };
}
