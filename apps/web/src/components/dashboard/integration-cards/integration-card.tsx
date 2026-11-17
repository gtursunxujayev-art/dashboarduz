'use client';

import { useEffect, useState } from 'react';
import {
  IconAddressBook,
  IconBrandTelegram,
  IconFaceId,
  IconFileSpreadsheet,
  IconLinkOff,
  IconPhoneCall,
  IconPlug,
  IconPlugConnected,
  IconX,
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

const STATUS_DOTS: Record<string, string> = {
  active: 'bg-emerald-500',
  pending: 'bg-amber-500',
  error: 'bg-red-500',
};

export function IntegrationCard(props: { vm: IntegrationCardsModel; integration: IntegrationCardsModel['integrations'][number] }) {
  const vm = useIntegrationCard(props);
  const { handleConnect, handleDisconnect, integration, integrationConfig, isAmoActive, isFaceIdActive, isTelegramActive, loading, webhookUrl } = vm;
  const hasDetail = isAmoActive || isTelegramActive || isFaceIdActive;
  const service = SERVICE_ICONS[integration.id] || FALLBACK_SERVICE_ICON;
  const ServiceIcon = service.icon;

  // The connect fields live in a sheet; it closes by itself once the service no longer needs them.
  const hasConnectForm =
    (integration.id === 'amocrm' && integration.status !== 'active')
    || (integration.id === 'telegram' && integration.status === 'disconnected')
    || (integration.id === 'faceid_attendance' && integration.status === 'disconnected');
  const [connectOpen, setConnectOpen] = useState(false);
  useEffect(() => {
    if (!hasConnectForm) {
      setConnectOpen(false);
    }
  }, [hasConnectForm]);
  useEffect(() => {
    if (!connectOpen) {
      return undefined;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [connectOpen]);

  const showConnect = integration.status === 'disconnected' || (integration.id === 'amocrm' && integration.status !== 'active');
  const connectLabel = loading
    ? "Ulanmoqda..."
    : integration.id === 'google_sheets'
      ? "O'chirilgan"
      : integration.id === 'amocrm'
        ? 'Token orqali ulash'
        : integration.id === 'faceid_attendance'
          ? 'Webhookni ulash'
          : 'Ulash';

  const actionButton = showConnect ? (
    <button
      type="button"
      onClick={() => (hasConnectForm ? setConnectOpen(true) : handleConnect(integration.id))}
      disabled={loading || integration.id === 'google_sheets'}
      className="btn btn-primary"
    >
      <IconPlugConnected className="h-4 w-4" stroke={1.8} />
      {connectLabel}
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
  );

  const statusPill = (
    <span className={`badge ${statusBadge(integration.status)}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[integration.status] || 'bg-gray-400'}`} />
      {statusText(integration.status)}
    </span>
  );

  const iconTile = (
    <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[12px] ${service.tile}`}>
      <ServiceIcon className="h-6 w-6" stroke={1.6} />
    </span>
  );

  const activeMeta = integration.status === 'active' && (
    <div className="panel-inset space-y-1 p-3 text-xs text-gray-600">
      {integration.lastSyncAt && <p>Oxirgi sinxron: {new Date(integration.lastSyncAt).toLocaleString()}</p>}
      {integrationConfig.lastValidatedAt && (
        <p>Oxirgi tekshiruv: {new Date(String(integrationConfig.lastValidatedAt)).toLocaleString()}</p>
      )}
      {webhookUrl && <p className="break-all">Webhook manzili: {webhookUrl}</p>}
      {integrationConfig.connectionMode && (
        <p>Rejim: {String(integrationConfig.connectionMode)}</p>
      )}
    </div>
  );

  return (
    <>
      <article
        data-testid="integration-card"
        className={`panel flex min-w-0 flex-col ${
          hasDetail ? 'md:col-span-full' : 'transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md'
        }`}
      >
        {hasDetail ? (
          <div className="flex flex-col gap-4 border-b border-gray-100 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              {iconTile}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-semibold text-gray-900">{integration.name}</h4>
                  {statusPill}
                </div>
                <p className="mt-1 max-w-[70ch] text-sm text-gray-500">{integration.description}</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-3 lg:max-w-[420px] lg:items-end">
              {actionButton}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                {iconTile}
                {statusPill}
              </div>
              <div>
                <h4 className="text-base font-semibold text-gray-900">{integration.name}</h4>
                <p className="mt-1 text-sm text-gray-500">{integration.description}</p>
              </div>
              {activeMeta}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">
              {actionButton}
            </div>
          </>
        )}

        {hasDetail && (
          <div className="min-w-0 space-y-5 p-5 sm:p-6">
            {activeMeta}

            <AmoCrmPanel vm={vm} />

            <TelegramPanel vm={vm} />

            <FaceIdPanel vm={vm} />
          </div>
        )}
      </article>

      {/* Rendered beside the card, not inside it: the card's hover transform would trap a fixed sheet. */}
      {connectOpen && hasConnectForm && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setConnectOpen(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true" className="modal-panel max-w-[560px]">
            <div className="modal-header">
              <div className="flex items-start gap-3">
                {iconTile}
                <div className="min-w-0 flex-1">
                  <h2 className="modal-title">{integration.name}</h2>
                  <p className="modal-description">{integration.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConnectOpen(false)}
                  aria-label="Yopish"
                  className="btn btn-ghost btn-icon btn-sm w-8"
                >
                  <IconX className="h-4 w-4" stroke={1.8} />
                </button>
              </div>
            </div>
            <div className="modal-body">
              {vm.vm.error && <p className="alert alert-error">{vm.vm.error}</p>}
              <IntegrationConnectForms vm={vm} />
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setConnectOpen(false)} className="btn btn-ghost">
                Yopish
              </button>
              <button
                type="button"
                onClick={() => handleConnect(integration.id)}
                disabled={loading}
                className="btn btn-primary"
              >
                <IconPlugConnected className="h-4 w-4" stroke={1.8} />
                {connectLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
