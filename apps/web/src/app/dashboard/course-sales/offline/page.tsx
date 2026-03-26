'use client';

import CourseTypeSalesView from '@/components/dashboard/course-sales/category-sales-view';

export default function OfflineCourseSalesPage() {
  return (
    <CourseTypeSalesView
      category="offline"
      title="Oflayn sotuvi"
      description="Oflayn kurslari bo'yicha joriy sotuvlar, to'lov va qarzdorlik holati."
    />
  );
}
