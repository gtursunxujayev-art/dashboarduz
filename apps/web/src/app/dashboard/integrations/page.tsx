'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import IntegrationCards from '@/components/dashboard/integration-cards';
import { PageHeader } from '@/components/ui/page-header';
import { IconBrandMeta, IconCopy, IconPlugConnected, IconRefresh, IconWebhook, IconX } from '@tabler/icons-react';

export default function IntegrationsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.integrations.list.useQuery();
  const metaStatusQuery = trpc.integrations.getMetaAdsStatus.useQuery(undefined, { retry: 1 });
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaPixelId, setMetaPixelId] = useState('');
  const [metaSyncFrom, setMetaSyncFrom] = useState('');
  const [metaSyncTo, setMetaSyncTo] = useState('');
  // UI-only: whether the Meta Ads connect sheet is open.
  const [metaSheetOpen, setMetaSheetOpen] = useState(false);
  const utelIntegration = listQuery.data?.find((integration: any) => integration.type === 'voip_utel');
  const faceIdIntegration = listQuery.data?.find((integration: any) => integration.type === 'faceid_attendance');
  const connectMetaAds = trpc.integrations.connectMetaAds.useMutation({
    onSuccess: async () => {
      setMetaAccessToken('');
      await utils.integrations.getMetaAdsStatus.invalidate();
      await utils.integrations.list.invalidate();
    },
  });
  const syncMetaAds = trpc.integrations.syncMetaAds.useMutation({
    onSuccess: async () => {
      await utils.integrations.getMetaAdsStatus.invalidate();
    },
  });

  useEffect(() => {
    if (!metaSheetOpen) {
      return undefined;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMetaSheetOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [metaSheetOpen]);

  const amocrmWebhook = `${process.env.NEXT_PUBLIC_API_URL}/webhooks/amocrm`;
  const utelWebhook = String((utelIntegration?.config as any)?.webhookUrl || `${process.env.NEXT_PUBLIC_API_URL}/webhooks/utel`);
  const faceIdWebhook = String((faceIdIntegration?.config as any)?.webhookUrl || `${process.env.NEXT_PUBLIC_API_URL}/webhooks/faceid`);

  const webhookRows = [
    {
      id: 'amocrm',
      label: 'AmoCRM webhook manzili',
      value: amocrmWebhook,
      help: "Token orqali ulanganidan keyin shu URL ni AmoCRM webhook sozlamasiga qo'shing.",
    },
    {
      id: 'utel',
      label: 'UTeL webhook manzili',
      value: utelWebhook,
      help: "UTeL webhook sozlamasida to'liq URL dan foydalaning (integration key bilan).",
    },
    {
      id: 'faceid',
      label: 'Face ID webhook manzili',
      value: faceIdWebhook,
      help: "Face ID webhook POST so'rovlari ushbu URL ga yuboriladi.",
    },
  ];

  const metaConnected = Boolean(metaStatusQuery.data?.connected);
  const metaStats = [
    { label: 'Account:', value: metaStatusQuery.data?.accountName || metaStatusQuery.data?.adAccountId || '-', tabular: false },
    { label: 'Rows 30d:', value: metaStatusQuery.data?.rowsLast30d ?? 0, tabular: true },
    { label: 'Oxirgi sync:', value: metaStatusQuery.data?.lastSyncAt || '-', tabular: true },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Integratsiyalar"
        description="CRM, xabarnoma va VoIP xizmatlarini Dashboarduz ga ulang"
      />

      <section className="space-y-4">
        <div>
          <h2 className="section-title">Mavjud integratsiyalar</h2>
          <p className="mt-1 text-sm text-gray-500">
            Ma'lumotlarni sinxronlash va jarayonlarni avtomatlashtirish uchun xizmatlarni ulang
          </p>
        </div>

        <IntegrationCards />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="panel flex min-w-0 flex-col">
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-[12px] bg-blue-50 text-blue-600">
                <IconBrandMeta className="h-6 w-6" stroke={1.6} />
              </span>
              <span className={`badge ${metaConnected ? 'badge-green' : 'badge-neutral'}`}>
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${metaConnected ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                {metaConnected ? 'Ulangan' : 'Ulanmagan'}
              </span>
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Meta Ads integratsiyasi</h3>
              <p className="mt-1 text-sm text-gray-500">
                Facebook/Instagram reklama xarajatlari, kliklar, CTR, CPL va CPQL tahlili uchun Marketing API ulanishi.
              </p>
            </div>

            <div className="grid grid-cols-1 overflow-hidden rounded-[16px] bg-gray-50 sm:grid-cols-3 sm:divide-x sm:divide-gray-200">
              {metaStats.map((stat) => (
                <p key={stat.label} className="min-w-0 px-4 py-3 text-sm">
                  <strong className="caption block font-medium">{stat.label}</strong>{' '}
                  <span className={`mt-1 block truncate font-semibold text-gray-900 ${stat.tabular ? 'tabular' : ''}`}>{stat.value}</span>
                </p>
              ))}
            </div>
            {(metaStatusQuery.data as any)?.tableMissing && (
              <p className="alert alert-error"><strong>DB:</strong> migration kerak</p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                value={metaSyncFrom}
                onChange={(event) => setMetaSyncFrom(event.target.value)}
                type="date"
                className="field tabular"
              />
              <input
                value={metaSyncTo}
                onChange={(event) => setMetaSyncTo(event.target.value)}
                type="date"
                className="field tabular"
              />
              <button
                type="button"
                onClick={() => syncMetaAds.mutate({ dateFrom: metaSyncFrom || undefined, dateTo: metaSyncTo || undefined })}
                disabled={syncMetaAds.isLoading || !metaStatusQuery.data?.connected}
                className="btn btn-secondary"
              >
                <IconRefresh className={`h-4 w-4 ${syncMetaAds.isLoading ? 'animate-spin' : ''}`} stroke={1.8} />
                {syncMetaAds.isLoading ? 'Sync...' : 'Meta sync'}
              </button>
            </div>
            {syncMetaAds.error && (
              <div className="alert alert-error">
                Meta sync xatoligi: {syncMetaAds.error.message}
              </div>
            )}
            {syncMetaAds.data && (
              <div className="alert alert-success">
                Meta sync tugadi. Import qilingan qatorlar: {syncMetaAds.data.imported}
              </div>
            )}
          </div>

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">
            <button type="button" onClick={() => setMetaSheetOpen(true)} className="btn btn-primary">
              <IconPlugConnected className="h-4 w-4" stroke={1.8} />
              Meta ulash
            </button>
          </div>
        </section>

        <section className="panel min-w-0">
          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-5 sm:px-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-700">
              <IconWebhook className="h-5 w-5" stroke={1.6} />
            </span>
            <h3 className="section-title">Webhook sozlamalari</h3>
          </div>
          <div className="divide-y divide-gray-100 px-5 sm:px-6">
            {webhookRows.map((row) => (
              <div key={row.id} className="py-5">
                <label htmlFor={`webhook-${row.id}`} className="text-sm font-medium text-gray-900">
                  {row.label}
                </label>
                <p className="mt-0.5 text-xs text-gray-500">
                  {row.help}
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    id={`webhook-${row.id}`}
                    type="text"
                    readOnly
                    value={row.value}
                    className="field min-w-0 flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(row.value)}
                    className="btn btn-secondary"
                  >
                    <IconCopy className="h-4 w-4" stroke={1.8} />
                    Nusxalash
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {metaSheetOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setMetaSheetOpen(false);
            }
          }}
        >
          <div role="dialog" aria-modal="true" className="modal-panel max-w-[560px]">
            <div className="modal-header">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-blue-50 text-blue-600">
                  <IconBrandMeta className="h-5 w-5" stroke={1.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="modal-title">Meta Ads integratsiyasi</h2>
                  <p className="modal-description">
                    Facebook/Instagram reklama xarajatlari, kliklar, CTR, CPL va CPQL tahlili uchun Marketing API ulanishi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMetaSheetOpen(false)}
                  aria-label="Yopish"
                  className="btn btn-ghost btn-icon btn-sm w-8"
                >
                  <IconX className="h-4 w-4" stroke={1.8} />
                </button>
              </div>
            </div>
            <div className="modal-body">
              <input
                value={metaAdAccountId}
                onChange={(event) => setMetaAdAccountId(event.target.value)}
                placeholder="Ad Account ID (act_...)"
                aria-label="Ad Account ID (act_...)"
                className="field"
              />
              <input
                value={metaAccessToken}
                onChange={(event) => setMetaAccessToken(event.target.value)}
                placeholder="System User access token"
                aria-label="System User access token"
                type="password"
                className="field"
              />
              <input
                value={metaPixelId}
                onChange={(event) => setMetaPixelId(event.target.value)}
                placeholder="Pixel/Dataset ID (ixtiyoriy)"
                aria-label="Pixel/Dataset ID (ixtiyoriy)"
                className="field"
              />

              {connectMetaAds.error && (
                <div className="alert alert-error">
                  Meta ulashda xatolik: {connectMetaAds.error.message}
                </div>
              )}
              {connectMetaAds.data && (
                <div className="alert alert-success">
                  Meta ulandi: {connectMetaAds.data.connection.accountName || connectMetaAds.data.connection.adAccountId}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" onClick={() => setMetaSheetOpen(false)} className="btn btn-ghost">
                Yopish
              </button>
              <button
                type="button"
                onClick={() => connectMetaAds.mutate({ adAccountId: metaAdAccountId, accessToken: metaAccessToken, pixelId: metaPixelId || undefined })}
                disabled={connectMetaAds.isLoading}
                className="btn btn-primary"
              >
                <IconPlugConnected className="h-4 w-4" stroke={1.8} />
                {connectMetaAds.isLoading ? 'Tekshirilmoqda...' : 'Meta ulash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
