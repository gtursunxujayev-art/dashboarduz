'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import IntegrationCards from '@/components/dashboard/integration-cards';

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Integratsiyalar</h1>
        <p className="mt-1 text-sm text-gray-500">
          CRM, xabarnoma va VoIP xizmatlarini Dashboarduz ga ulang
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-lg font-medium text-gray-900">Meta Ads integratsiyasi</h3>
              <p className="mt-1 text-sm text-gray-500">
                Facebook/Instagram reklama xarajatlari, kliklar, CTR, CPL va CPQL tahlili uchun Marketing API ulanishi.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
              metaStatusQuery.data?.connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
            }`}>
              {metaStatusQuery.data?.connected ? 'Ulangan' : 'Ulanmagan'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <input
              value={metaAdAccountId}
              onChange={(event) => setMetaAdAccountId(event.target.value)}
              placeholder="Ad Account ID (act_...)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={metaAccessToken}
              onChange={(event) => setMetaAccessToken(event.target.value)}
              placeholder="System User access token"
              type="password"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={metaPixelId}
              onChange={(event) => setMetaPixelId(event.target.value)}
              placeholder="Pixel/Dataset ID (ixtiyoriy)"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => connectMetaAds.mutate({ adAccountId: metaAdAccountId, accessToken: metaAccessToken, pixelId: metaPixelId || undefined })}
              disabled={connectMetaAds.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {connectMetaAds.isLoading ? 'Tekshirilmoqda...' : 'Meta ulash'}
            </button>
          </div>

          {connectMetaAds.error && (
            <div className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              Meta ulashda xatolik: {connectMetaAds.error.message}
            </div>
          )}
          {connectMetaAds.data && (
            <div className="mt-3 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
              Meta ulandi: {connectMetaAds.data.connection.accountName || connectMetaAds.data.connection.adAccountId}
            </div>
          )}

          <div className="mt-5 rounded-md border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="text-sm text-gray-700">
                <p><strong>Account:</strong> {metaStatusQuery.data?.accountName || metaStatusQuery.data?.adAccountId || '-'}</p>
                <p><strong>Rows 30d:</strong> {metaStatusQuery.data?.rowsLast30d ?? 0}</p>
                <p><strong>Oxirgi sync:</strong> {metaStatusQuery.data?.lastSyncAt || '-'}</p>
              </div>
              <input
                value={metaSyncFrom}
                onChange={(event) => setMetaSyncFrom(event.target.value)}
                type="date"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                value={metaSyncTo}
                onChange={(event) => setMetaSyncTo(event.target.value)}
                type="date"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => syncMetaAds.mutate({ dateFrom: metaSyncFrom || undefined, dateTo: metaSyncTo || undefined })}
                disabled={syncMetaAds.isLoading || !metaStatusQuery.data?.connected}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
              >
                {syncMetaAds.isLoading ? 'Sync...' : 'Meta sync'}
              </button>
            </div>
            {syncMetaAds.error && (
              <div className="mt-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
                Meta sync xatoligi: {syncMetaAds.error.message}
              </div>
            )}
            {syncMetaAds.data && (
              <div className="mt-3 rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">
                Meta sync tugadi. Import qilingan qatorlar: {syncMetaAds.data.imported}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900">Mavjud integratsiyalar</h2>
            <p className="mt-1 text-sm text-gray-500">
              Ma'lumotlarni sinxronlash va jarayonlarni avtomatlashtirish uchun xizmatlarni ulang
            </p>
          </div>
          
          <IntegrationCards />
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Webhook sozlamalari</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                AmoCRM webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={amocrmWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(amocrmWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Token orqali ulanganidan keyin shu URL ni AmoCRM webhook sozlamasiga qo'shing.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                UTeL webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={utelWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(utelWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                UTeL webhook sozlamasida to'liq URL dan foydalaning (integration key bilan).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Face ID webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={faceIdWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(faceIdWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Face ID webhook POST so'rovlari ushbu URL ga yuboriladi.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
