/**
 * One-off repair for sale chains left inconsistent by the old refund flow.
 *
 * Dry run (default, changes nothing):  npx tsx apps/api/scripts/repair-income-chains.ts
 * Apply changes:                       npx tsx apps/api/scripts/repair-income-chains.ts --apply
 * Limit to one tenant:                 ... --tenant=<tenantId>
 */
import { prisma } from '@dashboarduz/db';
import { planChainRepair, type RepairChainRow } from '../src/services/income-chain-repair';

const rowSelect = {
  id: true,
  type: true,
  lifecycleStatus: true,
  paymentAmount: true,
  coursePriceAmount: true,
  debtAmount: true,
  remainingDebtAmount: true,
  entryDate: true,
  createdAt: true,
  relatedDebtIncomeId: true,
} as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
  const tenantId = tenantArg ? tenantArg.slice('--tenant='.length) : undefined;

  const tenants = await prisma.tenant.findMany({
    where: tenantId ? { id: tenantId } : {},
    select: { id: true, name: true },
  });

  let totalLifecycle = 0;
  let totalDebt = 0;
  let touchedChains = 0;

  for (const tenant of tenants) {
    const [sales, repayments, pendingRefunds] = await Promise.all([
      prisma.income.findMany({ where: { tenantId: tenant.id, type: 'new_sale' }, select: rowSelect }),
      prisma.income.findMany({
        where: { tenantId: tenant.id, type: 'repayment', relatedDebtIncomeId: { not: null } },
        select: rowSelect,
      }),
      prisma.incomeAdjustmentRequest.findMany({
        where: { tenantId: tenant.id, type: 'refund', status: 'pending' },
        select: { incomeId: true },
      }),
    ]);

    const repaymentsBySaleId = new Map<string, RepairChainRow[]>();
    for (const repayment of repayments) {
      const list = repaymentsBySaleId.get(repayment.relatedDebtIncomeId!) ?? [];
      list.push(repayment);
      repaymentsBySaleId.set(repayment.relatedDebtIncomeId!, list);
    }
    const pendingRefundSaleIds = new Set(pendingRefunds.map((request) => request.incomeId));

    for (const sale of sales) {
      const plan = planChainRepair({
        sale,
        repayments: repaymentsBySaleId.get(sale.id) ?? [],
        hasPendingRefundRequest: pendingRefundSaleIds.has(sale.id),
      });
      if (!plan.lifecycleUpdates.length && !plan.debtUpdates.length) {
        continue;
      }

      touchedChains += 1;
      totalLifecycle += plan.lifecycleUpdates.length;
      totalDebt += plan.debtUpdates.length;
      console.log(JSON.stringify({ tenant: tenant.name, saleId: sale.id, saleStatus: sale.lifecycleStatus, ...plan }));

      if (apply) {
        await prisma.$transaction([
          ...plan.lifecycleUpdates.map((update) => prisma.income.update({
            where: { id: update.id },
            data: { lifecycleStatus: update.to },
          })),
          ...plan.debtUpdates.map((update) => prisma.income.update({
            where: { id: update.id },
            data: { debtAmount: update.debtAmount, remainingDebtAmount: update.remainingDebtAmount },
          })),
        ]);
      }
    }
  }

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'}: ${touchedChains} chains, ${totalLifecycle} status fixes, ${totalDebt} debt fixes.`);
  if (!apply && touchedChains > 0) {
    console.log('Review the lines above, then re-run with --apply.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
