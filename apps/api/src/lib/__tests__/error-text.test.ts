import { messageOrStringOfError, messagePropertyOfError } from '../error-text';

describe('messageOrStringOfError (the String(error?.message || error) idiom)', () => {
  it('uses a non-empty message of any thrown object', () => {
    expect(messageOrStringOfError(new Error('boom'))).toBe('boom');
    expect(messageOrStringOfError(new TypeError('bad type'))).toBe('bad type');
    expect(messageOrStringOfError({ message: 'plain object' })).toBe('plain object');
    expect(messageOrStringOfError({ message: 42 })).toBe('42');
  });

  it('falls back to String(error) for empty messages and values without one', () => {
    expect(messageOrStringOfError(new Error(''))).toBe('Error');
    expect(messageOrStringOfError(new RangeError(''))).toBe('RangeError');
    expect(messageOrStringOfError({ message: '' })).toBe('[object Object]');
    expect(messageOrStringOfError('just text')).toBe('just text');
    expect(messageOrStringOfError(503)).toBe('503');
    expect(messageOrStringOfError(null)).toBe('null');
    expect(messageOrStringOfError(undefined)).toBe('undefined');
  });
});

describe('messagePropertyOfError (the error.message read)', () => {
  it('returns string messages, including empty ones', () => {
    expect(messagePropertyOfError(new Error('boom'))).toBe('boom');
    expect(messagePropertyOfError(new Error(''))).toBe('');
    expect(messagePropertyOfError({ message: 'from object' })).toBe('from object');
  });

  it('returns undefined when there is no string message', () => {
    expect(messagePropertyOfError({ message: 42 })).toBeUndefined();
    expect(messagePropertyOfError({})).toBeUndefined();
    expect(messagePropertyOfError('text')).toBeUndefined();
    expect(messagePropertyOfError(null)).toBeUndefined();
    expect(messagePropertyOfError(undefined)).toBeUndefined();
  });
});
