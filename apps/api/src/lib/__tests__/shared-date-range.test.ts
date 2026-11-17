import { dateKeyRangeInput, dateKeySchema, dateRangeInput } from '@dashboarduz/shared';
import { z } from 'zod';

describe('shared date-range inputs', () => {
  it('dateRangeInput: optional, trimmed, unvalidated bounds', () => {
    expect(dateRangeInput.parse({})).toEqual({});
    expect(dateRangeInput.parse({ dateFrom: ' 2026-01-01 ', dateTo: 'whatever' })).toEqual({ dateFrom: '2026-01-01', dateTo: 'whatever' });
  });

  it('spreads into a procedure input', () => {
    const input = z.object({ range: z.string(), ...dateRangeInput.shape });

    expect(input.parse({ range: 'custom', dateFrom: '2026-01-01' })).toEqual({ range: 'custom', dateFrom: '2026-01-01' });
  });

  it('dateKeyRangeInput: both bounds required as YYYY-MM-DD, trimmed, Uzbek error', () => {
    expect(dateKeyRangeInput.parse({ dateFrom: '2026-01-01 ', dateTo: '2026-01-31' })).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(() => dateKeyRangeInput.parse({ dateFrom: '2026-01-01' })).toThrow();

    const result = dateKeyRangeInput.safeParse({ dateFrom: '01.01.2026', dateTo: '2026-01-31' });

    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error.issues[0]?.message).toBe("Sana formati YYYY-MM-DD bo'lishi kerak.");
  });

  it('dateKeySchema can be made optional and nullable', () => {
    const schema = dateKeySchema.optional().nullable();

    expect(schema.parse(null)).toBeNull();
    expect(schema.parse(undefined)).toBeUndefined();
    expect(() => schema.parse('2026/01/01')).toThrow();
  });
});
