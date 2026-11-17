'use client';

import type { Dispatch, SetStateAction } from 'react';
import { roleNeedsManagerMapping } from '@dashboarduz/shared';
import { IconDeviceFloppy, IconKey, IconUserCog } from '@tabler/icons-react';
import { availableRoles, roleLabels } from './user-roles';
import type { UserRole } from './user-roles';
import { SheetGroup, UsersSheet } from './users-sheet';

type Drafts = Record<string, string>;
type SetDrafts = Dispatch<SetStateAction<Drafts>>;

type Props = {
  user: any;
  onClose: () => void;
  error: string | null;
  success: string | null;
  generatedPassword: string | null;
  nameDrafts: Drafts;
  setNameDrafts: SetDrafts;
  phoneDrafts: Drafts;
  setPhoneDrafts: SetDrafts;
  loginDrafts: Drafts;
  setLoginDrafts: SetDrafts;
  passwordDrafts: Drafts;
  setPasswordDrafts: SetDrafts;
  roleDrafts: Record<string, UserRole>;
  setRoleDrafts: Dispatch<SetStateAction<Record<string, UserRole>>>;
  managerDrafts: Drafts;
  setManagerDrafts: SetDrafts;
  utelDrafts: Drafts;
  setUtelDrafts: SetDrafts;
  telegramDrafts: Drafts;
  setTelegramDrafts: SetDrafts;
  amocrmManagers: any[];
  utelManagers: any[];
  telegramRecipients: any[];
  isSavingName: boolean;
  onSaveName: (userId: string) => void;
  onGeneratePassword: (userId: string) => void;
  onSaveCredentials: (userId: string) => void;
  onSaveRole: (userId: string) => void;
};

export function UserEditSheet(props: Props) {
  const {
    user,
    onClose,
    error,
    success,
    generatedPassword,
    nameDrafts,
    setNameDrafts,
    phoneDrafts,
    setPhoneDrafts,
    loginDrafts,
    setLoginDrafts,
    passwordDrafts,
    setPasswordDrafts,
    roleDrafts,
    setRoleDrafts,
    managerDrafts,
    setManagerDrafts,
    utelDrafts,
    setUtelDrafts,
    telegramDrafts,
    setTelegramDrafts,
    amocrmManagers,
    utelManagers,
    telegramRecipients,
    isSavingName,
    onSaveName,
    onGeneratePassword,
    onSaveCredentials,
    onSaveRole,
  } = props;
  const needsMapping = roleNeedsManagerMapping(roleDrafts[user.id] || 'Agent');

  return (
    <UsersSheet
      title={user.name || user.username || user.id}
      description={`ID: ${user.id}`}
      icon={IconUserCog}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Yopish
        </button>
      }
    >
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}

      <SheetGroup caption="Foydalanuvchi">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={nameDrafts[user.id] || ''}
            onChange={(event) => setNameDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
            placeholder="Foydalanuvchi ismi"
            className="field min-w-0"
          />
          <input
            value={phoneDrafts[user.id] || ''}
            onChange={(event) => setPhoneDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
            placeholder="Telefon raqam"
            className="field min-w-0"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onSaveName(user.id)}
            disabled={isSavingName}
            className="btn btn-secondary btn-sm"
          >
            <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
            {isSavingName ? 'Saqlanmoqda...' : "Ism/telefonni saqlash"}
          </button>
        </div>
      </SheetGroup>

      <div className="border-t border-gray-100" />

      <SheetGroup caption="Login/Parol">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={loginDrafts[user.id] || ''}
            onChange={(event) => setLoginDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
            placeholder="Login"
            className="field min-w-0"
          />
          <input
            type="password"
            value={passwordDrafts[user.id] || ''}
            onChange={(event) => setPasswordDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
            placeholder="Yangi parol"
            className="field min-w-0"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => onGeneratePassword(user.id)} className="btn btn-soft btn-sm">
            <IconKey className="h-4 w-4" stroke={1.8} />
            Yaratish
          </button>
          <button type="button" onClick={() => onSaveCredentials(user.id)} className="btn btn-secondary btn-sm">
            Saqlash
          </button>
        </div>
        {generatedPassword && (
          <p className="alert alert-success px-3 py-2 text-xs">
            Yangi yaratilgan parol: <strong>{generatedPassword}</strong>
          </p>
        )}
      </SheetGroup>

      <div className="border-t border-gray-100" />

      <SheetGroup caption="Rol + CRM/UTeL/Telegram">
        <select
          value={roleDrafts[user.id] || 'Agent'}
          onChange={(event) => setRoleDrafts((prev) => ({ ...prev, [user.id]: event.target.value as UserRole }))}
          className="field min-w-0"
        >
          {availableRoles.map((role) => (
            <option key={role} value={role}>
              {roleLabels[role]}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            value={managerDrafts[user.id] || ''}
            onChange={(event) => setManagerDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
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
          <select
            value={utelDrafts[user.id] || ''}
            onChange={(event) => setUtelDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
            disabled={!needsMapping}
            className="field min-w-0"
          >
            <option value="">{needsMapping ? 'UTeL menejerini tanlang' : 'Bu rol uchun shart emas'}</option>
            {utelManagers.map((manager: any) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </div>
        <select
          value={telegramDrafts[user.id] || ''}
          onChange={(event) => setTelegramDrafts((prev) => ({ ...prev, [user.id]: event.target.value }))}
          className="field min-w-0"
        >
          <option value="">Telegram (ixtiyoriy)</option>
          {telegramRecipients.map((recipient: any) => (
            <option key={recipient.id} value={recipient.id}>
              {recipient.name}{recipient.username ? ` (@${recipient.username})` : ''}
            </option>
          ))}
        </select>
        <div className="flex justify-end">
          <button type="button" onClick={() => onSaveRole(user.id)} className="btn btn-secondary btn-sm">
            <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
            Saqlash
          </button>
        </div>
      </SheetGroup>
    </UsersSheet>
  );
}
