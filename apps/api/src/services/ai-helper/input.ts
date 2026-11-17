import { dateKeySchema } from '@dashboarduz/shared';
import { z } from 'zod';

const aiHelperMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4_000),
});

export const aiHelperInputSchema = z.object({
  message: z.string().min(1).max(6_000),
  history: z.array(aiHelperMessageSchema).max(20).default([]),
  pageContext: z.object({
    pageKey: z.string().min(1).max(120),
    rangeMode: z.string().max(40).optional().nullable(),
    dateFrom: dateKeySchema.optional().nullable(),
    dateTo: dateKeySchema.optional().nullable(),
    filters: z.record(z.unknown()).optional(),
    metrics: z.record(z.unknown()).optional(),
    updatedAt: z.string().optional(),
  }).optional(),
});
