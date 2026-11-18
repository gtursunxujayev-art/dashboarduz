import { thrownMessageOr, thrownText } from '../errors';
import { valueAtPath } from '../unknown-path';

describe('thrownText', () => {
  it('uses a non-empty message', () => {
    expect(thrownText(new Error('Telegram API error: Forbidden'))).toBe('Telegram API error: Forbidden');
    expect(thrownText({ message: 'plain object' })).toBe('plain object');
  });

  it('falls back to the thrown value itself', () => {
    expect(thrownText(new Error(''))).toBe('Error');
    expect(thrownText('boom')).toBe('boom');
    expect(thrownText(42)).toBe('42');
    expect(thrownText(null)).toBe('null');
    expect(thrownText(undefined)).toBe('undefined');
    expect(thrownText({ code: 'E1' })).toBe('[object Object]');
  });
});

describe('thrownMessageOr', () => {
  it('uses a non-empty message, else the fallback', () => {
    expect(thrownMessageOr(new Error('Meta API down'), 'Meta Ads sync failed')).toBe('Meta API down');
    expect(thrownMessageOr(new Error(''), 'Meta Ads sync failed')).toBe('Meta Ads sync failed');
    expect(thrownMessageOr('a string has no message', 'fallback')).toBe('fallback');
    expect(thrownMessageOr(null, '')).toBe('');
  });

  it('turns a non-string message into text', () => {
    expect(thrownMessageOr({ message: 503 }, 'fallback')).toBe('503');
  });
});

describe('valueAtPath', () => {
  const body = {
    error: { message: 'Invalid OAuth access token' },
    choices: [{ message: { content: 'Salom' } }],
  };

  it('walks objects and arrays', () => {
    expect(valueAtPath(body, 'error', 'message')).toBe('Invalid OAuth access token');
    expect(valueAtPath(body, 'choices', 0, 'message', 'content')).toBe('Salom');
    expect(valueAtPath(body)).toBe(body);
  });

  it('gives undefined once a step is missing or not an object', () => {
    expect(valueAtPath(body, 'choices', 1, 'message')).toBeUndefined();
    expect(valueAtPath(body, 'error', 'message', 'length')).toBeUndefined();
    expect(valueAtPath(null, 'error')).toBeUndefined();
    expect(valueAtPath('text', 'length')).toBeUndefined();
    expect(valueAtPath({ error: null }, 'error', 'message')).toBeUndefined();
  });
});
