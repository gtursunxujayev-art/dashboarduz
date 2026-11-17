'use client';

import { IconAlertTriangle, IconDeviceFloppy, IconRefresh, IconSend } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import type { IntegrationCardModel } from './use-integration-card';

export function TelegramPanel({ vm }: { vm: IntegrationCardModel }) {
  const { handleRepairTelegramWebhook, handleSaveTelegramRecipients, handleSendTelegramGroupSummaryNow, handleSendTelegramMonthlyReportNow, handleSendTelegramTodayReportNow, handleSendTelegramWeeklyReportNow, isTelegramActive, loading, recipientStorageReady, selectedTelegramDailyCourseIds, selectedTelegramRecipientIds, setSelectedTelegramDailyCourseIds, setSelectedTelegramRecipientIds, telegramCourseOptions, telegramHealthQuery, telegramRecipients, telegramRecipientsQuery, telegramReportSentMessage, telegramSelectionSavedAt } = vm;

  return (
    <>
      {isTelegramActive && (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <section className="panel-inset">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Telegram webhook holati</p>
                  <p className="mt-0.5 text-xs text-gray-500">Webhook, kiruvchi yangilanish va foydalanuvchilar soni har 15 soniyada tekshiriladi.</p>
                </div>
                <button
                  type="button"
                  onClick={() => Promise.all([telegramHealthQuery.refetch(), telegramRecipientsQuery.refetch()])}
                  disabled={telegramHealthQuery.isFetching || telegramRecipientsQuery.isFetching}
                  className="btn btn-secondary btn-sm"
                >
                  <IconRefresh className="h-4 w-4" stroke={1.8} aria-hidden="true" />
                  {telegramHealthQuery.isFetching || telegramRecipientsQuery.isFetching ? 'Yangilanmoqda...' : 'Yangilash'}
                </button>
              </div>

              {telegramHealthQuery.isLoading ? (
                <LoadingBlock className="mt-3" compact message="Webhook tekshirilmoqda..." />
              ) : telegramHealthQuery.data ? (
                <div className="mt-3 space-y-3 text-xs text-gray-600">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <p className="rounded-[10px] bg-white px-3 py-2">
                      Holat:{' '}
                      <span className={telegramHealthQuery.data.healthy ? 'font-semibold text-green-600' : 'font-semibold text-red-600'}>
                        {telegramHealthQuery.data.healthy ? 'Sog‘lom' : 'Muammo aniqlandi'}
                      </span>
                    </p>
                    <p className="rounded-[10px] bg-white px-3 py-2">
                      18:00 / 23:59 reja:{' '}
                      <span className={telegramHealthQuery.data.schedulerReady ? 'font-semibold text-green-600' : 'font-semibold text-amber-600'}>
                        {telegramHealthQuery.data.schedulerReady ? 'Tayyor' : 'Sozlash kerak'}
                      </span>
                    </p>
                    <p className="tabular rounded-[10px] bg-white px-3 py-2">Foydalanuvchilar: {telegramHealthQuery.data.recipientCount}</p>
                    <p className="tabular rounded-[10px] bg-white px-3 py-2">Navbatdagi update: {telegramHealthQuery.data.pendingUpdateCount}</p>
                    <p className="tabular rounded-[10px] bg-white px-3 py-2">Online guruhlar: {telegramHealthQuery.data.onlineGroupCount}</p>
                    <p className="tabular rounded-[10px] bg-white px-3 py-2">Offline guruhlar: {telegramHealthQuery.data.offlineGroupCount}</p>
                  </div>
                  <div className="space-y-1">
                    <p>Kutilayotgan webhook: <span className="break-all font-mono">{telegramHealthQuery.data.expectedWebhookUrl}</span></p>
                    <p>Telegram webhook: <span className="break-all font-mono">{telegramHealthQuery.data.liveWebhookUrl || '-'}</span></p>
                    <p>
                      Oxirgi kiruvchi update:{' '}
                      {telegramHealthQuery.data.lastInboundAt
                        ? new Date(telegramHealthQuery.data.lastInboundAt).toLocaleString()
                        : '-'}
                    </p>
                  </div>
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
                      className="btn btn-danger-soft btn-sm"
                    >
                      {loading ? 'Qayta ulanmoqda...' : 'Webhookni qayta ulash'}
                    </button>
                  )}
                </div>
              ) : null}
            </section>

            {!recipientStorageReady && (
              <div className="alert alert-warning flex items-start gap-3">
                <IconAlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" stroke={1.6} />
                <div>
                  <p className="font-semibold">Telegram foydalanuvchilari ombori tayyor emas</p>
                  <p className="mt-1 text-xs">
                    {telegramRecipientsQuery.data?.recipientError || "Railway'da ma'lumotlar bazasi migratsiyasini ishga tushiring."}
                  </p>
                  <button
                    type="button"
                    onClick={() => Promise.all([telegramRecipientsQuery.refetch(), telegramHealthQuery.refetch()])}
                    disabled={telegramRecipientsQuery.isFetching || telegramHealthQuery.isFetching}
                    className="btn btn-warning-soft btn-sm mt-2"
                  >
                    {telegramRecipientsQuery.isFetching ? 'Tekshirilmoqda...' : 'Qayta tekshirish'}
                  </button>
                </div>
              </div>
            )}

            <section className="panel-inset">
              <p className="text-sm font-semibold text-gray-900">Kunlik hisobotdagi kurslar</p>
              <p className="mt-0.5 text-xs text-gray-500">
                PDF hisobotga sotuv va tarif kesimidagi ma'lumot qo'shish uchun 3 tagacha kurs tanlang.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3 2xl:grid-cols-1">
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
                      className="field"
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
            </section>
          </div>

          <div className="min-w-0 space-y-4">
            <section>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Rejalashtirilgan hisobot oluvchilari</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Foydalanuvchilar botga <span className="font-mono">/start</span> yuborgandan keyin shu yerda ko'rinadi. Kunlik/haftalik/oylik hisobot oluvchilarni belgilang.
                  </p>
                </div>
                <span className="badge badge-neutral tabular">
                  {selectedTelegramRecipientIds.length}/{telegramRecipients.length} ta tanlangan
                </span>
              </div>

              {telegramRecipientsQuery.isLoading ? (
                <LoadingBlock className="mt-3" compact message="Telegram foydalanuvchilari yuklanmoqda..." />
              ) : !recipientStorageReady ? null : telegramRecipients.length === 0 ? (
                <p className="mt-3 rounded-[12px] border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                  Hozircha foydalanuvchi yo'q. Foydalanuvchilardan botni ochib <span className="font-mono">/start</span> yuborishni so'rang.
                </p>
              ) : (
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {telegramRecipients.map((recipient) => {
                    const checked = selectedTelegramRecipientIds.includes(recipient.chatId);
                    return (
                      <label
                        key={recipient.chatId}
                        className={`flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 text-sm text-gray-700 hover:border-gray-300 ${checked ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedTelegramRecipientIds((current) => {
                              if (event.target.checked) {
                                return Array.from(new Set([...current, recipient.chatId]));
                              }
                              return current.filter((chatId) => chatId !== recipient.chatId);
                            });
                          }}
                          className="checkbox mt-0.5"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">{recipient.displayName}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
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
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                {telegramSelectionSavedAt && (
                  <span className="text-xs text-green-700">
                    Saqlandi: {new Date(telegramSelectionSavedAt).toLocaleTimeString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSaveTelegramRecipients}
                  disabled={loading || telegramRecipientsQuery.isLoading || !recipientStorageReady || telegramRecipients.length === 0}
                  className="btn btn-soft"
                >
                  <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Saqlanmoqda...' : 'Qabul qiluvchilarni saqlash'}
                </button>
              </div>
            </section>

            <section className="border-t border-gray-100 pt-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleSendTelegramGroupSummaryNow}
                  disabled={loading}
                  className="btn btn-secondary h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                >
                  <IconSend className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Yuborilmoqda...' : 'Bugungi guruh hisobotini hozir yuborish'}
                </button>
                <button
                  type="button"
                  onClick={handleSendTelegramTodayReportNow}
                  disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                  className="btn btn-secondary h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                >
                  <IconSend className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Yuborilmoqda...' : 'Bugungi hisobotni hozir yuborish'}
                </button>
                <button
                  type="button"
                  onClick={handleSendTelegramWeeklyReportNow}
                  disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                  className="btn btn-secondary h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                >
                  <IconSend className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Yuborilmoqda...' : 'Haftalik hisobotni yuborish'}
                </button>
                <button
                  type="button"
                  onClick={handleSendTelegramMonthlyReportNow}
                  disabled={loading || telegramRecipients.length === 0 || selectedTelegramRecipientIds.length === 0}
                  className="btn btn-secondary h-auto min-h-10 justify-start whitespace-normal py-2 text-left"
                >
                  <IconSend className="h-4 w-4" stroke={1.8} />
                  {loading ? 'Yuborilmoqda...' : 'Oylik hisobotni yuborish'}
                </button>
              </div>
              {telegramReportSentMessage && (
                <p className="mt-2 text-xs text-green-700">{telegramReportSentMessage}</p>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
