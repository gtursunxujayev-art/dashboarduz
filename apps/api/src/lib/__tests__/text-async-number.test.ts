import { sleep, withTimeout } from '../async';
import { normalizePercentage, roundPositivePercentage } from '../number';
import { normalizeMatchText } from '../text';

describe('normalizeMatchText (replaces four normalizeName/normalizeText copies)', () => {
  const input = "  O’Brien   Smith-Jones ";

  it('trims and lower-cases only, by default (bonus router)', () => {
    expect(normalizeMatchText(input)).toBe("o’brien   smith-jones");
  });

  it('collapses whitespace (income-problems)', () => {
    expect(normalizeMatchText(input, { collapseWhitespace: true })).toBe("o’brien smith-jones");
  });

  it('also unifies apostrophes (income-debug names)', () => {
    expect(normalizeMatchText(input, { collapseWhitespace: true, unifyApostrophes: true })).toBe("o'brien smith-jones");
  });

  it('also turns hyphens into spaces after collapsing (income-debug text)', () => {
    expect(normalizeMatchText('a - b', { collapseWhitespace: true, unifyApostrophes: true, hyphensToSpaces: true })).toBe('a   b');
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeMatchText(null)).toBe('');
    expect(normalizeMatchText(undefined, { collapseWhitespace: true })).toBe('');
  });
});

describe('percentages', () => {
  it('normalizePercentage clamps loose input to 0..100', () => {
    expect(normalizePercentage('12.345')).toBe(12.35);
    expect(normalizePercentage(150)).toBe(100);
    expect(normalizePercentage(-1)).toBe(0);
    expect(normalizePercentage('x')).toBe(0);
  });

  it('roundPositivePercentage (daily report) does not cap at 100', () => {
    expect(roundPositivePercentage(150.555)).toBe(150.56);
    expect(roundPositivePercentage(-3)).toBe(0);
    expect(roundPositivePercentage(Number.NaN)).toBe(0);
  });
});

describe('async helpers', () => {
  afterEach(() => jest.useRealTimers());

  it('withTimeout resolves with the value and clears its timer', async () => {
    jest.useFakeTimers();
    await expect(withTimeout(Promise.resolve(5), 1000, 'slow')).resolves.toBe(5);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('withTimeout rejects with the reason', async () => {
    jest.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 1000, 'slow');

    jest.advanceTimersByTime(1000);
    await expect(pending).rejects.toThrow('slow');
  });

  it('sleep waits', async () => {
    jest.useFakeTimers();
    const done = jest.fn();

    void sleep(500).then(done);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(done).toHaveBeenCalled();
  });
});
