'use client';

import type { CourseTypeSalesViewProps } from './category-sales-helpers';
import { useCategorySalesActions } from './use-category-sales-actions';
import { useCategorySalesState } from './use-category-sales-state';

// All filters, queries and handlers of the category sales view, built by the hooks above in their original order.
export function useCategorySalesView(props: CourseTypeSalesViewProps) {
  return useCategorySalesActions(useCategorySalesState(props));
}

export type CategorySalesViewModel = ReturnType<typeof useCategorySalesView>;
