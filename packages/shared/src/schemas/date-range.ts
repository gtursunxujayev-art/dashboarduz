import { z } from 'zod';

/** A Tashkent calendar day as typed in a filter: `YYYY-MM-DD`. */
export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const DATE_KEY_FORMAT_MESSAGE = "Sana formati YYYY-MM-DD bo'lishi kerak.";

/** One `YYYY-MM-DD` day, trimmed. */
export const dateKeySchema = z.string().trim().regex(DATE_KEY_PATTERN, DATE_KEY_FORMAT_MESSAGE);

/**
 * Optional `dateFrom`/`dateTo` of a report filter, trimmed. Used with a `range`: the bounds are only
 * read (and validated, with Uzbek messages) for a custom range. Spread `.shape` into a procedure input.
 */
export const dateRangeInput = z.object({
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
});

/** Required `dateFrom`/`dateTo`, each a trimmed `YYYY-MM-DD` day. */
export const dateKeyRangeInput = z.object({
  dateFrom: dateKeySchema,
  dateTo: dateKeySchema,
});

export type DateRangeInput = z.infer<typeof dateRangeInput>;
export type DateKeyRangeInput = z.infer<typeof dateKeyRangeInput>;
