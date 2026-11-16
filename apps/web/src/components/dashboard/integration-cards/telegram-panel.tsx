'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import type { IntegrationCardModel } from './use-integration-card';

export function TelegramPanel({ vm }: { vm: IntegrationCardModel }) {
  const { handleRepairTelegramWebhook, handleSaveTelegramRecipients, handleSendTelegramGroupSummaryNow, handleSendTelegramMonthlyReportNow, handleSendTelegramTodayReportNow, handleSendTelegramWeeklyReportNow, isTelegramActive, loading, recipientStorageReady, selectedTelegramDailyCourseIds, selectedTelegramRecipientIds, setSelectedTelegramDailyCourseIds, setSelectedTelegramRecipientIds, telegramCourseOptions, telegramHealthQuery, telegramRecipients, telegramRecipientsQuery, telegramReportSentMessage, telegramSelectionSavedAt } = vm;

  return (
    <>
      {isTelegramActive && (
        <div className="mt-4 rounded-md border border-cyan-100 bg-white p-3">
          <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Telegram webhook holati</p>
                <p className="text-xs text-gray-500">Webhook, kiruvchi yangilanish va foydalanuvchilar soni har 15 soniyada tekshiriladi.</p>
              </div>
              <button
                type="button"
                onClick={() => Promise.all([telegramHealthQuery.refetch(), telegramRecipientsQuery.refetch()])}
                disabled={telegramHealthQuery.isFetching || telegramRecipientsQuery.isFetching}
                className="rounded-md border border-cyan-200 bg-white px-3 py-1.5 text-xs font-medium text-cyan-700 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {telegramHealthQuery.isFetching || telegramRecipientsQuery.isFetching ? 'Yangilanmoqda...' : 'Yangilash'}
              </button>
            </div>

            {telegramHealthQuery.isLoading ? (
              <LoadingBlock className="mt-3" compact message="Webhook tekshirilmoqda..." />
            ) : telegramHealthQuery.data ? (
              <div className="mt-3 space-y-1 text-xs text-gray-600">
                <p>
                  Holat:{' '}
                  <span className={telegramHealthQuery.data.healthy ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>
                    {telegramHealthQuery.data.healthy ? 'Sog‘lom' : 'Muammo aniqlandi'}
                  </span>
                </p>
                <p>Foydalanuvchilar: {telegramHealthQuery.data.recipientCount}</p>
                <p>Online guruhlar: {telegramHealthQuery.data.onlineGroupCount}</p>
                <p>Offline guruhlar: {telegramHealthQuery.data.offlineGroupCount}</p>
                <p>
                  18:00 / 23:59 reja:{' '}
                  <span className={telegramHealthQuery.data.schedulerReady ? 'font-semibold text-green-600' : 'font-semibold text-amber-600'}>
                    {telegramHealthQuery.data.schedulerReady ? 'Tayyor' : 'Sozlash kerak'}
                  </span>
                </p>
                <p>Kutilayotgan webhook: <span className="break-all font-mono">{telegramHealthQuery.data.expectedWebhookUrl}</span></p>
                <p>Telegram webhook: <span className="break-all font-mono">{telegramHealthQuery.data.liveWebhookUrl || '-'}</span></p>
                <p>Navbatdagi update: {telegramHealthQuery.data.pendingUpdateCount}</p>
                <p>
                  Oxirgi kiruvchi update:{' '}
                  {telegramHealthQuery.data.lastInboundAt
                    ? new Date(telegramHealthQuery.data.lastInboundAt).toLocaleString()
                    : '-'}
                </p>
                {telegramHealthQuery.data.lastErrorMessage && (
                  <p className="text-red-600">Telegram xatosi: {telegramHealthQuery.data.lastErrorMessage}</p>
                )}
                {telegramHealthQuery.data.error && (
                  <p className="text-red-600">Tekshiruv xatosi: {telegramHealthQuery.data.error}</p>
                )}
                {telegramHealthQuery.data.recipientError && (
                  <p className="text-red-600">Qabul qiluvchilar xatosi: {telegramHealthQuery.data.recipientError}</p>
                )}
                {(!telegramHealthQuery.data.webhookMatches
                  || telegramHealthQuery.data.lastErrorMessage?.includes('403')) && (
                  <button
                    type="button"
                    onClick={handleRepairTelegramWebhook}
                    disabled={loading}
                    className="mt-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                  >
                    {loading ? 'Qayta ulanmoqda...' : 'Webhookni qayta ulash'}
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {!recipientStorageReady && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Telegram foydalanuvchilari ombori tayyor emas</p>
              <p className="mt-1 text-xs">
                {telegramRecipientsQuery.data?.recipientError || "Railway'da ma'lumotlar bazasi migratsiyasini ishga tushiring."}
              </p>
              <button
                type="button"
                onClick={() => Promise.all([telegramRecipientsQuery.refetch(), telegramHealthQuery.refetch()])}
                disabled={telegramRecipientsQuery.isFetching || telegramHealthQuery.isFetching}
                className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-60"
              >
                {telegramRecipientsQuery.isFetching ? 'Tekshirilmoqda...' : 'Qayta tekshirish'}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Rejalashtirilgan hisobot oluvchilari</p>
              <p className="text-xs text-gray-500">
                Foydalanuvchilar botga <span className="font-mono">/start</span> yuborgandan keyin shu yerda ko'rinadi. Kunlik/haftalik/oylik hisobot oluvchilarni belgilang.
              </p>
            </div>
            <span className="text-xs text-gray-500">
              {selectedTelegramRecipientIds.length}/{telegramRecipients.length} ta tanlangan
            </span>
          </div>

          {telegramRecipientsQuery.isLoading ? (
            <LoadingBlock className="mt-3" compact message="Telegram foydalanuvchilari yuklanmoqda..." />
          ) : !recipientStorageReady ? null : telegramRecipients.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Hozircha foydalanuvchi yo'q. Foydalanuvchilardan botni ochib <span className="font-mono">/start</span> yuborishni so'rang.
            </p>
          ) : (
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {telegramRecipients.map((recipient) => (
                <label
                  key={recipient.chatId}
                  className="flex items-start gap-3 rounded-md border border-gray-100 px-3 py-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedTelegramRecipientIds.includes(recipient.chatId)}
                    onChange={(event) => {
                      setSelectedTelegramRecipientIds((current) => {
                        if (event.target.checked) {
                          return Array.from(new Set([...current, recipient.chatId]));
                        }
                        return current.filter((chatId) => chatId !== recipient.chatId);
                      });
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{recipient.displayName}</p>
                    <p className="text-xs text-gray-500">
                      Chat ID: {recipient.chatId}
                      {recipient.username ? ` | @${recipient.username}` : ''}
                    </p>
                    {recipient.lastSeenAt && (
                      <p className="text-xs text-gray-500">
                        Oxirgi faollik: {new Date(recipient.lastSeenAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-md border border-cyan-100 bg-cyan-50/60 p-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-gray-900">Kunlik hisobotdagi kurslar</p>
              <p className="text-xs text-gray-500">
                PDF hisobotga sotuv va tarif kesimidagi ma'lumot qo'shish uchun 3 tagacha kurs tanlang.
              </p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              {[0, 1, 2].map((slot) => {
                const currentValue = selectedTelegramDailyCourseIds[slot] || '';
                const usedCourseIds = new Set(
                  selectedTelegramDailyCourseIds.filter((courseId, index) => courseId && index !== slot),
                );
                return (
                  <select
                    key={slot}
                    value={currentValue}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setSelectedTelegramDailyCourseIds((current) => {
                        const next = [...current];
                        next[slot] = nextValue;
                        return next.filter((courseId, index) => courseId || index < 3).slice(0, 3);
                      });
                    }}
                    disabled={telegramRecipientsQuery.isLoading || telegramCourseOptions.length === 0}
                    className="w-full rounded-md border border-cyan-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">Kurs tanlang</option>
                    {telegramCourseOptions.map((course) => (
                      <option
                        key={course.id}
                        value={course.id}
                        disabled={usedCourseIds.has(course.id)}
                      >
                        {course.name}{course.isActive ? '' : ' (nofaol)'}
                      </option>
                    ))}
                  </select>
                );
              })}
            </div>
            {telegramCourseOptions.length === 0 && (
              <p className="mt-2 text-xs text-gray-500">Kurslar topilmadi.</p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveTelegramRecipients}
              disabled={loading || telegramRecipientsQuery.isLoading || !recipientStorageReady || telegramRecipients.length === 0}
              className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Saqlanmoqda...' : 'Qabul qiluvchilarni saqlash'}
            </button>
            {telegramSelectionSavedAt && (
              <span className="text-xs text-green-700">
                Saqlandi: {new Date(telegramSelectionSavedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSendTelegramGroupSummaryNow}
              disabled={loading}
              className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-800 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Yuborilmoqda...' : 'Bugungi guruh hisobotini hozir yuborish'}
            </button>
            <button
              type="button"
              onClick={handleSendTelegramTodayReportNow}
              disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
              className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Yuborilmoqda...' : 'Bugungi hisobotni hozir yuborish'}
            </button>
            <button
              type="button"
              onClick={handleSendTelegramWeeklyReportNow}
              disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
              className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Yuborilmoqda...' : 'Haftalik hisobotni yuborish'}
            </button>
            <button
              type="button"
              onClick={handleSendTelegramMonthlyReportNow}
              disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
              className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Yuborilmoqda...' : 'Oylik hisobotni yuborish'}
            </button>
            {telegramReportSentMessage && (
              <span className="text-xs text-green-700">{telegramReportSentMessage}</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
