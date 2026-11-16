'use client';

import type { IntegrationCardModel } from './use-integration-card';

export function IntegrationConnectForms({ vm }: { vm: IntegrationCardModel }) {
  const { amocrmBaseUrl, amocrmLongLivedToken, faceIdBranchWhitelistInput, faceIdUnmatchedPolicy, faceIdWebhookToken, integration, lastGeneratedFaceIdToken, setAmocrmBaseUrl, setAmocrmLongLivedToken, setFaceIdBranchWhitelistInput, setFaceIdUnmatchedPolicy, setFaceIdWebhookToken, setTelegramToken, telegramToken } = vm;

  return (
    <>
      {integration.id === 'amocrm' && integration.status !== 'active' && (
        <div className="mt-4 space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-700">AmoCRM uzoq muddatli tokeni</label>
            <input
              type="password"
              value={amocrmLongLivedToken}
              onChange={(e) => setAmocrmLongLivedToken(e.target.value)}
              placeholder="Uzoq muddatli token"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">AmoCRM asosiy manzil (ixtiyoriy)</label>
            <input
              type="url"
              value={amocrmBaseUrl}
              onChange={(e) => setAmocrmBaseUrl(e.target.value)}
              placeholder="https://www.amocrm.ru"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
      )}

      {integration.id === 'telegram' && integration.status === 'disconnected' && (
        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-700">Telegram bot token</label>
          <input
            type="password"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder="123456:ABC..."
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      {integration.id === 'faceid_attendance' && integration.status === 'disconnected' && (
        <div className="mt-4 space-y-2">
          <div>
            <label className="block text-xs font-medium text-gray-700">Webhook token (ixtiyoriy)</label>
            <input
              type="text"
              value={faceIdWebhookToken}
              onChange={(e) => setFaceIdWebhookToken(e.target.value)}
              placeholder="Bo'sh qoldirilsa token avtomatik yaratiladi"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Filiallar ro'yxati (ixtiyoriy)</label>
            <input
              type="text"
              value={faceIdBranchWhitelistInput}
              onChange={(e) => setFaceIdBranchWhitelistInput(e.target.value)}
              placeholder="Masalan: Labzak, Chilonzor"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">Mos kelmagan user hodisalari</label>
            <select
              value={faceIdUnmatchedPolicy}
              onChange={(e) => setFaceIdUnmatchedPolicy(e.target.value === 'ignore' ? 'ignore' : 'store')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="store">Store (anomalies uchun saqlash)</option>
              <option value="ignore">Ignore (saqlamaslik)</option>
            </select>
          </div>
          {lastGeneratedFaceIdToken && (
            <p className="break-all rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
              Yaratilgan token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
