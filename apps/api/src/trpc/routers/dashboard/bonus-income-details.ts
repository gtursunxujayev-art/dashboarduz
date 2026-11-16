import { BONUS_DETAIL_EXPORT_LIMIT } from '../../../services/bonus-detail-export';
import { bonusIncomeDetailsInputSchema, loadBonusIncomeDetails } from '../../../services/dashboard/bonus-income-details';

import { protectedProcedure } from './helpers';

export const bonusIncomeDetails = protectedProcedure
  .input(bonusIncomeDetailsInputSchema)
  .query(({ ctx, input }) => loadBonusIncomeDetails({
    ctx,
    input,
    options: { rowLimit: 3000 },
  }));

export const exportBonusIncomeDetails = protectedProcedure
  .input(bonusIncomeDetailsInputSchema)
  .mutation(async ({ ctx, input }) => {
    const result = await loadBonusIncomeDetails({
      ctx,
      input,
      options: { rowLimit: BONUS_DETAIL_EXPORT_LIMIT, rejectAboveLimit: BONUS_DETAIL_EXPORT_LIMIT },
    });

    return {
      rangeStart: result.rangeStart,
      rangeEnd: result.rangeEnd,
      totalCount: result.rows.length,
      rows: result.rows,
    };
  });
