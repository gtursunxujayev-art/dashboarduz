import { getSaleAgreementAmount } from './income-chain';

export type RepairChainRow = {
  id: string;
  type: string;
  lifecycleStatus: string;
  paymentAmount: number | null;
  coursePriceAmount?: number | null;
  debtAmount: number | null;
  remainingDebtAmount: number | null;
  entryDate: Date;
  createdAt: Date;
};

export type ChainRepairPlan = {
  saleId: string;
  lifecycleUpdates: Array<{ id: string; from: string; to: string }>;
  debtUpdates: Array<{ id: string; debtAmount: number; remainingDebtAmount: number }>;
};

/**
 * Decides how to bring one sale chain back to a consistent state:
 * - repayments follow the sale's lifecycle (refund create/approve/reject used to touch only the sale row);
 * - a sale that is `active` only releases repayments stuck in `pending_refund` when no refund is pending;
 * - stored debt fields on active chains are recomputed in date order.
 */
export function planChainRepair(params: {
  sale: RepairChainRow;
  repayments: RepairChainRow[];
  hasPendingRefundRequest: boolean;
}): ChainRepairPlan {
  const { sale, hasPendingRefundRequest } = params;
  const plan: ChainRepairPlan = { saleId: sale.id, lifecycleUpdates: [], debtUpdates: [] };

  let targetStatus: string | null = null;
  if (sale.lifecycleStatus === 'refunded') {
    targetStatus = 'refunded';
  } else if (sale.lifecycleStatus === 'pending_refund') {
    targetStatus = hasPendingRefundRequest ? 'pending_refund' : null;
  } else if (sale.lifecycleStatus === 'active' && !hasPendingRefundRequest) {
    targetStatus = 'active';
  }

  const repayments = params.repayments.map((row) => ({ ...row }));
  if (targetStatus) {
    for (const repayment of repayments) {
      if (repayment.lifecycleStatus !== targetStatus) {
        plan.lifecycleUpdates.push({ id: repayment.id, from: repayment.lifecycleStatus, to: targetStatus });
        repayment.lifecycleStatus = targetStatus;
      }
    }
  }

  if (sale.lifecycleStatus !== 'active') {
    return plan;
  }

  const agreementAmount = getSaleAgreementAmount(sale);
  let rollingDebt = Math.max(agreementAmount - Math.max(Number(sale.paymentAmount || 0), 0), 0);
  const activeRepayments = repayments
    .filter((row) => row.lifecycleStatus === 'active')
    .sort((left, right) => (
      left.entryDate.getTime() - right.entryDate.getTime()
      || left.createdAt.getTime() - right.createdAt.getTime()
    ));

  for (const repayment of activeRepayments) {
    const debtAmount = rollingDebt;
    rollingDebt = Math.max(debtAmount - Math.max(Number(repayment.paymentAmount || 0), 0), 0);
    if (repayment.debtAmount !== debtAmount || repayment.remainingDebtAmount !== rollingDebt) {
      plan.debtUpdates.push({ id: repayment.id, debtAmount, remainingDebtAmount: rollingDebt });
    }
  }

  if (sale.debtAmount !== agreementAmount || sale.remainingDebtAmount !== rollingDebt) {
    plan.debtUpdates.push({ id: sale.id, debtAmount: agreementAmount, remainingDebtAmount: rollingDebt });
  }

  return plan;
}
