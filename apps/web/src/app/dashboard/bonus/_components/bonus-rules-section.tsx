'use client';

import { IconCoins, IconSearch } from '@tabler/icons-react';
import { type SalaryBonusMode as BonusMode, COURSE_CATEGORIES, type SalaryRuleMode as CourseBonusMode, type CourseCategory as SalaryCategory } from '@dashboarduz/shared';
import { type CourseOverrideState, getSalaryCategoryLabel } from './bonus-helpers';
import { SettingRow, SettingsCard, SettingsFooter } from './settings-card';
import type { BonusPageModel } from './use-bonus-page';

const RULE_MODES: { value: CourseBonusMode; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'tiered', label: 'Tiered' },
];

export function BonusRulesSection({ vm }: { vm: BonusPageModel }) {
  const { bonusRulesState, courseOverrides, courseSearch, effectiveMonth, handleAddTier, handleRemoveTier, handleRuleModeChange, handleSaveBonusRules, handleSimplePercentChange, handleTierChange, isAdmin, isPastPolicyMonth, policyCourses, policyEditorQuery, salaryBonusMode, salaryConfigQuery, savePolicyVersionMutation, setCourseOverrides, setCourseSearch, setEffectiveMonth, setSalaryBonusMode } = vm;

  return (
    <SettingsCard
      id="bonus-rules"
      icon={IconCoins}
      title="Bonus qoidalari"
      description="Simple yoki tiered rejimni har bir kurs turi uchun alohida sozlang."
    >
      <form onSubmit={handleSaveBonusRules}>
        <div className="panel-body space-y-6">
          {isPastPolicyMonth ? <p className="alert alert-warning">Bu tarixiy versiya faqat ko&apos;rish uchun.</p> : null}

          <div className="divide-y divide-gray-100">
            <SettingRow label={<label>Bonus hisoblash bazasi</label>}>
              <select
                value={salaryBonusMode}
                onChange={(event) => setSalaryBonusMode(event.target.value as BonusMode)}
                disabled={!isAdmin}
                className="field"
              >
                <option value="on_income">Tushum bo&apos;yicha - har bir to&apos;lovda</option>
                <option value="on_debt_closed">Sotuv yopilganda - qarz 0 bo&apos;lganda</option>
              </select>
            </SettingRow>
            <SettingRow
              label={<label>Kuchga kirish oyi</label>}
              help={<>Joriy yoki kelajak oy. O&apos;tgan versiyalar o&apos;zgarmaydi.</>}
            >
              <div className="space-y-2">
                <input
                  type="month"
                  value={effectiveMonth}
                  min={policyEditorQuery.data?.currentMonth}
                  onChange={(event) => setEffectiveMonth(event.target.value)}
                  disabled={!isAdmin}
                  className="field"
                />
                {(policyEditorQuery.data?.versions.length || 0) > 0 ? (
                  <select
                    value={policyEditorQuery.data?.versions.some((version) => version.effectiveMonth === effectiveMonth) ? effectiveMonth : ''}
                    onChange={(event) => event.target.value && setEffectiveMonth(event.target.value)}
                    className="field"
                  >
                    <option value="">Saqlangan versiyalar</option>
                    {policyEditorQuery.data?.versions.filter((version) => version.effectiveMonth !== '1970-01').map((version) => (
                      <option key={version.id} value={version.effectiveMonth}>{version.effectiveMonth}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </SettingRow>
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            {COURSE_CATEGORIES.map((category) => {
              const rule = bonusRulesState[category];
              if (!rule) return null;
              return (
                <div key={category} className="rounded-[12px] border border-gray-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{getSalaryCategoryLabel(category)}</p>
                      <p className="mt-0.5 text-xs text-gray-500">Bonus qoidasi</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-gray-500">Rejim</p>
                      <div className="segmented" role="group" aria-label="Rejim">
                        {RULE_MODES.map((mode) => (
                          <button
                            key={mode.value}
                            type="button"
                            onClick={() => handleRuleModeChange(category, mode.value)}
                            disabled={!isAdmin}
                            aria-pressed={rule.mode === mode.value}
                            className={rule.mode === mode.value ? 'segmented-item segmented-item-active' : 'segmented-item'}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 max-w-xs">
                    {rule.mode === 'simple' ? (
                      <div>
                        <label className="field-label">Foiz (%)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="field tabular"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="field-label">Simple foiz (fallback)</label>
                        <input
                          value={rule.simplePercent}
                          onChange={(event) => handleSimplePercentChange(category, event.target.value)}
                          disabled={!isAdmin}
                          inputMode="decimal"
                          placeholder="0"
                          className="field tabular"
                        />
                      </div>
                    )}
                  </div>

                  {rule.mode === 'tiered' && (
                    <div className="panel-inset mt-4 space-y-2 p-3">
                      <p className="text-xs text-gray-500">
                        Tier diapazonlari inclusive ishlaydi: masalan, <span className="font-medium">1-3</span> bo&apos;lsa 1, 2 va 3 ham kiradi.
                      </p>
                      {rule.tiers.map((tier, tierIndex) => (
                        <div key={`${category}-tier-${tierIndex}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                          <input
                            value={tier.minSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'minSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Boshlanish (min)"
                            className="field tabular"
                          />
                          <input
                            value={tier.maxSales}
                            onChange={(event) => handleTierChange(category, tierIndex, 'maxSales', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="numeric"
                            placeholder="Tugash (max), bo'sh=ochiq"
                            className="field tabular"
                          />
                          <input
                            value={tier.percent}
                            onChange={(event) => handleTierChange(category, tierIndex, 'percent', event.target.value)}
                            disabled={!isAdmin}
                            inputMode="decimal"
                            placeholder="Foiz (%)"
                            className="field tabular"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleAddTier(category)}
                              disabled={!isAdmin}
                              className="btn btn-secondary btn-icon"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveTier(category, tierIndex)}
                              disabled={!isAdmin}
                              className="btn btn-danger-soft btn-icon"
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
          </div>

          <div className="rounded-[12px] border border-gray-200">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Kurs bo&apos;yicha oylik jamoa bonusi</h3>
                <p className="mt-0.5 text-xs text-gray-500">Yoqilmagan kurslar kategoriya qoidasini meros oladi. Tier summalari UZS.</p>
              </div>
              <div className="relative md:w-72">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
                <input
                  value={courseSearch}
                  onChange={(event) => setCourseSearch(event.target.value)}
                  placeholder="Kurs qidirish"
                  className="field pl-9"
                />
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {policyCourses.map((course) => {
                const state = courseOverrides[course.id] || { enabled: false, fallbackPercent: '0', tiers: [{ minAmount: '0', maxAmount: '', percent: '' }] };
                const updateState = (next: CourseOverrideState) => setCourseOverrides((current) => ({ ...current, [course.id]: next }));
                return (
                  <div key={course.id} className={course.isActive ? 'p-4' : 'bg-amber-50/40 p-4'}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{course.name}</p>
                        <p className={course.isActive ? 'text-xs text-gray-500' : 'text-xs text-amber-700'}>{getSalaryCategoryLabel(course.category as SalaryCategory)}{course.isActive ? '' : ' · Nofaol'}</p>
                      </div>
                      <select
                        value={state.enabled ? 'monthly_team_income_tiered' : 'inherit'}
                        onChange={(event) => updateState({ ...state, enabled: event.target.value !== 'inherit' })}
                        disabled={!isAdmin}
                        className="field md:w-72"
                      >
                        <option value="inherit">Kategoriya qoidasini meros olish</option>
                        <option value="monthly_team_income_tiered">Oylik jamoa tushumi tierlari</option>
                      </select>
                    </div>
                    {state.enabled ? (
                      <div className="panel-inset mt-4 space-y-2 p-3">
                        <label className="field-label block max-w-xs">
                          Fallback foiz
                          <input
                            value={state.fallbackPercent}
                            onChange={(event) => updateState({ ...state, fallbackPercent: event.target.value })}
                            disabled={!isAdmin}
                            inputMode="decimal"
                            className="field mt-1.5 tabular"
                          />
                        </label>
                        {state.tiers.map((tier, index) => (
                          <div key={`${course.id}-amount-tier-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                            <input
                              value={tier.minAmount}
                              onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, minAmount: event.target.value.replace(/[^\d]/g, '') } : row) })}
                              placeholder="Min UZS"
                              inputMode="numeric"
                              disabled={!isAdmin}
                              className="field tabular"
                            />
                            <input
                              value={tier.maxAmount}
                              onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, maxAmount: event.target.value.replace(/[^\d]/g, '') } : row) })}
                              placeholder="Max UZS (oxirgisi bo'sh)"
                              inputMode="numeric"
                              disabled={!isAdmin}
                              className="field tabular"
                            />
                            <input
                              value={tier.percent}
                              onChange={(event) => updateState({ ...state, tiers: state.tiers.map((row, rowIndex) => rowIndex === index ? { ...row, percent: event.target.value } : row) })}
                              placeholder="Foiz"
                              inputMode="decimal"
                              disabled={!isAdmin}
                              className="field tabular"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => updateState({ ...state, tiers: [...state.tiers, { minAmount: '', maxAmount: '', percent: '' }] })} disabled={!isAdmin} className="btn btn-secondary btn-icon">+</button>
                              <button type="button" onClick={() => updateState({ ...state, tiers: state.tiers.length > 1 ? state.tiers.filter((_, rowIndex) => rowIndex !== index) : state.tiers })} disabled={!isAdmin} className="btn btn-danger-soft btn-icon">-</button>
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
        </div>

        <SettingsFooter>
          <button
            type="submit"
            disabled={!isAdmin || isPastPolicyMonth || savePolicyVersionMutation.isLoading || salaryConfigQuery.isLoading}
            className="btn btn-primary"
          >
            {savePolicyVersionMutation.isLoading ? 'Saqlanmoqda...' : "Bonus qoidalarini saqlash"}
          </button>
        </SettingsFooter>
      </form>
    </SettingsCard>
  );
}
