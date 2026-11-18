import { parse } from 'qs';

import {
  amoWebhookAccountId,
  amoWebhookContactField,
  amoWebhookContactListValue,
  amoWebhookEntities,
  amoWebhookEventType,
  amoWebhookLeadFields,
  faceIdWebhookEventType,
  telegramWebhookEventType,
  telegramWebhookUpdateId,
  webhookField,
  webhookTextOrNull,
} from '../payloads';

describe('webhookField', () => {
  it('reads object keys and array indexes, and nothing from primitives', () => {
    expect(webhookField({ a: 1 }, 'a')).toBe(1);
    expect(webhookField(['x', 'y'], 1)).toBe('y');
    expect(webhookField({ 0: 'zero' }, 0)).toBe('zero');
    expect(webhookField('abc', 0)).toBeUndefined();
    expect(webhookField(null, 'a')).toBeUndefined();
    expect(webhookField(undefined, 'a')).toBeUndefined();
  });
});

describe('webhookTextOrNull', () => {
  it('passes strings, maps falsy values to null and rejects other values', () => {
    expect(webhookTextOrNull('Deal', 'name')).toBe('Deal');
    expect(webhookTextOrNull('', 'name')).toBeNull();
    expect(webhookTextOrNull(0, 'name')).toBeNull();
    expect(webhookTextOrNull(undefined, 'name')).toBeNull();
    expect(() => webhookTextOrNull(42, 'lead name')).toThrow('Webhook field lead name must be text');
    expect(() => webhookTextOrNull({ a: 1 }, 'event_type')).toThrow(TypeError);
  });
});

