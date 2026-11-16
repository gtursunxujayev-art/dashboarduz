'use client';

import { AmoCrmPanel } from './amocrm-panel';
import { IntegrationConnectForms } from './connect-forms';
import { FaceIdPanel } from './faceid-panel';
import { statusBadge, statusText } from './integration-helpers';
import { TelegramPanel } from './telegram-panel';
import { useIntegrationCard } from './use-integration-card';
import type { IntegrationCardsModel } from './use-integration-cards';

export function IntegrationCard(props: { vm: IntegrationCardsModel; integration: IntegrationCardsModel['integrations'][number] }) {
  const vm = useIntegrationCard(props);
  const { handleConnect, handleDisconnect, integration, integrationConfig, loading, webhookUrl } = vm;

  return (
    <div key={integration.id} className={`rounded-lg border p-4 ${integration.color}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-base font-semibold text-gray-900">{integration.name}</h4>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadge(integration.status)}`}>
          {statusText(integration.status)}
        </span>
      </div>

      <p className="mt-1 text-sm text-gray-600">{integration.description}</p>

      {integration.status === 'active' && (
        <div className="mt-3 space-y-1 text-xs text-gray-600">
          {integration.lastSyncAt && <p>Oxirgi sinxron: {new Date(integration.lastSyncAt).toLocaleString()}</p>}
          {integrationConfig.lastValidatedAt && (
            <p>Oxirgi tekshiruv: {new Date(String(integrationConfig.lastValidatedAt)).toLocaleString()}</p>
          )}
          {webhookUrl && <p className="break-all">Webhook manzili: {webhookUrl}</p>}
          {integrationConfig.connectionMode && (
            <p>Rejim: {String(integrationConfig.connectionMode)}</p>
          )}
        </div>
      )}

      <AmoCrmPanel vm={vm} />

      <TelegramPanel vm={vm} />

      <FaceIdPanel vm={vm} />

      <IntegrationConnectForms vm={vm} />

      <div className="mt-4 flex gap-2">
        {integration.status === 'disconnected' || (integration.id === 'amocrm' && integration.status !== 'active') ? (
          <button
            type="button"
            onClick={() => handleConnect(integration.id)}
            disabled={loading || integration.id === 'google_sheets'}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {loading
              ? "Ulanmoqda..."
              : integration.id === 'google_sheets'
                ? "O'chirilgan"
                : integration.id === 'amocrm'
                  ? 'Token orqali ulash'
                  : integration.id === 'faceid_attendance'
                    ? 'Webhookni ulash'
                    : 'Ulash'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => handleDisconnect(integration.id)}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Yangilanmoqda...' : 'Uzish'}
          </button>
        )}
      </div>
    </div>
  );
}
