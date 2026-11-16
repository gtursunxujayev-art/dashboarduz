'use client';

import type { AttendancePageModel } from './use-attendance-page';

export function AttendanceCorrectionForm({ vm }: { vm: AttendancePageModel }) {
  const { correctionAction, correctionError, correctionEventId, correctionMutation, correctionReason, correctionSuccess, correctionSummaryDate, correctionTimestamp, correctionUserId, eventOptions, handleApplyCorrection, isAdmin, setCorrectionAction, setCorrectionEventId, setCorrectionReason, setCorrectionSummaryDate, setCorrectionTimestamp, setCorrectionUserId, userOptions, usersQuery } = vm;

  return (
    <>
      {isAdmin && (
        <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Admin tuzatishlari</h3>
          <form onSubmit={handleApplyCorrection} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Amal</label>
                <select
                  value={correctionAction}
                  onChange={(event) => setCorrectionAction(event.target.value as 'add_missing_in' | 'add_missing_out' | 'edit_event_time' | 'mark_justified_absence')}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="add_missing_in">Kirishni qo'shish</option>
                  <option value="add_missing_out">Ketishni qo'shish</option>
                  <option value="edit_event_time">Event vaqtini tahrirlash</option>
                  <option value="mark_justified_absence">Kelmagan kunni sababli qilish</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Xodim</label>
                <select
                  value={correctionUserId}
                  onChange={(event) => setCorrectionUserId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Xodim tanlang</option>
                  {userOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
              {correctionAction === 'edit_event_time' ? (
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Event</label>
                  <select
                    value={correctionEventId}
                    onChange={(event) => setCorrectionEventId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Event tanlang</option>
                    {eventOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ) : correctionAction === 'mark_justified_absence' ? (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Sana</label>
                  <input
                    type="date"
                    value={correctionSummaryDate}
                    onChange={(event) => setCorrectionSummaryDate(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    {correctionAction === 'add_missing_in' ? 'IN vaqti' : 'OUT vaqti'}
                  </label>
                  <input
                    type="datetime-local"
                    value={correctionTimestamp}
                    onChange={(event) => setCorrectionTimestamp(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}
              {correctionAction === 'edit_event_time' && (
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Yangi vaqt</label>
                  <input
                    type="datetime-local"
                    value={correctionTimestamp}
                    onChange={(event) => setCorrectionTimestamp(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
              <textarea
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                placeholder="Tuzatish sababi (majburiy)"
                rows={2}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={correctionMutation.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {correctionMutation.isLoading ? 'Saqlanmoqda...' : 'Tuzatishni saqlash'}
              </button>
            </div>
            {correctionSuccess && (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{correctionSuccess}</p>
            )}
            {correctionError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{correctionError}</p>
            )}
            {usersQuery.error && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                Xodimlar ro&apos;yxatini yuklashda xatolik: {usersQuery.error.message}
              </p>
            )}
          </form>
        </div>
      )}
    </>
  );
}
