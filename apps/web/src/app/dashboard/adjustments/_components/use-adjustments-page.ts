'use client';

import { useAdjustmentsPageState } from './use-adjustments-page-state';

// All form state, queries and handlers of the adjustments page.
export function useAdjustmentsPage() {
  return useAdjustmentsPageState();
}

export type AdjustmentsPageModel = ReturnType<typeof useAdjustmentsPage>;
