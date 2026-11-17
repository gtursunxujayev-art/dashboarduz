import { formatDuration } from '../duration';

describe('formatDuration (the one API duration format)', () => {
  it('prints HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(3723)).toBe('01:02:03');
    expect(formatDuration(59.9)).toBe('00:00:59');
    expect(formatDuration(100 * 3600 + 5)).toBe('100:00:05');
  });

  it('drops seconds for narrow report columns', () => {
    expect(formatDuration(3723, { withSeconds: false })).toBe('01:02');
  });

  it('treats negative, missing and non-finite values as 0', () => {
    expect(formatDuration(-10)).toBe('00:00:00');
    expect(formatDuration(null)).toBe('00:00:00');
    expect(formatDuration(undefined)).toBe('00:00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
  });
});
