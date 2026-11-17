'use client';

import { PageHeader } from '@/components/ui/page-header';
import { ActionMessages, isCustomerCourseSheetOpen } from '../course-sales-kit';
import { CategoryCourseEditorModal } from './category-course-editor-modal';
import { CategorySalesCustomers } from './category-sales-customers';
import { CategorySalesFilters } from './category-sales-filters';
import { CATEGORY_LABELS, type CourseTypeSalesViewProps } from './category-sales-helpers';
import { CategorySalesSummary, CategoryTariffPanel } from './category-sales-summary';
import { useCategorySalesView } from './use-category-sales-view';

export default function CourseTypeSalesView(props: CourseTypeSalesViewProps) {
  const vm = useCategorySalesView(props);
  const { actionError, actionSuccess, category, description, summaryQuery, title } = vm;
  const sheetOpen = isCustomerCourseSheetOpen(vm);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title || `${CATEGORY_LABELS[category]} sotuvi`}
        description={description || `${CATEGORY_LABELS[category]} turidagi kurslar bo'yicha joriy mijozlar va sotuv ko'rsatkichlari.`}
      >
        <CategorySalesFilters vm={vm} />
      </PageHeader>

      {summaryQuery.error && (
        <div className="alert alert-error">
          {summaryQuery.error.message || "Ma'lumotlarni yuklashda xatolik."}
        </div>
      )}

      {!sheetOpen && <ActionMessages actionError={actionError} actionSuccess={actionSuccess} />}

      {/* Number tiles with the Tariflar panel beside them; the panel takes the tiles' height and scrolls. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <CategorySalesSummary vm={vm} />
        <div className="min-h-0 xl:relative">
          <CategoryTariffPanel vm={vm} />
        </div>
      </div>

      <div className="min-w-0">
        <CategorySalesCustomers vm={vm} />
      </div>

      <CategoryCourseEditorModal vm={vm} />
    </div>
  );
}
