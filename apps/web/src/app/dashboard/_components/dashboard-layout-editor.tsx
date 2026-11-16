'use client';

import type { DashboardPageModel } from './use-dashboard-page';

export function DashboardLayoutEditor({ vm }: { vm: DashboardPageModel }) {
  const { addCustomSalesWidget, allDashboardCards, availableSubTariffs, customSalesWidgets, effectiveVisibleWidgetSet, isEditMode, newWidgetCourseId, newWidgetSubTariffId, newWidgetTariffId, newWidgetTitle, removeCustomSalesWidget, restoreLayoutFromServer, saveDashboardLayout, saveDashboardLayoutMutation, selectedWidgetCourse, setNewWidgetCourseId, setNewWidgetSubTariffId, setNewWidgetTariffId, setNewWidgetTitle, toggleWidgetVisibility, widgetCourses } = vm;

  return (
    <>
      {isEditMode && (
        <div className="rounded-lg bg-white shadow">
          <div className="space-y-4 px-4 py-4 sm:px-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Kartalarni ko'rsatish/yashirish</h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {allDashboardCards.map((card) => (
                  <label key={`toggle-${card.id}`} className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={effectiveVisibleWidgetSet.has(card.id)}
                      onChange={() => toggleWidgetVisibility(card.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-gray-800">{card.title}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-gray-200 p-3">
              <h4 className="text-sm font-semibold text-gray-900">Maxsus sotuv kartasi qo'shish</h4>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                <input
                  type="text"
                  value={newWidgetTitle}
                  onChange={(event) => setNewWidgetTitle(event.target.value)}
                  placeholder="Karta nomi (ixtiyoriy)"
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  value={newWidgetCourseId}
                  onChange={(event) => {
                    setNewWidgetCourseId(event.target.value);
                    setNewWidgetTariffId('');
                    setNewWidgetSubTariffId('');
                  }}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Kurs tanlang</option>
                  {widgetCourses.map((course: any) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
                <select
                  value={newWidgetTariffId}
                  onChange={(event) => {
                    setNewWidgetTariffId(event.target.value);
                    setNewWidgetSubTariffId('');
                  }}
                  disabled={!selectedWidgetCourse}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Barcha tariflar</option>
                  {(selectedWidgetCourse?.tariffs || []).map((tariff: any) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                  ))}
                </select>
                <select
                  value={newWidgetSubTariffId}
                  onChange={(event) => setNewWidgetSubTariffId(event.target.value)}
                  disabled={!selectedWidgetCourse}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Barcha subtariflar</option>
                  {availableSubTariffs.map((subTariff: any) => (
                    <option key={subTariff.id} value={subTariff.id}>{subTariff.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addCustomSalesWidget}
                  disabled={!newWidgetCourseId}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  Qo'shish
                </button>
              </div>

              {customSalesWidgets.length > 0 && (
                <div className="mt-3 space-y-2">
                  {customSalesWidgets.map((widget) => {
                    const widgetId = `custom:${widget.id}`;
                    return (
                      <div key={widget.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2">
                        <label className="flex items-center gap-2 text-sm text-gray-800">
                          <input
                            type="checkbox"
                            checked={effectiveVisibleWidgetSet.has(widgetId)}
                            onChange={() => toggleWidgetVisibility(widgetId)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{widget.title}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeCustomSalesWidget(widget.id)}
                          className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          O'chirish
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveDashboardLayout().catch((err) => { console.error('saveDashboardLayout failed', err); return null; })}
                disabled={saveDashboardLayoutMutation.isPending}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
              >
                {saveDashboardLayoutMutation.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
              <button
                type="button"
                onClick={restoreLayoutFromServer}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Bekor qilish
              </button>
              {saveDashboardLayoutMutation.error && (
                <p className="text-sm text-red-600">{saveDashboardLayoutMutation.error?.message}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
