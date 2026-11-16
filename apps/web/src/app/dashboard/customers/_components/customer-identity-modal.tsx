'use client';

import { normalizeDigits } from '@dashboarduz/shared';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerIdentityModal({ vm }: { vm: CustomersPageModel }) {
  const { handleUpdateCustomerIdentity, identityCustomerName, identityCustomerNumber, isAdmin, isIdentityModalOpen, resetIdentityModal, setIdentityCustomerName, setIdentityCustomerNumber, setIsIdentityModalOpen, updateCustomerIdentityMutation } = vm;

  return (
    <>
      {isAdmin && isIdentityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz ma&apos;lumotini o&apos;zgartirish</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                Bu o&apos;zgarish Tushum, Mijozlar va Kurslar sotuvi bo&apos;limlarida ham aks etadi.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami</label>
                <input
                  value={identityCustomerNumber}
                  onChange={(event) => setIdentityCustomerNumber(normalizeDigits(event.target.value))}
                  placeholder="Faqat raqam"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi</label>
                <input
                  value={identityCustomerName}
                  onChange={(event) => setIdentityCustomerName(event.target.value)}
                  placeholder="Ism familya"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setIsIdentityModalOpen(false);
                  resetIdentityModal();
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleUpdateCustomerIdentity}
                disabled={updateCustomerIdentityMutation.isLoading}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {updateCustomerIdentityMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
