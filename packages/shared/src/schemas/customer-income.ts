import { z } from 'zod';

export const incomeTypeSchema = z.enum(['new_sale', 'repayment']);

export const customerSearchSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).default(30),
});

export const createCourseSchema = z.object({
  name: z.string().min(1).max(120),
});

export const createTariffSchema = z.object({
  courseId: z.string().uuid(),
  name: z.string().min(1).max(120),
});

export const createIncomeSchema = z.object({
  entryDate: z.string().min(1),
  managerUserId: z.string().uuid(),
  customerNumber: z.string().min(1).max(64),
  customerName: z.string().min(1).max(160).optional(),
  telegramUsername: z.string().max(160).optional(),
  type: incomeTypeSchema,
  debtSourceIncomeId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  tariffId: z.string().uuid().optional(),
  coursePriceAmount: z.number().int().min(0).optional(),
  paymentAmount: z.number().int().min(0),
  deadline: z.string().optional(),
});

export const bulkIncomeCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const bulkIncomeImportSchema = z.object({
  rows: z.array(z.record(bulkIncomeCellSchema)).min(1).max(5000),
});

export const bulkIncomeImportFromGoogleSheetSchema = z.object({
  sheetUrl: z.string().min(1).max(2048),
});

export type IncomeType = z.infer<typeof incomeTypeSchema>;
export type CustomerSearchInput = z.infer<typeof customerSearchSchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateTariffInput = z.infer<typeof createTariffSchema>;
export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
export type BulkIncomeImportInput = z.infer<typeof bulkIncomeImportSchema>;
export type BulkIncomeImportFromGoogleSheetInput = z.infer<typeof bulkIncomeImportFromGoogleSheetSchema>;
