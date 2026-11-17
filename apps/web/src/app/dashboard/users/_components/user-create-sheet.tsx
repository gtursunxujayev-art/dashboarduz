'use client';

import { roleNeedsManagerMapping } from '@dashboarduz/shared';
import { IconUserPlus } from '@tabler/icons-react';
import { availableRoles, roleLabels } from './user-roles';
import type { UserRole } from './user-roles';
import { SheetGroup, UsersSheet } from './users-sheet';

type Props = {
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: string | null;
  createdCredentials: { login: string; password: string } | null;
  newName: string;
  setNewName: (value: string) => void;
  newPhone: string;
  setNewPhone: (value: string) => void;
  newRole: UserRole;
  setNewRole: (value: UserRole) => void;
  newAmoManagerId: string;
  setNewAmoManagerId: (value: string) => void;
  newTelegramChatId: string;
  setNewTelegramChatId: (value: string) => void;
  amocrmManagers: any[];
  telegramRecipients: any[];
};

export function UserCreateSheet(props: Props) {
  const {
    onClose,
    onSubmit,
    isSubmitting,
    error,
    createdCredentials,
    newName,
    setNewName,
    newPhone,
    setNewPhone,
    newRole,
    setNewRole,
    newAmoManagerId,
    setNewAmoManagerId,
    newTelegramChatId,
    setNewTelegramChatId,
    amocrmManagers,
    telegramRecipients,
  } = props;
  const needsMapping = roleNeedsManagerMapping(newRole);

  return (
    <UsersSheet
      title="Yangi foydalanuvchi"
      icon={IconUserPlus}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Yopish
          </button>
          <button type="button" onClick={onSubmit} disabled={isSubmitting} className="btn btn-primary">
            <IconUserPlus className="h-4 w-4" stroke={1.8} />
            {isSubmitting ? 'Yaratilmoqda...' : "Foydalanuvchi qo'shish"}
          </button>
        </>
      }
    >
      {error && <p className="alert alert-error">{error}</p>}
      {createdCredentials && (
        <p className="alert alert-success">
          Foydalanuvchi yaratildi. Login: <strong>{createdCredentials.login}</strong>, Parol: <strong>{createdCredentials.password}</strong>
        </p>
      )}

      <SheetGroup caption="Foydalanuvchi">
        <div className="grid grid-cols-1 gap-3">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Foydalanuvchi ismi (ixtiyoriy)"
            className="field min-w-0"
          />
          <input
            value={newPhone}
            onChange={(event) => setNewPhone(event.target.value)}
            placeholder="Telefon raqam (ixtiyoriy)"
            className="field min-w-0"
          />
        </div>
      </SheetGroup>

      <div className="border-t border-gray-100" />

      <SheetGroup caption="Rol + CRM/Telegram">
        <select
          value={newRole}
          onChange={(event) => setNewRole(event.target.value as UserRole)}
          className="field min-w-0"
        >
          {availableRoles.map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-1 gap-3">
          <select
            value={newAmoManagerId}
            onChange={(event) => setNewAmoManagerId(event.target.value)}
            disabled={!needsMapping}
            className="field min-w-0"
          >
            <option value="">{needsMapping ? 'AmoCRM menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
            {amocrmManagers.map((manager: any) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </div>
        <select
          value={newTelegramChatId}
          onChange={(event) => setNewTelegramChatId(event.target.value)}
          className="field min-w-0"
        >
          <option value="">Telegram (ixtiyoriy)</option>
          {telegramRecipients.map((recipient: any) => (
            <option key={recipient.id} value={recipient.id}>
              {recipient.name}{recipient.username ? ` (@${recipient.username})` : ''}
            </option>
          ))}
        </select>
      </SheetGroup>
    </UsersSheet>
  );
}
