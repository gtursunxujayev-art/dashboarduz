'use client';

import { useIntegrationCardsActions } from './use-integration-cards-actions';
import { useIntegrationCardsState } from './use-integration-cards-state';

// All queries, form state and handlers of the integration cards, built by the hooks above in their original order.
export function useIntegrationCards() {
  return useIntegrationCardsActions(useIntegrationCardsState());
}

export type IntegrationCardsModel = ReturnType<typeof useIntegrationCards>;
