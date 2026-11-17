'use client';

import {
  IconAddressBook,
  IconBrandTelegram,
  IconFaceId,
  IconFileSpreadsheet,
  IconLinkOff,
  IconPhoneCall,
  IconPlug,
  IconPlugConnected,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { AmoCrmPanel } from './amocrm-panel';
import { IntegrationConnectForms } from './connect-forms';
import { FaceIdPanel } from './faceid-panel';
import { statusBadge, statusText } from './integration-helpers';
import { TelegramPanel } from './telegram-panel';
import { useIntegrationCard } from './use-integration-card';
import type { IntegrationCardsModel } from './use-integration-cards';

const SERVICE_ICONS: Record<string, { icon: Icon; tile: string }> = {
  amocrm: { icon: IconAddressBook, tile: 'bg-blue-50 text-blue-600' },
  telegram: { icon: IconBrandTelegram, tile: 'bg-sky-50 text-sky-600' },
  google_sheets: { icon: IconFileSpreadsheet, tile: 'bg-emerald-50 text-emerald-600' },
  voip_utel: { icon: IconPhoneCall, tile: 'bg-violet-50 text-violet-600' },
  faceid_attendance: { icon: IconFaceId, tile: 'bg-rose-50 text-rose-600' },
};
const FALLBACK_SERVICE_ICON = { icon: IconPlug, tile: 'bg-gray-100 text-gray-700' };

export function IntegrationCard(props: { vm: IntegrationCardsModel; integration: IntegrationCardsModel['integrations'][number] }) {
  const vm = useIntegrationCard(props);
  const { handleConnect, handleDisconnect, integration, integrationConfig, isAmoActive, isFaceIdActive, isTelegramActive, loading, webhookUrl } = vm;
  const hasDetail = isAmoActive || isTelegramActive || isFaceIdActive;
  const service = SERVICE_ICONS[integration.id] || FALLBACK_SERVICE_ICON;
  const ServiceIcon = service.icon;

  return (
    <div
      key={integration.id}
      className={`panel min-w-0 ${hasDetail ? 'grid grid-cols-1 lg:col-span-full lg:grid-cols-[300px_minmax(0,1fr)]' : 'flex flex-col'}`}
    >
      <div className={`flex flex-1 flex-col p-5 ${hasDetail ? 'border-b border-gray-100 lg:border-b-0 lg:border-r' : ''}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[12px] ${service.tile}`}>
            <ServiceIcon className="h-[22px] w-[22px]" stroke={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[15px] font-semibold text-gray-900">{integration.name}</h4>
              <span className={`badge ${statusBadge(integration.status)}`}>
                {statusText(integration.status)}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{integration.description}</p>
          </div>
        </div>

        {integration.status === 'active' && (
          <div className="panel-inset mt-4 space-y-1 p-3 text-xs text-gray-600">
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

        <IntegrationConnectForms vm={vm} />

        <div className="mt-auto flex gap-2 pt-4">
          {integration.status === 'disconnected' || (integration.id === 'amocrm' && integration.status !== 'active') ? (
            <button
              type="button"
              onClick={() => handleConnect(integration.id)}
              disabled={loading || integration.id === 'google_sheets'}
              className="btn btn-primary"
            >
              <IconPlugConnected className="h-4 w-4" stroke={1.8} />
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
              className="btn btn-secondary"
            >
              <IconLinkOff className="h-4 w-4" stroke={1.8} />
              {loading ? 'Yangilanmoqda...' : 'Uzish'}
            </button>
          )}
        </div>
      </div>

      {hasDetail && (
        <div className="min-w-0 space-y-4 p-5">
          <AmoCrmPanel vm={vm} />

          <TelegramPanel vm={vm} />

          <FaceIdPanel vm={vm} />
        </div>
      )}
    </div>
  );
}
