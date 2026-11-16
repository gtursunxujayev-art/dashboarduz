'use client';

import { IntegrationCard } from './integration-card';
import type { IntegrationCardsModel } from './use-integration-cards';

export function IntegrationList({ vm }: { vm: IntegrationCardsModel }) {
  const { integrations } = vm;

  return (
    <>
      {integrations.map((integration) => <IntegrationCard key={integration.id} vm={vm} integration={integration} />)}
    </>
  );
}
