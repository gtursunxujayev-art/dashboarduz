import { bulkIncomeImportFromGoogleSheetSchema, bulkIncomeImportSchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { throwIncomeImportDisabledByPolicy } from '../../../services/customer-income/historical-import';
import { adminProcedure, protectedProcedure } from '../../trpc';

const historicalRawRowSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const historicalImportPrepareSchema = z.object({
  sessionId: z.string().uuid().optional(),
  incomeFileName: z.string().min(1).max(255).optional(),
  customerFileName: z.string().min(1).max(255).optional(),
  customerSheetName: z.string().min(1).max(255).optional(),
  incomeRows: z.array(historicalRawRowSchema).min(1).max(5000),
  customerRows: z.array(historicalRawRowSchema).min(1).max(5000),
  fallbackManagerUserId: z.string().uuid().optional(),
  managerAliasMap: z.record(z.string().uuid()).optional(),
});

const historicalImportSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

export const historicalImportProcedures = {
  bulkImportRows: protectedProcedure
    .input(bulkIncomeImportSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),
  bulkImportFromGoogleSheet: protectedProcedure
    .input(bulkIncomeImportFromGoogleSheetSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),
  prepareHistoricalImport: adminProcedure
    .input(historicalImportPrepareSchema)
    .mutation(async (): Promise<{ sessionId: string; preview: any }> => {
      throwIncomeImportDisabledByPolicy();
    }),
  getHistoricalImportProgress: adminProcedure
    .input(historicalImportSessionSchema)
    .query(async (): Promise<{
      status: string;
      preview: any;
      progress: {
        stage: string;
        message: string;
        processedRows: number;
        totalRows: number;
        processedIncomeRows: number;
        totalIncomeRows: number;
        processedCustomerRows: number;
        totalCustomerRows: number;
        importedRows: number;
        failedRows: number;
        importedNewSaleRows: number;
        importedRepaymentRows: number;
        createdCustomers: number;
        updatedCustomers: number;
        profileOnlyCustomers: number;
        skippedIncomeRows: number;
        skippedCustomerRows: number;
      } | null;
      failureReport: any[];
      errorMessage: string | null;
    }> => {
      throwIncomeImportDisabledByPolicy();
    }),
  cancelHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async (): Promise<{ ok: boolean }> => {
      throwIncomeImportDisabledByPolicy();
    }),
  executeHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async (): Promise<{ ok: boolean }> => {
      throwIncomeImportDisabledByPolicy();
    }),
};
