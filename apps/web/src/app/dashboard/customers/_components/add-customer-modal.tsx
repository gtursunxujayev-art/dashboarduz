'use client';

import { IconUserPlus } from '@tabler/icons-react';
import { normalizeDigits } from '@dashboarduz/shared';
import { sanitizeTelegram } from './customer-helpers';
import type { CustomersPageModel } from './use-customers-page';

export function AddCustomerModal({ vm }: { vm: CustomersPageModel }) {
  const { createCustomerOnlyMutation, editorCourses, handleCreateCustomerOnly, isAddModalOpen, isAdmin, newCourseId, newCustomerName, newCustomerNumber, newSubTariffId, newSubTariffOptions, newTariffId, newTariffOptions, newTelegram, resetAddModal, setIsAddModalOpen, setNewCourseId, setNewCustomerName, setNewCustomerNumber, setNewSubTariffId, setNewTariffId, setNewTelegram } = vm;

  return (
    <>
      {isAdmin && isAddModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-2xl">
            <div className="modal-header">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                  <IconUserPlus className="h-5 w-5" stroke={1.6} />
                </span>
                <div className="min-w-0">
                  <h2 className="modal-title">Mijoz qo&apos;shish</h2>
                  <p className="modal-description">Daromad qo&apos;shmasdan yangi mijoz yaratish.</p>
                </div>
              </div>
            </div>

            <div className="modal-body space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Mijoz raqami</label>
                  <input
                    value={newCustomerNumber}
                    onChange={(event) => setNewCustomerNumber(normalizeDigits(event.target.value))}
                    placeholder="Faqat raqam"
                    className="field tabular"
                  />
                </div>
                <div>
                  <label className="field-label">Mijoz ismi</label>
                  <input
                    value={newCustomerName}
                    onChange={(event) => setNewCustomerName(event.target.value)}
                    placeholder="Ism familya"
                    className="field"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="field-label">Telegram username</label>
                  <input
                    value={newTelegram}
                    onChange={(event) => setNewTelegram(sanitizeTelegram(event.target.value))}
                    placeholder="@username"
                    className="field"
                  />
                </div>
              </div>

              <div className="panel-inset">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="field-label">Kurs</label>
                    <select
                      value={newCourseId}
                      onChange={(event) => setNewCourseId(event.target.value)}
                      className="field"
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
                    <label className="field-label">Tarif</label>
                    <select
                      value={newTariffId}
                      onChange={(event) => setNewTariffId(event.target.value)}
                      disabled={!newCourseId}
                      className="field"
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
                    <label className="field-label">Subtarif</label>
                    <select
                      value={newSubTariffId}
                      onChange={(event) => setNewSubTariffId(event.target.value)}
                      disabled={!newTariffId || newSubTariffOptions.length === 0}
                      className="field"
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
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  resetAddModal();
                }}
                className="btn btn-secondary"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleCreateCustomerOnly}
                disabled={createCustomerOnlyMutation.isLoading}
                className="btn btn-primary"
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
