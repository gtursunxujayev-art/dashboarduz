'use client';

import { IconAdjustmentsHorizontal, IconDeviceFloppy } from '@tabler/icons-react';
import type { AttendancePageModel } from './use-attendance-page';

export function AttendanceCorrectionForm({ vm }: { vm: AttendancePageModel }) {
  const { correctionAction, correctionError, correctionEventId, correctionMutation, correctionReason, correctionSuccess, correctionSummaryDate, correctionTimestamp, correctionUserId, eventOptions, handleApplyCorrection, isAdmin, setCorrectionAction, setCorrectionEventId, setCorrectionReason, setCorrectionSummaryDate, setCorrectionTimestamp, setCorrectionUserId, userOptions, usersQuery } = vm;

  return (
    <>
      {isAdmin && (
        <section className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <IconAdjustmentsHorizontal className="h-4 w-4" stroke={1.8} />
              </span>
              <h3 className="section-title">Admin tuzatishlari</h3>
            </div>
          </div>
          <form onSubmit={handleApplyCorrection} className="space-y-4 p-5 pt-4 sm:p-6 sm:pt-5">
            <div>
              <label className="field-label">Amal</label>
              <select
                value={correctionAction}
                onChange={(event) => setCorrectionAction(event.target.value as 'add_missing_in' | 'add_missing_out' | 'edit_event_time' | 'mark_justified_absence')}
                className="field"
              >
                <option value="add_missing_in">Kirishni qo'shish</option>
                <option value="add_missing_out">Ketishni qo'shish</option>
                <option value="edit_event_time">Event vaqtini tahrirlash</option>
                <option value="mark_justified_absence">Kelmagan kunni sababli qilish</option>
              </select>
            </div>
            <div>
              <label className="field-label">Xodim</label>
              <select
                value={correctionUserId}
                onChange={(event) => setCorrectionUserId(event.target.value)}
                className="field"
              >
                <option value="">Xodim tanlang</option>
                {userOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            {correctionAction === 'edit_event_time' ? (
              <div>
                <label className="field-label">Event</label>
                <select
                  value={correctionEventId}
                  onChange={(event) => setCorrectionEventId(event.target.value)}
                  className="field"
                >
                  <option value="">Event tanlang</option>
                  {eventOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : correctionAction === 'mark_justified_absence' ? (
              <div>
                <label className="field-label">Sana</label>
                <input
                  type="date"
                  value={correctionSummaryDate}
                  onChange={(event) => setCorrectionSummaryDate(event.target.value)}
                  className="field"
                />
              </div>
            ) : (
              <div>
                <label className="field-label">
                  {correctionAction === 'add_missing_in' ? 'IN vaqti' : 'OUT vaqti'}
                </label>
                <input
                  type="datetime-local"
                  value={correctionTimestamp}
                  onChange={(event) => setCorrectionTimestamp(event.target.value)}
                  className="field"
                />
              </div>
            )}
            {correctionAction === 'edit_event_time' && (
              <div>
                <label className="field-label">Yangi vaqt</label>
                <input
                  type="datetime-local"
                  value={correctionTimestamp}
                  onChange={(event) => setCorrectionTimestamp(event.target.value)}
                  className="field"
                />
              </div>
            )}
            <textarea
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              placeholder="Tuzatish sababi (majburiy)"
              rows={3}
              className="field"
            />
            {correctionSuccess && (
              <p className="alert alert-success">{correctionSuccess}</p>
            )}
            {correctionError && (
              <p className="alert alert-error">{correctionError}</p>
            )}
            {usersQuery.error && (
              <p className="alert alert-warning">
                Xodimlar ro&apos;yxatini yuklashda xatolik: {usersQuery.error.message}
              </p>
            )}
            <div className="border-t border-gray-100 pt-4">
              <button
                type="submit"
                disabled={correctionMutation.isLoading}
                className="btn btn-primary w-full"
              >
                <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                {correctionMutation.isLoading ? 'Saqlanmoqda...' : 'Tuzatishni saqlash'}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
