'use client';

import type { IntegrationCardsModel } from './use-integration-cards';
import { useIntegrationCardState } from './use-integration-card-state';

// Values one integration card renders: the shared card state plus this integration's derived values.
export function useIntegrationCard(props: { vm: IntegrationCardsModel; integration: IntegrationCardsModel['integrations'][number] }) {
  return useIntegrationCardState(props);
}

export type IntegrationCardModel = ReturnType<typeof useIntegrationCard>;
