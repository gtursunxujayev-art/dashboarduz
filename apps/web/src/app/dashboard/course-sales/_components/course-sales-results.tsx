'use client';

import {
  IconAlertCircle,
  IconCash,
  IconFileText,
  IconSchool,
  IconTag,
  IconUsers,
} from '@tabler/icons-react';
import { CourseCustomersTable, CustomersPanel } from '@/components/dashboard/course-sales/course-sales-kit';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { formatSom } from '@/lib/format';
import type { CourseSalesPageModel } from './use-course-sales-page';

function barWidth(part: number, max: number) {
  if (!max || max <= 0) return '0%';
  return `${Math.max(2, Math.round((Math.max(0, part) / max) * 100))}%`;
}

/** A selectable distribution row: name, customer count and a bar against the largest row. */
function DistributionRow({
  label,
  count,
  max,
  active,
  onClick,
}: {
  label: string;
  count: number;
  max: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`w-full rounded-[16px] px-3.5 py-3 text-left ring-1 transition active:scale-[0.99] ${
        active ? 'bg-blue-50 ring-blue-500' : 'ring-transparent hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center justify-between gap-3">
        <span className={`min-w-0 truncate text-sm font-medium ${active ? 'text-blue-700' : 'text-gray-800'}`}>{label}</span>
        <span className="tabular text-base font-semibold text-gray-900">{count}</span>
      </span>
      <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
        <span
          className={`block h-full origin-left animate-grow-x rounded-full ${active ? 'bg-blue-600' : 'bg-gray-400'}`}
          style={{ width: barWidth(count, max) }}
        />
      </span>
    </button>
  );
}

export function CourseSalesResults({ vm }: { vm: CourseSalesPageModel }) {
  const { courseId, customers, customersQuery, exportFilteredList, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, setPage, setSubTariffId, setTariffId, subTariffId, summary, summaryQuery, tariffId } = vm;

  if (!courseId) {
    return (
      <div className="panel p-3 sm:p-4">
        <EmptyState icon={IconSchool} title="Iltimos, avval kursni tanlang." />
      </div>
    );
  }

  const tariffDistribution: any[] = summaryQuery.data?.tariffDistribution || [];
  const subTariffDistribution: any[] = summaryQuery.data?.subTariffDistribution || [];
  const tariffMax = Math.max(0, ...tariffDistribution.map((item: any) => Number(item.customerCount) || 0));
  const subTariffMax = Math.max(0, ...subTariffDistribution.map((item: any) => Number(item.customerCount) || 0));

  return (
    <>
      <div className={`grid grid-cols-1 gap-4 ${isTashkiliyOnly ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
        <StatTile label="Jami mijozlar" value={summary?.currentCustomerCount ?? 0} icon={IconUsers} tone="blue" />

        {!isTashkiliyOnly && (
          <StatTile
            label="Kelishuv summasi"
            value={formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
            icon={IconFileText}
          />
        )}

        {!isTashkiliyOnly && (
          <StatTile
            label="Tushum"
            value={formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
            icon={IconCash}
            tone="green"
          />
        )}

        <StatTile label="Joriy qarz" value={formatSom(summary?.currentDebtAmount)} icon={IconAlertCircle} tone="amber" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <aside className="space-y-4 xl:sticky xl:top-20 xl:order-2 xl:self-start">
          <section className="panel">
            <div className="panel-header">
              <div className="min-w-0">
                <h2 className="section-title">Tariflar taqsimoti</h2>
                <p className="mt-0.5 text-xs text-gray-500">Tanlangan kurs bo&apos;yicha joriy mijozlar soni</p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <IconTag className="h-[18px] w-[18px]" stroke={1.6} />
              </span>
            </div>
            <div className="space-y-1 p-3 sm:p-4">
              {tariffDistribution.map((item: any) => {
                const active = Boolean(tariffId === item.tariffId || item.isSelected);
                return (
                  <DistributionRow
                    key={item.tariffId}
                    label={item.tariffName}
                    count={item.customerCount}
                    max={tariffMax}
                    active={active}
                    onClick={() => setTariffId((current) => (current === item.tariffId ? '' : item.tariffId))}
                  />
                );
              })}
            </div>

            {tariffId && subTariffDistribution.length > 0 && (
              <div className="animate-rise-in border-t border-gray-100">
                <div className="px-5 pt-4 sm:px-6">
                  <h2 className="section-title">Subtariflar taqsimoti</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Tanlangan tarif bo&apos;yicha joriy mijozlar soni</p>
                </div>
                <div className="space-y-1 p-3 sm:p-4">
                  {subTariffDistribution.map((item: any) => {
                    const active = Boolean(subTariffId === item.subTariffId || item.isSelected);
                    return (
                      <DistributionRow
                        key={item.subTariffId}
                        label={item.subTariffName}
                        count={item.customerCount}
                        max={subTariffMax}
                        active={active}
                        onClick={() => setSubTariffId((current) => (current === item.subTariffId ? '' : item.subTariffId))}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </aside>

        <div className="min-w-0 xl:order-1">
          <CustomersPanel
            title={<>Mijozlar ro&apos;yxati</>}
            exportLabel={<>Filtrlangan ro&apos;yxatni yuklab olish</>}
            onExport={exportFilteredList}
            exportDisabled={customers.length === 0}
            isLoading={customersQuery.isLoading}
            isEmpty={customers.length === 0}
            emptyTitle="Tanlangan filtrlar bo'yicha mijoz topilmadi."
            pagination={pagination}
            setPage={setPage}
          >
            <CourseCustomersTable
              customers={customers}
              isAdmin={isAdmin}
              isTashkiliyOnly={isTashkiliyOnly}
              onEdit={openCourseEditorModal}
            />
          </CustomersPanel>
        </div>
      </div>
    </>
  );
}
