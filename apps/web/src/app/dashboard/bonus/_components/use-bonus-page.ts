'use client';

import { useBonusActions } from './use-bonus-actions';
import { useBonusSettings } from './use-bonus-settings';

// All state, queries and handlers of the bonus page, built by the hooks above in their original order.
export function useBonusPage() {
  return useBonusActions(useBonusSettings());
}

export type BonusPageModel = ReturnType<typeof useBonusPage>;
