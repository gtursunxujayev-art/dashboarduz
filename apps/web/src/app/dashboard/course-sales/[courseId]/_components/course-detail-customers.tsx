'use client';

import {
  CourseCustomersTable,
  CustomersPanel,
  SearchControls,
} from '@/components/dashboard/course-sales/course-sales-kit';
import type { CourseDetailPageModel } from './use-course-detail-page';

/** The "Mijozlar" view: a customer table panel with its own search row. */
export function CourseDetailCustomers({ vm }: { vm: CourseDetailPageModel }) {
  const { applySearch, clearSearch, customers, customersQuery, exportCustomers, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, searchInput, setPage, setSearchInput, tab } = vm;

  if (tab !== 'mijozlar') {
    return null;
  }

  return (
    <div className="animate-fade-in">
      <CustomersPanel
        title="Mijozlar"
        exportLabel="Yuklab olish"
        onExport={exportCustomers}
        exportDisabled={customers.length === 0}
        toolbar={(
          <SearchControls
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            applySearch={applySearch}
            clearSearch={clearSearch}
          />
        )}
        isLoading={customersQuery.isLoading}
        isEmpty={customers.length === 0}
        emptyTitle="Tanlangan filtr bo'yicha mijoz topilmadi."
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
  );
}
