'use client';

import { CourseCustomersTable, CustomersPanel } from '../course-sales-kit';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesCustomers({ vm }: { vm: CategorySalesViewModel }) {
  const { customers, customersQuery, exportFilteredList, isAdmin, isTashkiliyOnly, openCourseEditorModal, pagination, setPage } = vm;

  return (
    <CustomersPanel
      title="Mijozlar ro'yxati"
      exportLabel="Filtrlangan ro'yxatni yuklab olish"
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
  );
}
