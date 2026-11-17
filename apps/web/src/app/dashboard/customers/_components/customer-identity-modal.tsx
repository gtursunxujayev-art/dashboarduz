'use client';

import { IconId } from '@tabler/icons-react';
import { normalizeDigits } from '@dashboarduz/shared';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerIdentityModal({ vm }: { vm: CustomersPageModel }) {
  const { handleUpdateCustomerIdentity, identityCustomerName, identityCustomerNumber, isAdmin, isIdentityModalOpen, resetIdentityModal, setIdentityCustomerName, setIdentityCustomerNumber, setIsIdentityModalOpen, updateCustomerIdentityMutation } = vm;

  return (
    <>
      {isAdmin && isIdentityModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-md">
            <div className="modal-header">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                  <IconId className="h-5 w-5" stroke={1.6} />
                </span>
                <div className="min-w-0">
                  <h2 className="modal-title">Mijoz ma&apos;lumotini o&apos;zgartirish</h2>
                </div>
              </div>
            </div>

            <div className="modal-body">
              <p className="alert alert-info">
                Bu o&apos;zgarish Tushum, Mijozlar va Kurslar sotuvi bo&apos;limlarida ham aks etadi.
              </p>
              <div>
                <label className="field-label">Mijoz raqami</label>
                <input
                  value={identityCustomerNumber}
                  onChange={(event) => setIdentityCustomerNumber(normalizeDigits(event.target.value))}
                  placeholder="Faqat raqam"
                  className="field tabular"
                />
              </div>
              <div>
                <label className="field-label">Mijoz ismi</label>
                <input
                  value={identityCustomerName}
                  onChange={(event) => setIdentityCustomerName(event.target.value)}
                  placeholder="Ism familya"
                  className="field"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={() => {
                  setIsIdentityModalOpen(false);
                  resetIdentityModal();
                }}
                className="btn btn-secondary"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleUpdateCustomerIdentity}
                disabled={updateCustomerIdentityMutation.isLoading}
                className="btn btn-primary"
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
