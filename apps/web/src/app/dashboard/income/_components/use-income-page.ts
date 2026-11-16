'use client';

import { useIncomeActions } from './use-income-actions';
import { useIncomeForm } from './use-income-form';

// All state, queries and handlers of the income page, built by the hooks above in their original order.
export function useIncomePage() {
  return useIncomeActions(useIncomeForm());
}

export type IncomePageModel = ReturnType<typeof useIncomePage>;
