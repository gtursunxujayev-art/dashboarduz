'use client';

import type { BonusPageModel } from './use-bonus-page';

export function FixedSalarySection({ vm }: { vm: BonusPageModel }) {
  const { agentUsers, fixedSalaryByAgent, handleSaveFixedSalaries, isAdmin, salaryConfigQuery, setFixedSalaryByAgent, updateFixedSalariesMutation } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-semibold text-gray-900">Fiks maosh</h2>
        <p className="mt-1 text-sm text-gray-500">Agentlar bo&apos;yicha fiks maoshni alohida saqlang.</p>
      </div>
      <div className="p-6">
        <form onSubmit={handleSaveFixedSalaries} className="space-y-4">
          <div className="mt-2">
            <p className="mt-1 text-xs text-gray-500">
              Formula: Fiks maosh + KPI + Bonus + Plan Bonus.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              {agentUsers.length ? (
                agentUsers.map((agent) => (
                  <label key={agent.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-2">
                    <span className="truncate text-sm text-gray-800">{agent.label}</span>
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
                      className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    />
                  </label>
                ))
              ) : (
                <p className="text-sm text-gray-500">Agent foydalanuvchilar topilmadi.</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={!isAdmin || updateFixedSalariesMutation.isLoading || salaryConfigQuery.isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {updateFixedSalariesMutation.isLoading ? 'Saqlanmoqda...' : "Fiks maoshni saqlash"}
          </button>
        </form>
      </div>
    </div>
  );
}
