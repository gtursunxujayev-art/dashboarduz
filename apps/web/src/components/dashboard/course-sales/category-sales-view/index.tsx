'use client';

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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{title || `${CATEGORY_LABELS[category]} sotuvi`}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {description || `${CATEGORY_LABELS[category]} turidagi kurslar bo'yicha joriy mijozlar va sotuv ko'rsatkichlari.`}
        </p>
      </div>

      <CategorySalesFilters vm={vm} />

      {summaryQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {summaryQuery.error.message || "Ma'lumotlarni yuklashda xatolik."}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      <CategorySalesSummary vm={vm} />

      <CategorySalesCustomers vm={vm} />

      <CategoryCourseEditorModal vm={vm} />
    </div>
  );
}
