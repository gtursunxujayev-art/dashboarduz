import { formatCourseBundle } from '@/lib/format';
import { type AdjustmentType, normalizeDigits } from '@dashboarduz/shared';

export type AdjustmentMode = '' | AdjustmentType;

export function formatCardNumberInput(value: string): string {
  const digits = normalizeDigits(value).slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function getRequestTypeLabel(type: string): string {
  return type === 'refund' ? 'Pul qaytarish' : "Tarif o'zgarishi";
}

export function getRequestStatusLabel(status: string): string {
  if (status === 'approved') return 'Tasdiqlangan';
  if (status === 'rejected') return 'Rad etilgan';
  return 'Kutilmoqda';
}

export function getRequestSourceBundle(request: any): string | null {
  if (request.previousCourse || request.previousTariff) {
    return formatCourseBundle(request.previousCourse?.name, request.previousTariff?.name);
  }
  // Approved tariff changes overwrite the income's course, so its current course is not the source.
  if (request.type === 'tariff_change' && request.status === 'approved') {
    return null;
  }
  return formatCourseBundle(request.income.course?.name, request.income.tariff?.name);
}
