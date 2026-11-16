'use client';

import { normalizeDigits } from '@dashboarduz/shared';
import { sanitizeTelegram } from './customer-helpers';
import type { CustomersPageModel } from './use-customers-page';

export function AddCustomerModal({ vm }: { vm: CustomersPageModel }) {
  const { createCustomerOnlyMutation, editorCourses, handleCreateCustomerOnly, isAddModalOpen, isAdmin, newCourseId, newCustomerName, newCustomerNumber, newSubTariffId, newSubTariffOptions, newTariffId, newTariffOptions, newTelegram, resetAddModal, setIsAddModalOpen, setNewCourseId, setNewCustomerName, setNewCustomerNumber, setNewSubTariffId, setNewTariffId, setNewTelegram } = vm;

  return (
    <>
      {isAdmin && isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz qo&apos;shish</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Daromad qo&apos;shmasdan yangi mijoz yaratish.</p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami</label>
                  <input
                    value={newCustomerNumber}
                    onChange={(event) => setNewCustomerNumber(normalizeDigits(event.target.value))}
                    placeholder="Faqat raqam"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi</label>
                  <input
                    value={newCustomerName}
                    onChange={(event) => setNewCustomerName(event.target.value)}
                    placeholder="Ism familya"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Telegram username</label>
                <input
                  value={newTelegram}
                  onChange={(event) => setNewTelegram(sanitizeTelegram(event.target.value))}
                  placeholder="@username"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs</label>
                  <select
                    value={newCourseId}
                    onChange={(event) => setNewCourseId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Tanlanmagan</option>
                    {editorCourses.map((course: any) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tarif</label>
                  <select
                    value={newTariffId}
                    onChange={(event) => setNewTariffId(event.target.value)}
                    disabled={!newCourseId}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  >
                    <option value="">Tanlanmagan</option>
                    {newTariffOptions.map((tariff: any) => (
                      <option key={tariff.id} value={tariff.id}>
                        {tariff.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif</label>
                  <select
                    value={newSubTariffId}
                    onChange={(event) => setNewSubTariffId(event.target.value)}
                    disabled={!newTariffId || newSubTariffOptions.length === 0}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  >
                    <option value="">Tanlanmagan</option>
                    {newSubTariffOptions.map((subTariff: any) => (
                      <option key={subTariff.id} value={subTariff.id}>
                        {subTariff.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  resetAddModal();
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleCreateCustomerOnly}
                disabled={createCustomerOnlyMutation.isLoading}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCustomerOnlyMutation.isLoading ? "Qo'shilmoqda..." : "Qo'shish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
