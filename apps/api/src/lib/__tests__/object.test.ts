import {
  asObject,
  asObjectOrEmpty,
  getCaseInsensitiveValue,
  parseFloatOrZero,
  textFromScalar,
  textFromUnknown,
  textFromUnknownOrEmpty,
  toFiniteNumber,
  toNumberOrNull,
  trimmedString,
  trimmedStringOrNull,
} from '../object';

describe('asObject / asObjectOrEmpty', () => {
  it.each([null, undefined, 0, '', 'x', 1, true, [], [1]])('rejects %p', (value) => {
    expect(asObject(value)).toBeNull();
    expect(asObjectOrEmpty(value)).toEqual({});
  });

  it('returns the same plain object', () => {
    const value = { a: 1 };

    expect(asObject(value)).toBe(value);
    expect(asObjectOrEmpty(value)).toBe(value);
  });
});

describe('getCaseInsensitiveValue', () => {
  it('prefers the exact key, then a case-insensitive match', () => {
    expect(getCaseInsensitiveValue({ Duration: 1, duration: 2 }, 'duration')).toBe(2);
    expect(getCaseInsensitiveValue({ BillSec: 5 }, 'billsec')).toBe(5);
    expect(getCaseInsensitiveValue({ a: 1 }, 'b')).toBeUndefined();
  });

  it('returns an exact key even when its value is undefined', () => {
    expect(getCaseInsensitiveValue({ key: undefined, KEY: 1 }, 'key')).toBeUndefined();
  });
});

describe('toFiniteNumber', () => {
  it('parses numbers and numeric strings, else returns the fallback', () => {
    expect(toFiniteNumber(4.5)).toBe(4.5);
    expect(toFiniteNumber(' 12.5abc ')).toBe(12.5);
    expect(toFiniteNumber('abc', 7)).toBe(7);
    expect(toFiniteNumber(Number.NaN, 3)).toBe(3);
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(true)).toBe(0);
  });
});

describe('toNumberOrNull (was amocrm-call-sync toNumber)', () => {
  it('uses Number() semantics', () => {
    expect(toNumberOrNull('42')).toBe(42);
    expect(toNumberOrNull('')).toBe(0);
    expect(toNumberOrNull(null)).toBe(0);
    expect(toNumberOrNull('12abc')).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });
});

describe('parseFloatOrZero (was meta-ads toNumber)', () => {
  it('uses parseFloat semantics', () => {
    expect(parseFloatOrZero('12abc')).toBe(12);
    expect(parseFloatOrZero('')).toBe(0);
    expect(parseFloatOrZero(undefined)).toBe(0);
    expect(parseFloatOrZero(3.25)).toBe(3.25);
    expect(parseFloatOrZero('x')).toBe(0);
  });
});

describe('trimmedString / trimmedStringOrNull (were the two normalizeText copies)', () => {
  it('trims strings and drops other types', () => {
    expect(trimmedString('  a ')).toBe('a');
    expect(trimmedString(5)).toBe('');
    expect(trimmedStringOrNull('  a ')).toBe('a');
    expect(trimmedStringOrNull('   ')).toBeNull();
    expect(trimmedStringOrNull(5)).toBeNull();
  });
});

describe('textFromUnknown family', () => {
  const cases: Array<[unknown, string | null, string, string | null]> = [
    // value, textFromUnknown (webhooks), textFromUnknownOrEmpty (workers), textFromScalar (calls)
    [null, null, '', null],
    [undefined, null, '', null],
    ['  hi ', 'hi', 'hi', 'hi'],
    ['   ', null, '', null],
    [12, '12', '12', '12'],
    [Number.NaN, 'NaN', 'NaN', null],
    [true, 'true', 'true', null],
    [{ title: ' T ' }, 'T', 'T', null],
    [{ name: '', label: 'L' }, 'L', 'L', null],
    [{ other: 'x' }, null, '', null],
    [['a'], null, '', null],
  ];

  it.each(cases)('%p', (value, webhook, worker, scalar) => {
    expect(textFromUnknown(value)).toBe(webhook);
    expect(textFromUnknownOrEmpty(value)).toBe(worker);
    expect(textFromScalar(value)).toBe(scalar);
  });
});
