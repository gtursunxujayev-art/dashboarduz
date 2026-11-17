'use client';

import { IntegrationList } from './integration-list';
import { useIntegrationCards } from './use-integration-cards';

export default function IntegrationCards() {
  const vm = useIntegrationCards();
  const { error } = vm;

  return (
    <div className="space-y-4">
      {error && (
        <p className="alert alert-error">{error}</p>
      )}

      <div className="grid grid-flow-row-dense grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3">
        <IntegrationList vm={vm} />
      </div>
    </div>
  );
}
