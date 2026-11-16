import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asObjectOrEmpty } from '../../lib/object';
import { normalizeMatchText } from '../../lib/text';
import { groupRows, loadProjectRows, parseDateRange, summarizeComparisons } from '../../services/income-problems/comparison';
import { detectHeaderRow, detectMapping, getActiveSnapshot, normalizeFinanceRows, normalizeHeader, readTenantSettings, type SnapshotMapping, writeTenantSettings } from '../../services/income-problems/finance-snapshot';
import { adminProcedure, router } from '../trpc';

const snapshotCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const snapshotMatrixSchema = z.array(z.array(snapshotCellSchema)).max(25000);

const mappingSchema = z.object({
  paymentDate: z.number().int().min(0).nullable(),
  customerPhone: z.number().int().min(0).nullable(),
  customerName: z.number().int().min(0).nullable(),
  telegramUsername: z.number().int().min(0).nullable(),
  managerLabel: z.number().int().min(0).nullable(),
  courseName: z.number().int().min(0).nullable(),
  tariffName: z.number().int().min(0).nullable(),
  subTariffName: z.number().int().min(0).nullable(),
  paymentType: z.number().int().min(0).nullable(),
  agreementAmount: z.number().int().min(0).nullable(),
  paymentAmount: z.number().int().min(0).nullable(),
  remainingDebtAmount: z.number().int().min(0).nullable(),
  deadline: z.number().int().min(0).nullable(),
});

const compareStatusSchema = z.enum([
  'matched',
  'amount_mismatch',
  'count_mismatch',
  'only_in_db',
  'only_in_finance',
  'ambiguous_match',
]);

export const incomeProblemsRouter = router({
  getActiveSnapshot: adminProcedure.query(async ({ ctx }) => {
    const snapshot = await getActiveSnapshot(ctx.tenantId, ctx.db);

    return snapshot
      ? {
          exists: true,
          workbookName: snapshot.workbookName,
          sheetName: snapshot.sheetName,
          activatedAt: snapshot.activatedAt,
          rowCount: snapshot.rowCount,
          mapping: snapshot.mapping,
        }
      : { exists: false };
  }),

  uploadFinanceSnapshot: adminProcedure
    .input(z.object({
      workbookName: z.string().min(1).max(240),
      sheets: z.array(z.object({
        name: z.string().min(1).max(120),
        rowCount: z.number().int().min(0),
        headers: z.array(z.string()).max(50),
      })).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      const recommendedSheet = [...input.sheets]
        .sort((a, b) => {
          const score = (sheet: { headers: string[] }) => detectMapping(sheet.headers.map((header) => normalizeHeader(header))).paymentAmount != null ? 1 : 0;

          return score(b) - score(a) || b.rowCount - a.rowCount;
        })[0];

      return {
        workbookName: input.workbookName,
        sheets: input.sheets,
        recommendedSheetName: recommendedSheet?.name || input.sheets[0]?.name || null,
      };
    }),

  prepareFinanceSnapshot: adminProcedure
    .input(z.object({ workbookName: z.string().min(1).max(240), sheetName: z.string().min(1).max(120), rows: snapshotMatrixSchema, mapping: mappingSchema.partial().optional() }))
    .mutation(async ({ input }) => {
      const headerRowIndex = detectHeaderRow(input.rows);
      const headers = (input.rows[headerRowIndex] || []).map((cell) => String(cell ?? '').trim());
      const normalizedHeaders = headers.map((header) => normalizeHeader(header));
      const detectedMapping = detectMapping(normalizedHeaders);
      const mergedMapping = { ...detectedMapping, ...(input.mapping || {}) } as SnapshotMapping;
      const dataRows = input.rows.slice(headerRowIndex + 1);
      const { normalizedRows, errors } = normalizeFinanceRows(dataRows, mergedMapping);

      return {
        workbookName: input.workbookName,
        sheetName: input.sheetName,
        headerRowIndex,
        headers,
        mapping: mergedMapping,
        preview: normalizedRows.slice(0, 20),
        totalRows: dataRows.length,
        normalizedRowCount: normalizedRows.length,
        errors: errors.slice(0, 50),
      };
    }),

  activateFinanceSnapshot: adminProcedure
    .input(z.object({ workbookName: z.string().min(1).max(240), sheetName: z.string().min(1).max(120), rows: snapshotMatrixSchema, mapping: mappingSchema }))
    .mutation(async ({ ctx, input }) => {
      const { normalizedRows, errors } = normalizeFinanceRows(input.rows.slice(detectHeaderRow(input.rows) + 1), input.mapping);
      const settings = await readTenantSettings(ctx.tenantId, ctx.db);

      await writeTenantSettings(ctx.tenantId, {
        ...settings,
        incomeProblems: {
          ...asObjectOrEmpty(settings.incomeProblems),
          activeSnapshot: {
            version: 1,
            workbookName: input.workbookName,
            sheetName: input.sheetName,
            activatedAt: new Date().toISOString(),
            mapping: input.mapping,
            rowCount: normalizedRows.length,
            rows: normalizedRows,
          },
        },
      }, ctx.db);

      return { rowCount: normalizedRows.length, errors: errors.slice(0, 20) };
    }),

  compare: adminProcedure
    .input(z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), search: z.string().trim().max(120).optional(), status: compareStatusSchema.optional() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getActiveSnapshot(ctx.tenantId, ctx.db);

      if (!snapshot) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Faol moliya snapshot yuklanmagan.' });
      const { from, to } = parseDateRange(input.dateFrom, input.dateTo);
      const projectRows = await loadProjectRows(ctx.tenantId, from, to, ctx.db);
      const financeRows = snapshot.rows.filter((row) => row.paymentDate && row.paymentDate >= input.dateFrom && row.paymentDate <= input.dateTo);
      const compared = summarizeComparisons(groupRows(projectRows), groupRows(financeRows));
      const search = normalizeMatchText(input.search || '', { collapseWhitespace: true });
      const filteredRows = compared.rows.filter((row) => {
        if (input.status && row.status !== input.status) return false;
        if (!search) return true;

        return normalizeMatchText(`${row.phone} ${row.name}`, { collapseWhitespace: true }).includes(search);
      });

      return {
        snapshot: {
          workbookName: snapshot.workbookName,
          sheetName: snapshot.sheetName,
          activatedAt: snapshot.activatedAt,
          rowCount: snapshot.rowCount,
        },
        summary: compared.summary,
        rows: filteredRows,
      };
    }),

  customerDrilldown: adminProcedure
    .input(z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dbGroupKeys: z.array(z.string()).max(20), financeGroupKeys: z.array(z.string()).max(20) }))
    .query(async ({ ctx, input }) => {
      const snapshot = await getActiveSnapshot(ctx.tenantId, ctx.db);

      if (!snapshot) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Faol moliya snapshot yuklanmagan.' });
      const { from, to } = parseDateRange(input.dateFrom, input.dateTo);
      const projectRows = await loadProjectRows(ctx.tenantId, from, to, ctx.db);
      const dbMap = groupRows(projectRows);
      const financeMap = groupRows(snapshot.rows.filter((row) => row.paymentDate && row.paymentDate >= input.dateFrom && row.paymentDate <= input.dateTo));

      return {
        dbRows: input.dbGroupKeys.flatMap((key) => dbMap.get(key)?.rows || []).sort((a, b) => String(a.paymentDate || '').localeCompare(String(b.paymentDate || ''))),
        financeRows: input.financeGroupKeys.flatMap((key) => financeMap.get(key)?.rows || []).sort((a, b) => String(a.paymentDate || '').localeCompare(String(b.paymentDate || ''))),
      };
    }),
});
