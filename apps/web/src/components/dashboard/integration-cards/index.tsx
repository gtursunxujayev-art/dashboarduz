'use client';

import { IntegrationList } from './integration-list';
import { useIntegrationCards } from './use-integration-cards';

export default function IntegrationCards() {
  const vm = useIntegrationCards();
  const { error } = vm;

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntegrationList vm={vm} />
      </div>
    </div>
  );
}
