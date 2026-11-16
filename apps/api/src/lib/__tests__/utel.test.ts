import {
  isAllowedUtelManagerExtension,
  normalizeCallDirection,
  parseCallDuration,
  resolveCallDuration,
  resolveCallExtension,
  resolveExtensionFromCallParties,
} from '../utel';

describe('isAllowedUtelManagerExtension', () => {
  it.each([
    ['100', true],
    ['150', true],
    [' 1 2 5 ', true],
    [125, true],
    ['99', false],
    ['151', false],
    ['+998901234567', false],
    ['', false],
    [null, false],
  ])('%p -> %p', (value, expected) => {
    expect(isAllowedUtelManagerExtension(value)).toBe(expected);
  });
});

describe('resolveCallExtension', () => {
  const base = { from: '', to: '', direction: '', metadata: null as unknown };

  it('prefers the metadata extension', () => {
    expect(resolveCallExtension({ ...base, from: '101', metadata: { ext: '120' } })).toBe('120');
    expect(resolveCallExtension({ ...base, from: '101', metadata: { extension: '999' } })).toBe('101');
  });

  it('follows the call direction, then falls back to either party', () => {
    expect(resolveCallExtension({ ...base, direction: 'outbound', from: '101', to: '102' })).toBe('101');
    expect(resolveCallExtension({ ...base, direction: 'INBOUND', from: '101', to: '102' })).toBe('102');
    expect(resolveCallExtension({ ...base, direction: 'other', from: '998901234567', to: '105' })).toBe('105');
    expect(resolveCallExtension({ ...base, from: '998901234567', to: '998907654321' })).toBeNull();
  });

  it('ignores array metadata (the former dashboard copy accepted arrays but read no keys from them)', () => {
    expect(resolveCallExtension({ ...base, from: '101', metadata: ['120'] })).toBe('101');
  });
});

describe('resolveExtensionFromCallParties (sellers report)', () => {
  it('checks from, then to, and ignores direction', () => {
    expect(resolveExtensionFromCallParties({ from: '101', to: '102' })).toBe('101');
    expect(resolveExtensionFromCallParties({ from: '+998901234567', to: '102' })).toBe('102');
    expect(resolveExtensionFromCallParties({ from: 'x', to: 'y' })).toBeNull();
  });
});

describe('parseCallDuration / resolveCallDuration', () => {
  it('parses whole non-negative seconds', () => {
    expect(parseCallDuration(12.9)).toBe(12);
    expect(parseCallDuration(-5)).toBe(0);
    expect(parseCallDuration(' 42s ')).toBe(42);
    expect(parseCallDuration('  ')).toBeNull();
    expect(parseCallDuration('abc')).toBeNull();
    expect(parseCallDuration(null)).toBeNull();
  });

  it('uses the stored duration, then metadata keys, then raw_call_history', () => {
    expect(resolveCallDuration(-3, { duration: 10 })).toBe(0);
    expect(resolveCallDuration(30, { duration: 10 })).toBe(30);
    expect(resolveCallDuration(null, { BillSec: '17' })).toBe(17);
    expect(resolveCallDuration(null, { other: 1, raw_call_history: { talk_duration: 9 } })).toBe(9);
    expect(resolveCallDuration(null, 'not-an-object')).toBe(0);
  });
});

describe('normalizeCallDirection', () => {
  it.each(['out', 'OUTBOUND', ' dial_out ', 'outgoing'])('%p is outbound', (value) => {
    expect(normalizeCallDirection(value)).toBe('outbound');
  });

  it.each(['in', 'inbound', '', null, undefined])('%p is inbound', (value) => {
    expect(normalizeCallDirection(value)).toBe('inbound');
  });
});
