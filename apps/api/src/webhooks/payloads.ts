/**
 * The webhook payload shapes this API reads, narrowed from `unknown` in one place.
 *
 * Bodies arrive through `express.json` or `express.urlencoded({ extended: true })` (amoCRM posts form-encoded
 * webhooks, so `account[id]=1&leads[add][0][id]=2` becomes nested objects and arrays of strings). The stored
 * `rawPayload` is that parsed body; the background processors read the same fields from it again.
 */
import type { Prisma } from '@dashboarduz/db';

import { asObject, asObjectOrEmpty } from '../lib/object';

/** `value[key]` for objects and arrays (`{ '0': x }` and `[x]` alike), `undefined` for anything else. */
export function webhookField(value: unknown, key: string | number): unknown {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  return (value as Record<string | number, unknown>)[key];
}

/**
 * A value bound for a text column: strings pass, falsy values give `null`. Any other value used to reach Prisma
 * and fail its validation; it still fails (with this error) instead of being stored coerced.
 */
export function webhookTextOrNull(value: unknown, field: string): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }

  throw new TypeError(`Webhook field ${field} must be text`);
}

/**
 * A parsed request body (or a stored `rawPayload`) as Prisma JSON input. Bodies come out of JSON.parse or qs,
 * so they are JSON values by construction.
 */
export function webhookPayloadJson(payload: unknown): Prisma.InputJsonValue {
  return payload as Prisma.InputJsonValue;
}

/** The amoCRM account of a webhook: `account[id]` (form-encoded) or `account_id`, not yet converted to text. */
export function amoWebhookAccountId(payload: unknown): unknown {
  const body = asObject(payload);

  return asObject(body?.account)?.id ?? body?.account_id;
}

/** `event_type` when present, else whether the webhook carries `leads` or `contacts`. */
export function amoWebhookEventType(payload: unknown): string {
  const body = asObjectOrEmpty(payload);

  return webhookTextOrNull(body.event_type, 'event_type')
    || (body.leads ? 'leads' : body.contacts ? 'contacts' : 'unknown');
}

/**
 * The leads or contacts of an amoCRM webhook: the list itself, its `add` list (`leads[add][0][...]`), or
 * `_embedded.<key>` (API format). Items are not narrowed; see {@link amoWebhookLeadFields}.
 */
export function amoWebhookEntities(payload: unknown, key: 'leads' | 'contacts'): unknown[] {
  const direct = webhookField(payload, key);

  if (Array.isArray(direct)) {
    return direct;
  }

  const add = webhookField(direct, 'add');

  if (Array.isArray(add)) {
    return add;
  }

  const embedded = webhookField(webhookField(payload, '_embedded'), key);

  if (Array.isArray(embedded)) {
    return embedded;
  }

  return [];
}

/** The lead fields an amoCRM webhook item carries (all optional; form-encoded values are strings). */
export interface AmoWebhookLeadFields {
  id: unknown;
  name: unknown;
  status_id: unknown;
  pipeline_id: unknown;
  responsible_user_id: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export function amoWebhookLeadFields(item: unknown): AmoWebhookLeadFields {
  return {
    id: webhookField(item, 'id'),
    name: webhookField(item, 'name'),
    status_id: webhookField(item, 'status_id'),
    pipeline_id: webhookField(item, 'pipeline_id'),
    responsible_user_id: webhookField(item, 'responsible_user_id'),
    created_at: webhookField(item, 'created_at'),
    updated_at: webhookField(item, 'updated_at'),
  };
}

/** The first `values[0].value` of the custom field whose `field_code` (or `code`) is `code`, when it is a string. */
export function amoWebhookContactField(contact: unknown, code: string): string | null {
  const fieldsValue = webhookField(contact, 'custom_fields_values');
  const fields: unknown[] = Array.isArray(fieldsValue) ? fieldsValue : [];
  const field = fields.find((item) => {
    const fieldCode = webhookField(item, 'field_code') || webhookField(item, 'code') || '';

    return String(fieldCode).toUpperCase() === code;
  });
  const value = webhookField(webhookField(webhookField(field, 'values'), 0), 'value');

  return typeof value === 'string' ? value : null;
}

/** `contact[key][0].value`: the legacy phone/email list of a contact. */
export function amoWebhookContactListValue(contact: unknown, key: 'phone' | 'email'): unknown {
  return webhookField(webhookField(webhookField(contact, key), 0), 'value');
}

/** `message`, `callback_query`, or `update` for any other Telegram update. */
export function telegramWebhookEventType(payload: unknown): string {
  const body = asObjectOrEmpty(payload);

  return body.message ? 'message' : body.callback_query ? 'callback_query' : 'update';
}

/** The Telegram `update_id` as text, or `null` when absent. */
export function telegramWebhookUpdateId(payload: unknown): string | null {
  const updateId = webhookField(payload, 'update_id');

  return updateId ? String(updateId) : null;
}

/** `event_type` (or `request.event_type`) of a Face ID device event; `check_in_out` when absent. */
export function faceIdWebhookEventType(payload: unknown): string {
  const body = asObjectOrEmpty(payload);

  return String(body.event_type || webhookField(body.request, 'event_type') || 'check_in_out');
}