describe('amoCRM webhook payloads', () => {
  // amoCRM posts application/x-www-form-urlencoded; express.urlencoded({ extended: true }) parses it with qs.
  const formBody = {
    account: { id: '29500000', subdomain: 'acme' },
    leads: {
      add: [
        { id: '101', name: 'New deal', status_id: '142', pipeline_id: '7', responsible_user_id: '9', created_at: '1700000000' },
      ],
    },
  };

  it('reads the account id from account[id] or account_id', () => {
    expect(amoWebhookAccountId(formBody)).toBe('29500000');
    expect(amoWebhookAccountId({ account_id: 77 })).toBe(77);
    expect(amoWebhookAccountId({ account: { id: 0 }, account_id: 5 })).toBe(0);
    expect(amoWebhookAccountId({ account: 'x', account_id: '5' })).toBe('5');
    expect(amoWebhookAccountId(undefined)).toBeUndefined();
    expect(amoWebhookAccountId([])).toBeUndefined();
  });

  it('derives the event type from event_type, leads or contacts', () => {
    expect(amoWebhookEventType({ event_type: 'lead_status_changed', leads: [] })).toBe('lead_status_changed');
    expect(amoWebhookEventType(formBody)).toBe('leads');
    expect(amoWebhookEventType({ event_type: '', contacts: { update: [] } })).toBe('contacts');
    expect(amoWebhookEventType({})).toBe('unknown');
    expect(amoWebhookEventType(undefined)).toBe('unknown');
    expect(() => amoWebhookEventType({ event_type: 3 })).toThrow('Webhook field event_type must be text');
  });

  it('finds entities as a list, under add, or under _embedded', () => {
    const lead = { id: '1' };

    expect(amoWebhookEntities({ leads: [lead] }, 'leads')).toEqual([lead]);
    expect(amoWebhookEntities({ leads: { add: [lead] } }, 'leads')).toEqual([lead]);
    expect(amoWebhookEntities({ _embedded: { contacts: [lead] } }, 'contacts')).toEqual([lead]);
    expect(amoWebhookEntities({ leads: { update: [lead] } }, 'leads')).toEqual([]);
    expect(amoWebhookEntities({ leads: 'oops' }, 'leads')).toEqual([]);
    expect(amoWebhookEntities(null, 'leads')).toEqual([]);
  });

  it('parses a real form-encoded lead webhook end to end', () => {
    // The same parser (qs) express.urlencoded({ extended: true }) uses.
    const body: unknown = parse(
      'account%5Bid%5D=29500000&account%5Bsubdomain%5D=acme'
      + '&leads%5Bstatus%5D%5B0%5D%5Bid%5D=101&leads%5Bstatus%5D%5B0%5D%5Bstatus_id%5D=142'
      + '&contacts%5Badd%5D%5B0%5D%5Bid%5D=55&contacts%5Badd%5D%5B0%5D%5Bname%5D=Ali',
    );

    expect(amoWebhookAccountId(body)).toBe('29500000');
    expect(amoWebhookEventType(body)).toBe('leads');
    // A status change is not an `add` list, so it carries no leads to store.
    expect(amoWebhookEntities(body, 'leads')).toEqual([]);
    expect(amoWebhookEntities(body, 'contacts')).toEqual([{ id: '55', name: 'Ali' }]);
  });

  it('picks the lead fields of an item', () => {
    const [item] = amoWebhookEntities(formBody, 'leads');

    expect(amoWebhookLeadFields(item)).toEqual({
      id: '101',
      name: 'New deal',
      status_id: '142',
      pipeline_id: '7',
      responsible_user_id: '9',
      created_at: '1700000000',
      updated_at: undefined,
    });
    expect(amoWebhookLeadFields(null)).toEqual({
      id: undefined,
      name: undefined,
      status_id: undefined,
      pipeline_id: undefined,
      responsible_user_id: undefined,
      created_at: undefined,
      updated_at: undefined,
    });
  });

  it('reads contact custom fields by field_code or code, case-insensitively', () => {
    const contact = {
      custom_fields_values: [
        { field_code: 'phone', values: [{ value: '+998901234567' }] },
        { code: 'EMAIL', values: [{ value: 'a@b.uz' }] },
        { field_code: 'POSITION', values: [{ value: 5 }] },
      ],
    };

    expect(amoWebhookContactField(contact, 'PHONE')).toBe('+998901234567');
    expect(amoWebhookContactField(contact, 'EMAIL')).toBe('a@b.uz');
    expect(amoWebhookContactField(contact, 'POSITION')).toBeNull();
    expect(amoWebhookContactField(contact, 'WEB')).toBeNull();
    expect(amoWebhookContactField({ custom_fields_values: 'x' }, 'PHONE')).toBeNull();
    expect(amoWebhookContactField(undefined, 'PHONE')).toBeNull();
  });

  it('reads the legacy phone/email lists of a contact', () => {
    expect(amoWebhookContactListValue({ phone: [{ value: '123' }] }, 'phone')).toBe('123');
    expect(amoWebhookContactListValue({ email: { 0: { value: 'x@y.z' } } }, 'email')).toBe('x@y.z');
    expect(amoWebhookContactListValue({ phone: 'abc' }, 'phone')).toBeUndefined();
    expect(amoWebhookContactListValue(null, 'phone')).toBeUndefined();
  });
});

describe('Telegram webhook payloads', () => {
  it('derives the event type from the update kind', () => {
    expect(telegramWebhookEventType({ update_id: 1, message: { text: '/start' } })).toBe('message');
    expect(telegramWebhookEventType({ update_id: 1, callback_query: { data: 'x' } })).toBe('callback_query');
    expect(telegramWebhookEventType({ update_id: 1, my_chat_member: {} })).toBe('update');
    expect(telegramWebhookEventType(undefined)).toBe('update');
  });

  it('reads update_id as text', () => {
    expect(telegramWebhookUpdateId({ update_id: 912345678 })).toBe('912345678');
    expect(telegramWebhookUpdateId({ update_id: 0 })).toBeNull();
    expect(telegramWebhookUpdateId({})).toBeNull();
    expect(telegramWebhookUpdateId('x')).toBeNull();
  });
});

describe('Face ID webhook payloads', () => {
  it('reads event_type, then request.event_type, else check_in_out', () => {
    expect(faceIdWebhookEventType({ event_type: 'check_in' })).toBe('check_in');
    expect(faceIdWebhookEventType({ request: { event_type: 'check_out' } })).toBe('check_out');
    expect(faceIdWebhookEventType({ event_type: 7 })).toBe('7');
    expect(faceIdWebhookEventType({})).toBe('check_in_out');
    expect(faceIdWebhookEventType(null)).toBe('check_in_out');
  });
});
