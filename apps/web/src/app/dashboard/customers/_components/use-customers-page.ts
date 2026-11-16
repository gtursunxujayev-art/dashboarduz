'use client';

import { useCustomersActions } from './use-customers-actions';
import { useCustomersState } from './use-customers-state';

// All state, queries and handlers of the customers page, built by the hooks above in their original order.
export function useCustomersPage() {
  return useCustomersActions(useCustomersState());
}

export type CustomersPageModel = ReturnType<typeof useCustomersPage>;
