'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import IntegrationCards from '@/components/dashboard/integration-cards';
import { PageHeader } from '@/components/ui/page-header';
import { IconBrandMeta, IconCopy, IconPlugConnected, IconRefresh, IconWebhook } from '@tabler/icons-react';

export default function IntegrationsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.integrations.list.useQuery();
  const metaStatusQuery = trpc.integrations.getMetaAdsStatus.useQuery(undefined, { retry: 1 });
  const [metaAdAccountId, setMetaAdAccountId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaPixelId, setMetaPixelId] = useState('');
  const [metaSyncFrom, setMetaSyncFrom] = useState('');
  const [metaSyncTo, setMetaSyncTo] = useState('');
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

  return (
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="panel min-w-0">
          <div className="panel-header items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                <IconBrandMeta className="h-5 w-5" stroke={1.6} />
              </span>
              <div className="min-w-0">
                <h3 className="section-title">Meta Ads integratsiyasi</h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  Facebook/Instagram reklama xarajatlari, kliklar, CTR, CPL va CPQL tahlili uchun Marketing API ulanishi.
                </p>
              </div>
            </div>
            <span className={`badge ${metaStatusQuery.data?.connected ? 'badge-green' : 'badge-neutral'}`}>
              {metaStatusQuery.data?.connected ? 'Ulangan' : 'Ulanmagan'}
            </span>
          </div>

          <div className="panel-body space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={metaAdAccountId}
                onChange={(event) => setMetaAdAccountId(event.target.value)}
                placeholder="Ad Account ID (act_...)"
                className="field"
              />
              <input
                value={metaAccessToken}
                onChange={(event) => setMetaAccessToken(event.target.value)}
                placeholder="System User access token"
                type="password"
                className="field"
              />
              <input
                value={metaPixelId}
                onChange={(event) => setMetaPixelId(event.target.value)}
                placeholder="Pixel/Dataset ID (ixtiyoriy)"
                className="field"
              />
            </div>
            <div className="flex justify-end">
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

          <div className="border-t border-gray-100 p-5 sm:p-6">
            <div className="grid grid-cols-1 gap-3 text-sm text-gray-700 sm:grid-cols-3">
              <p className="panel-inset py-3"><strong className="block text-xs font-medium text-gray-500">Account:</strong> <span className="font-medium text-gray-900">{metaStatusQuery.data?.accountName || metaStatusQuery.data?.adAccountId || '-'}</span></p>
              <p className="panel-inset py-3"><strong className="block text-xs font-medium text-gray-500">Rows 30d:</strong> <span className="tabular font-medium text-gray-900">{metaStatusQuery.data?.rowsLast30d ?? 0}</span></p>
              <p className="panel-inset py-3"><strong className="block text-xs font-medium text-gray-500">Oxirgi sync:</strong> <span className="tabular font-medium text-gray-900">{metaStatusQuery.data?.lastSyncAt || '-'}</span></p>
            </div>
            {(metaStatusQuery.data as any)?.tableMissing && (
              <p className="alert alert-error mt-3"><strong>DB:</strong> migration kerak</p>
            )}

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                value={metaSyncFrom}
                onChange={(event) => setMetaSyncFrom(event.target.value)}
                type="date"
                className="field"
              />
              <input
                value={metaSyncTo}
                onChange={(event) => setMetaSyncTo(event.target.value)}
                type="date"
                className="field"
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
              <div className="alert alert-error mt-3">
                Meta sync xatoligi: {syncMetaAds.error.message}
              </div>
            )}
            {syncMetaAds.data && (
              <div className="alert alert-success mt-3">
                Meta sync tugadi. Import qilingan qatorlar: {syncMetaAds.data.imported}
              </div>
            )}
          </div>
        </section>

        <section className="panel min-w-0">
          <div className="panel-header">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-gray-100 text-gray-700">
                <IconWebhook className="h-5 w-5" stroke={1.6} />
              </span>
              <h3 className="section-title">Webhook sozlamalari</h3>
            </div>
          </div>
          <div className="divide-y divide-gray-100 px-5 pb-2 sm:px-6">
            {webhookRows.map((row) => (
              <div key={row.id} className="py-4">
                <label htmlFor={`webhook-${row.id}`} className="field-label">
                  {row.label}
                </label>
                <div className="flex gap-2">
                  <input
                    id={`webhook-${row.id}`}
                    type="text"
                    readOnly
                    value={row.value}
                    className="field min-w-0 flex-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(row.value)}
                    className="btn btn-secondary"
                  >
                    <IconCopy className="h-4 w-4" stroke={1.8} />
                    Nusxalash
                  </button>
                </div>
                <p className="field-help">
                  {row.help}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
