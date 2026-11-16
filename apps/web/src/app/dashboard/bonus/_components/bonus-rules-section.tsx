'use client';

import { type SalaryBonusMode as BonusMode, COURSE_CATEGORIES, type SalaryRuleMode as CourseBonusMode, type CourseCategory as SalaryCategory } from '@dashboarduz/shared';
import { type CourseOverrideState, getSalaryCategoryLabel } from './bonus-helpers';
import type { BonusPageModel } from './use-bonus-page';

export function BonusRulesSection({ vm }: { vm: BonusPageModel }) {
  const { bonusRulesState, courseOverrides, courseSearch, effectiveMonth, handleAddTier, handleRemoveTier, handleRuleModeChange, handleSaveBonusRules, handleSimplePercentChange, handleTierChange, isAdmin, isPastPolicyMonth, policyCourses, policyEditorQuery, salaryBonusMode, salaryConfigQuery, savePolicyVersionMutation, setCourseOverrides, setCourseSearch, setEffectiveMonth, setSalaryBonusMode } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-semibold text-gray-900">Bonus qoidalari</h2>
          <p className="mt-1 text-sm text-gray-500">Simple yoki tiered rejimni har bir kurs turi uchun alohida sozlang.</p>
        </div>
        <div className="p-6">
          <form onSubmit={handleSaveBonusRules} className="space-y-4">
            {isPastPolicyMonth ? <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Bu tarixiy versiya faqat ko&apos;rish uchun.</p> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Bonus hisoblash bazasi</label>
                <select
                  value={salaryBonusMode}
                  onChange={(event) => setSalaryBonusMode(event.target.value as BonusMode)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <option value="on_income">Tushum bo&apos;yicha - har bir to&apos;lovda</option>
                  <option value="on_debt_closed">Sotuv yopilganda - qarz 0 bo&apos;lganda</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Kuchga kirish oyi</label>
                <input
                  type="month"
                  value={effectiveMonth}
                  min={policyEditorQuery.data?.currentMonth}
                  onChange={(event) => setEffectiveMonth(event.target.value)}
                  disabled={!isAdmin}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500">Joriy yoki kelajak oy. O&apos;tgan versiyalar o&apos;zgarmaydi.</p>
                {(policyEditorQuery.data?.versions.length || 0) > 0 ? (
                  <select
                    value={policyEditorQuery.data?.versions.some((version) => version.effectiveMonth === effectiveMonth) ? effectiveMonth : ''}
                    onChange={(event) => event.target.value && setEffectiveMonth(event.target.value)}
                    className="mt-2 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700"
                  >
                    <option value="">Saqlangan versiyalar</option>
                    {policyEditorQuery.data?.versions.filter((version) => version.effectiveMonth !== '1970-01').map((version) => (
                      <option key={version.id} value={version.effectiveMonth}>{version.effectiveMonth}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            {COURSE_CATEGORIES.map((category) => {
              const rule = bonusRulesState[category];
              if (!rule) return null;
              return (
                <div key={category} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{getSalaryCategoryLabel(category)}</p>
                      <p className="mt-1 text-xs text-gray-500">Bonus qoidasi</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Rejim</label>
                      <select
                        value={rule.mode}
                        onChange={(event) => handleRuleModeChange(category, event.target.value as CourseBonusMode)}
                        disabled={!isAdmin}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                      >
                        <option value="simple">Simple</option>
                        <option value="tiered">Tiered</option>
                      </select>
                    </div>
                    {rule.mode === 'simple' ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Foiz (%)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Simple foiz (fallback)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                        />
                      </div>
                    )}
                  </div>

                  {rule.mode === 'tiered' && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs text-gray-500">
                        Tier diapazonlari inclusive ishlaydi: masalan, <span className="font-medium">1-3</span> bo&apos;lsa 1, 2 va 3 ham kiradi.
                      </p>
                      {rule.tiers.map((tier, tierIndex) => (
                        <div key={`${category}-tier-${tierIndex}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                          <input
                            value={tier.minSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'minSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Boshlanish (min)"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <input
                            value={tier.maxSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'maxSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Tugash (max), bo'sh=ochiq"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <input
                            value={tier.percent}
                            onChange={(event) => handleTierChange(category, tierIndex, 'percent', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="decimal"
                            placeholder="Foiz (%)"
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddTier(category)}
                              disabled={!isAdmin}
                              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTier(category, tierIndex)}
                              disabled={!isAdmin}
                              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              -
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="rounded-md border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Kurs bo&apos;yicha oylik jamoa bonusi</h3>
                  <p className="mt-1 text-xs text-gray-500">Yoqilmagan kurslar kategoriya qoidasini meros oladi. Tier summalari UZS.</p>
                </div>
                <input
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="Kurs qidirish"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm md:w-72"
                />
              </div>
              <div className="mt-4 space-y-3">
                {policyCourses.map((course) => {
                  const state = courseOverrides[course.id] || { enabled: false, fallbackPercent: '0', tiers: [{ minAmount: '0', maxAmount: '', percent: '' }] };
                  const updateState = (next: CourseOverrideState) => setCourseOverrides((current) => ({ ...current, [course.id]: next }));
                  return (
                    <div key={course.id} className={`rounded-md border p-4 ${course.isActive ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50/40'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-900">{course.name}</p>
                          <p className="text-xs text-gray-500">{getSalaryCategoryLabel(course.category as SalaryCategory)}{course.isActive ? '' : ' · Nofaol'}</p>
                        </div>
                        <select
                          value={state.enabled ? 'monthly_team_income_tiered' : 'inherit'}
                          onChange={(event) => updateState({ ...state, enabled: event.target.value !== 'inherit' })}
                          disabled={!isAdmin}
                          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="inherit">Kategoriya qoidasini meros olish</option>
                          <option value="monthly_team_income_tiered">Oylik jamoa tushumi tierlari</option>
                        </select>
                      </div>
                      {state.enabled ? (
                        <div className="mt-4 space-y-2">
                          <label className="block max-w-xs text-xs font-medium text-gray-600">
                            Fallback foiz
                            <input
                              value={state.fallbackPercent}
                              onChange={(event) => updateState({ ...state, fallbackPercent: event.target.value })}
                              disabled={!isAdmin}
                              inputMode="decimal"
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                            />
                          </label>
                          {state.tiers.map((tier, index) => (
                            <div key={`${course.id}-amount-tier-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                              <input
                                value={tier.minAmount}
                                onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, minAmount: event.target.value.replace(/[^\d]/g, '') } : row) })}
                                placeholder="Min UZS"
                                inputMode="numeric"
                                disabled={!isAdmin}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                              <input
                                value={tier.maxAmount}
                                onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, maxAmount: event.target.value.replace(/[^\d]/g, '') } : row) })}
                                placeholder="Max UZS (oxirgisi bo'sh)"
                                inputMode="numeric"
                                disabled={!isAdmin}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                              <input
                                value={tier.percent}
                                onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, percent: event.target.value } : row) })}
                                placeholder="Foiz"
                                inputMode="decimal"
                                disabled={!isAdmin}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                              />
                              <div className="flex gap-2">
                                <button type="button" onClick={() => updateState({ ...state, tiers: [...state.tiers, { minAmount: '', maxAmount: '', percent: '' }] })} disabled={!isAdmin} className="rounded-md border px-3 py-2">+</button>
                                <button type="button" onClick={() => updateState({ ...state, tiers: state.tiers.length > 1 ? state.tiers.filter((_, rowIndex) => rowIndex !== index) : state.tiers })} disabled={!isAdmin} className="rounded-md border border-red-300 px-3 py-2 text-red-700">-</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={!isAdmin || isPastPolicyMonth || savePolicyVersionMutation.isLoading || salaryConfigQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savePolicyVersionMutation.isLoading ? 'Saqlanmoqda...' : "Bonus qoidalarini saqlash"}
            </button>
          </form>
        </div>
      </div>
  );
}
