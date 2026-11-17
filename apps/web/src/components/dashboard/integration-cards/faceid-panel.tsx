'use client';

import { IconDeviceFloppy, IconKey, IconTrash } from '@tabler/icons-react';
import type { IntegrationCardModel } from './use-integration-card';

export function FaceIdPanel({ vm }: { vm: IntegrationCardModel }) {
  const { faceIdBranchWhitelistInput, faceIdExternalUserId, faceIdMappedUserId, faceIdMappings, faceIdStatus, faceIdUnmatchedPolicy, handleRemoveFaceIdMapping, handleRotateFaceIdToken, handleSaveFaceIdMapping, handleSaveFaceIdSettings, integrationConfig, isFaceIdActive, lastGeneratedFaceIdToken, loading, setFaceIdBranchWhitelistInput, setFaceIdExternalUserId, setFaceIdMappedUserId, setFaceIdUnmatchedPolicy, users } = vm;

  return (
    <>
      {isFaceIdActive && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Face ID webhook sozlamasi</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Bearer token bilan <span className="font-mono">POST /webhooks/faceid</span> endpointiga yuboriladi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRotateFaceIdToken}
                  disabled={loading}
                  className="btn btn-danger-soft btn-sm"
                >
                  <IconKey className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Yangilanmoqda...' : 'Tokenni yangilash'}
                </button>
              </div>

              <div className="panel-inset space-y-1 p-3 text-xs text-gray-600">
                <p className="break-all">
                  Webhook: {String(faceIdStatus?.webhookUrl || integrationConfig.webhookUrl || '')}
                </p>
                <p>Token holati: {faceIdStatus?.hasToken ? 'Mavjud' : 'Yo‘q'}</p>
                <p>Mos kelmagan foydalanuvchi rejimi: {faceIdStatus?.unmatchedUserPolicy === 'ignore' ? 'Ignore' : 'Store'}</p>
                {Array.isArray(faceIdStatus?.branchWhitelist) && faceIdStatus.branchWhitelist.length > 0 && (
                  <p>Ruxsat etilgan filiallar: {faceIdStatus.branchWhitelist.join(', ')}</p>
                )}
                {faceIdStatus?.lastSyncAt && (
                  <p>Oxirgi sinxron: {new Date(faceIdStatus.lastSyncAt).toLocaleString()}</p>
                )}
              </div>
              {!faceIdStatus?.hasToken && (
                <p className="alert alert-warning px-3 py-2 text-xs">
                  Token topilmadi. Avval <b>Tokenni yangilash</b> tugmasini bosing va shu tokenni Face ID yuboruvchi tizimga kiriting.
                </p>
              )}
              {lastGeneratedFaceIdToken && (
                <p className="alert alert-info break-all px-3 py-2 text-xs">
                  Yangi token: <span className="font-mono">{lastGeneratedFaceIdToken}</span>
                </p>
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="tabular space-y-0.5 rounded-[10px] border border-gray-200 px-3 py-2.5 text-xs text-gray-600">
                  <p>Kutilayotgan webhook: {Number(faceIdStatus?.health?.webhookPending || 0)}</p>
                  <p>24 soat xatolik: {Number(faceIdStatus?.health?.webhookFailedLast24h || 0)}</p>
                  <p>24 soat processed: {Number(faceIdStatus?.health?.webhookProcessedLast24h || 0)}</p>
                </div>
                <div className="tabular space-y-0.5 rounded-[10px] border border-gray-200 px-3 py-2.5 text-xs text-gray-600">
                  <p>7 kun eventlar: {Number(faceIdStatus?.health?.eventsLast7d || 0)}</p>
                  <p>7 kun matched: {Number(faceIdStatus?.health?.matchedEventsLast7d || 0)}</p>
                  <p>7 kun unmatched: {Number(faceIdStatus?.health?.unmatchedEventsLast7d || 0)}</p>
                </div>
              </div>

              {Array.isArray(faceIdStatus?.recentWebhookErrors) && faceIdStatus.recentWebhookErrors.length > 0 && (
                <div className="alert alert-error px-3 py-2">
                  <p className="text-xs font-semibold">Oxirgi webhook xatolari</p>
                  <div className="mt-1 space-y-1 text-xs">
                    {faceIdStatus.recentWebhookErrors.map((row: any) => (
                      <p key={row.id}>
                        {new Date(row.createdAt).toLocaleString()} - {row.eventType}: {String(row.errorMessage || '')}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="panel-inset space-y-3">
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
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveFaceIdSettings}
                  disabled={loading}
                  className="btn btn-soft"
                >
                  <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Saqlanmoqda...' : 'Face ID sozlamalarini saqlash'}
                </button>
              </div>
            </section>
          </div>

          <section className="space-y-3 border-t border-gray-100 pt-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">Face ID user mapping</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Match order: telefon -&gt; external ID -&gt; to‘liq ism. External ID mapping faqat 2-qadamda ishlatiladi.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
              <input
                type="text"
                value={faceIdExternalUserId}
                onChange={(e) => setFaceIdExternalUserId(e.target.value)}
                placeholder="External user ID (masalan: 2845)"
                className="field"
              />
              <select
                value={faceIdMappedUserId}
                onChange={(e) => setFaceIdMappedUserId(e.target.value)}
                className="field"
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
                className="btn btn-primary"
              >
                {loading ? 'Saqlanmoqda...' : 'Mapping saqlash'}
              </button>
            </div>

            <div className="max-h-64 overflow-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>External ID</th>
                    <th>User</th>
                    <th>Telefon</th>
                    <th>Holat</th>
                    <th className="text-right">Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {faceIdMappings.map((row: any) => (
                    <tr key={row.externalUserId}>
                      <td className="tabular font-mono text-xs">{row.externalUserId}</td>
                      <td className="font-medium text-gray-900">{row.userName || row.userId}</td>
                      <td className="tabular text-gray-600">{row.userPhone || '-'}</td>
                      <td>
                        <span className={`badge ${row.userActive ? 'badge-green' : 'badge-neutral'}`}>
                          {row.userActive ? 'Faol' : 'No-faol'}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveFaceIdMapping(String(row.externalUserId))}
                          disabled={loading}
                          className="btn btn-danger-soft btn-sm"
                        >
                          <IconTrash className="h-3.5 w-3.5" stroke={1.8} />
                          O‘chirish
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!faceIdMappings.length && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-xs text-gray-500">
                        Hozircha external ID mappinglar yo‘q.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
