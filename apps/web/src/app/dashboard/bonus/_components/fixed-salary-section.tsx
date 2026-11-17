'use client';

import { IconUsers, IconWallet } from '@tabler/icons-react';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { SettingsCard, SettingsFooter } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

export function FixedSalarySection({ vm }: { vm: BonusPageModel }) {
  const { agentUsers, fixedSalaryByAgent, handleSaveFixedSalaries, isAdmin, salaryConfigQuery, setFixedSalaryByAgent, updateFixedSalariesMutation } = vm;

  return (
    <SettingsCard
      id="fixed-salary"
      icon={IconWallet}
      title="Fiks maosh"
      description={<>Agentlar bo&apos;yicha fiks maoshni alohida saqlang.</>}
    >
      <form onSubmit={handleSaveFixedSalaries}>
        <div className="panel-body space-y-4">
          <p className="panel-inset py-2.5 text-xs font-medium text-gray-600">
            Formula: Fiks maosh + KPI + Bonus + Plan Bonus.
          </p>
          {agentUsers.length ? (
            <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
              {agentUsers.map((agent) => (
                <label key={agent.id} className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar name={agent.label} size="sm" />
                    <span className="truncate text-sm font-medium text-gray-800">{agent.label}</span>
                  </span>
                  <input
                    value={fixedSalaryByAgent[agent.id] || ''}
                    onChange={(event) =>
                      setFixedSalaryByAgent((prev) => ({
                        ...prev,
                        [agent.id]: event.target.value.replace(/[^\d]/g, ''),
                      }))
                    }
                    disabled={!isAdmin}
                    inputMode="numeric"
                    placeholder="0"
                    className="field tabular w-36 text-right"
                  />
                </label>
              ))}
            </div>
          ) : (
            <EmptyState icon={IconUsers} title="Agent foydalanuvchilar topilmadi." />
          )}
        </div>

        <SettingsFooter>
          <button
            type="submit"
            disabled={!isAdmin || updateFixedSalariesMutation.isLoading || salaryConfigQuery.isLoading}
            className="btn btn-primary"
          >
            {updateFixedSalariesMutation.isLoading ? 'Saqlanmoqda...' : "Fiks maoshni saqlash"}
          </button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
