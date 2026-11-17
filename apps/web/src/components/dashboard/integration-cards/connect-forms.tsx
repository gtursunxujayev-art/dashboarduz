'use client';

import type { IntegrationCardModel } from './use-integration-card';

export function IntegrationConnectForms({ vm }: { vm: IntegrationCardModel }) {
  const { amocrmBaseUrl, amocrmLongLivedToken, faceIdBranchWhitelistInput, faceIdUnmatchedPolicy, faceIdWebhookToken, integration, lastGeneratedFaceIdToken, setAmocrmBaseUrl, setAmocrmLongLivedToken, setFaceIdBranchWhitelistInput, setFaceIdUnmatchedPolicy, setFaceIdWebhookToken, setTelegramToken, telegramToken } = vm;

  return (
    <>
      {integration.id === 'amocrm' && integration.status !== 'active' && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="field-label">AmoCRM uzoq muddatli tokeni</label>
            <input
              type="password"
              value={amocrmLongLivedToken}
              onChange={(e) => setAmocrmLongLivedToken(e.target.value)}
              placeholder="Uzoq muddatli token"
              className="field"
            />
          </div>
          <div>
            <label className="field-label">AmoCRM asosiy manzil (ixtiyoriy)</label>
            <input
              type="url"
              value={amocrmBaseUrl}
              onChange={(e) => setAmocrmBaseUrl(e.target.value)}
              placeholder="https://www.amocrm.ru"
              className="field"
            />
          </div>
        </div>
      )}

      {integration.id === 'telegram' && integration.status === 'disconnected' && (
        <div className="mt-4">
          <label className="field-label">Telegram bot token</label>
          <input
            type="password"
            value={telegramToken}
            onChange={(e) => setTelegramToken(e.target.value)}
            placeholder="123456:ABC..."
            className="field"
          />
        </div>
      )}

      {integration.id === 'faceid_attendance' && integration.status === 'disconnected' && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="field-label">Webhook token (ixtiyoriy)</label>
            <input
              type="text"
              value={faceIdWebhookToken}
              onChange={(e) => setFaceIdWebhookToken(e.target.value)}
              placeholder="Bo'sh qoldirilsa token avtomatik yaratiladi"
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Filiallar ro'yxati (ixtiyoriy)</label>
            <input
              type="text"
              value={faceIdBranchWhitelistInput}
              onChange={(e) => setFaceIdBranchWhitelistInput(e.target.value)}
              placeholder="Masalan: Labzak, Chilonzor"
              className="field"
            />
          </div>
          <div>
            <label className="field-label">Mos kelmagan user hodisalari</label>
            <select
              value={faceIdUnmatchedPolicy}
              onChange={(e) => setFaceIdUnmatchedPolicy(e.target.value === 'ignore' ? 'ignore' : 'store')}
              className="field"
            >
              <option value="store">Store (anomalies uchun saqlash)</option>
              <option value="ignore">Ignore (saqlamaslik)</option>
            </select>
          </div>
          {lastGeneratedFaceIdToken && (
            <p className="alert alert-warning break-all px-3 py-2 text-xs">
              Yaratilgan token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
            </p>
          )}
        </div>
      )}
    </>
  );
}
