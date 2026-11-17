'use client';

import { PageHeader } from '@/components/ui/page-header';
import { CategoryCourseEditorModal } from './category-course-editor-modal';
import { CategorySalesCustomers } from './category-sales-customers';
import { CategorySalesFilters } from './category-sales-filters';
import { CATEGORY_LABELS, type CourseTypeSalesViewProps } from './category-sales-helpers';
import { CategorySalesSummary } from './category-sales-summary';
import { useCategorySalesView } from './use-category-sales-view';

export default function CourseTypeSalesView(props: CourseTypeSalesViewProps) {
  const vm = useCategorySalesView(props);
  const { actionError, actionSuccess, category, description, summaryQuery, title } = vm;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title || `${CATEGORY_LABELS[category]} sotuvi`}
        description={description || `${CATEGORY_LABELS[category]} turidagi kurslar bo'yicha joriy mijozlar va sotuv ko'rsatkichlari.`}
      />

      <CategorySalesFilters vm={vm} />

      {summaryQuery.error && (
        <div className="alert alert-error">
          {summaryQuery.error.message || "Ma'lumotlarni yuklashda xatolik."}
        </div>
      )}

      {actionError && (
        <div className="alert alert-error">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="alert alert-success">
          {actionSuccess}
        </div>
      )}

      <CategorySalesSummary vm={vm} />

      <CategorySalesCustomers vm={vm} />

      <CategoryCourseEditorModal vm={vm} />
    </div>
  );
}
