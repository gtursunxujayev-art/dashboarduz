'use client';

import type { IntegrationCardModel } from './use-integration-card';

export function FaceIdPanel({ vm }: { vm: IntegrationCardModel }) {
  const { faceIdBranchWhitelistInput, faceIdExternalUserId, faceIdMappedUserId, faceIdMappings, faceIdStatus, faceIdUnmatchedPolicy, handleRemoveFaceIdMapping, handleRotateFaceIdToken, handleSaveFaceIdMapping, handleSaveFaceIdSettings, integrationConfig, isFaceIdActive, lastGeneratedFaceIdToken, loading, setFaceIdBranchWhitelistInput, setFaceIdExternalUserId, setFaceIdMappedUserId, setFaceIdUnmatchedPolicy, users } = vm;

  return (
    <>
      {isFaceIdActive && (
        <div className="mt-4 rounded-md border border-rose-100 bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Face ID webhook sozlamasi</p>
              <p className="text-xs text-gray-500">
                Bearer token bilan <span className="font-mono">POST /webhooks/faceid</span> endpointiga yuboriladi.
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-1 text-xs text-gray-600">
            <p className="break-all">
              Webhook: {String(faceIdStatus?.webhookUrl || integrationConfig.webhookUrl || '')}
            </p>
            <p>Token holati: {faceIdStatus?.hasToken ? 'Mavjud' : 'Yo‘q'}</p>
            {!faceIdStatus?.hasToken && (
              <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                Token topilmadi. Avval <b>Tokenni yangilash</b> tugmasini bosing va shu tokenni Face ID yuboruvchi tizimga kiriting.
              </p>
            )}
            <p>Mos kelmagan foydalanuvchi rejimi: {faceIdStatus?.unmatchedUserPolicy === 'ignore' ? 'Ignore' : 'Store'}</p>
            {Array.isArray(faceIdStatus?.branchWhitelist) && faceIdStatus.branchWhitelist.length > 0 && (
              <p>Ruxsat etilgan filiallar: {faceIdStatus.branchWhitelist.join(', ')}</p>
            )}
            {faceIdStatus?.lastSyncAt && (
              <p>Oxirgi sinxron: {new Date(faceIdStatus.lastSyncAt).toLocaleString()}</p>
            )}
            {lastGeneratedFaceIdToken && (
              <p className="break-all rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                Yangi token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
              </p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded border border-rose-100 bg-rose-50 p-2 text-xs text-rose-900">
              <p>Kutilayotgan webhook: {Number(faceIdStatus?.health?.webhookPending || 0)}</p>
              <p>24 soat xatolik: {Number(faceIdStatus?.health?.webhookFailedLast24h || 0)}</p>
              <p>24 soat processed: {Number(faceIdStatus?.health?.webhookProcessedLast24h || 0)}</p>
            </div>
            <div className="rounded border border-rose-100 bg-rose-50 p-2 text-xs text-rose-900">
              <p>7 kun eventlar: {Number(faceIdStatus?.health?.eventsLast7d || 0)}</p>
              <p>7 kun matched: {Number(faceIdStatus?.health?.matchedEventsLast7d || 0)}</p>
              <p>7 kun unmatched: {Number(faceIdStatus?.health?.unmatchedEventsLast7d || 0)}</p>
            </div>
          </div>

          {Array.isArray(faceIdStatus?.recentWebhookErrors) && faceIdStatus.recentWebhookErrors.length > 0 && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-2">
              <p className="text-xs font-semibold text-red-700">Oxirgi webhook xatolari</p>
              <div className="mt-1 space-y-1 text-xs text-red-700">
                {faceIdStatus.recentWebhookErrors.map((row: any) => (
                  <p key={row.id}>
                    {new Date(row.createdAt).toLocaleString()} - {row.eventType}: {String(row.errorMessage || '')}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2 rounded-md border border-rose-100 bg-white p-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">Mos kelmagan user hodisalari</label>
              <select
                value={faceIdUnmatchedPolicy}
                onChange={(e) => setFaceIdUnmatchedPolicy(e.target.value === 'ignore' ? 'ignore' : 'store')}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              >
                <option value="store">Store (anomalies uchun saqlash)</option>
                <option value="ignore">Ignore (saqlamaslik)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">Filiallar ro'yxati (ixtiyoriy)</label>
              <input
                type="text"
                value={faceIdBranchWhitelistInput}
                onChange={(e) => setFaceIdBranchWhitelistInput(e.target.value)}
                placeholder="Masalan: Labzak, Chilonzor"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveFaceIdSettings}
              disabled={loading}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Saqlanmoqda...' : 'Face ID sozlamalarini saqlash'}
            </button>
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={handleRotateFaceIdToken}
              disabled={loading}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Yangilanmoqda...' : 'Tokenni yangilash'}
            </button>
          </div>

          <div className="mt-3 space-y-2 rounded-md border border-rose-100 bg-white p-3">
            <p className="text-sm font-medium text-gray-900">Face ID user mapping</p>
            <p className="text-xs text-gray-500">
              Match order: telefon -&gt; external ID -&gt; to‘liq ism. External ID mapping faqat 2-qadamda ishlatiladi.
            </p>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                value={faceIdExternalUserId}
                onChange={(e) => setFaceIdExternalUserId(e.target.value)}
                placeholder="External user ID (masalan: 2845)"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              <select
                value={faceIdMappedUserId}
                onChange={(e) => setFaceIdMappedUserId(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              >
                <option value="">Foydalanuvchini tanlang</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {(user.name || user.username || user.id)}{user.phone ? ` (${user.phone})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSaveFaceIdMapping}
                disabled={loading}
                className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Saqlanmoqda...' : 'Mapping saqlash'}
              </button>
            </div>

            <div className="max-h-56 overflow-auto rounded-md border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">External ID</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">User</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Telefon</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Holat</th>
                    <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {faceIdMappings.map((row: any) => (
                    <tr key={row.externalUserId}>
                      <td className="px-2 py-2 text-xs text-gray-700">{row.externalUserId}</td>
                      <td className="px-2 py-2 text-xs text-gray-700">{row.userName || row.userId}</td>
                      <td className="px-2 py-2 text-xs text-gray-700">{row.userPhone || '-'}</td>
                      <td className="px-2 py-2 text-xs text-gray-700">{row.userActive ? 'Faol' : 'No-faol'}</td>
                      <td className="px-2 py-2 text-xs">
                        <button
                          type="button"
                          onClick={() => handleRemoveFaceIdMapping(String(row.externalUserId))}
                          disabled={loading}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          O‘chirish
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!faceIdMappings.length && (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-center text-xs text-gray-500">
                        Hozircha external ID mappinglar yo‘q.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
