import { z } from 'zod';

export const createLeadSchema = z.object({
  title: z.string().min(1),
  contactId: z.string().uuid().optional(),
  status: z.string().optional(),
  pipelineId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export const updateLeadSchema = z.object({
  title: z.string().min(1).optional(),
  status: z.string().optional(),
  pipelineId: z.string().optional(),
  responsibleUserId: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
});

export const leadQuerySchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
});

export type CreateLead = z.infer<typeof createLeadSchema>;
export type UpdateLead = z.infer<typeof updateLeadSchema>;
export type LeadQuery = z.infer<typeof leadQuerySchema>;
