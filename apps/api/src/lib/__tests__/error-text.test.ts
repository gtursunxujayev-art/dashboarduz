import { thrownText, messagePropertyOfError } from '../errors';

describe('thrownText (the String(error?.message || error) idiom)', () => {
  it('uses a non-empty message of any thrown object', () => {
    expect(thrownText(new Error('boom'))).toBe('boom');
    expect(thrownText(new TypeError('bad type'))).toBe('bad type');
    expect(thrownText({ message: 'plain object' })).toBe('plain object');
    expect(thrownText({ message: 42 })).toBe('42');
  });

  it('falls back to String(error) for empty messages and values without one', () => {
    expect(thrownText(new Error(''))).toBe('Error');
    expect(thrownText(new RangeError(''))).toBe('RangeError');
    expect(thrownText({ message: '' })).toBe('[object Object]');
    expect(thrownText('just text')).toBe('just text');
    expect(thrownText(503)).toBe('503');
    expect(thrownText(null)).toBe('null');
    expect(thrownText(undefined)).toBe('undefined');
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
