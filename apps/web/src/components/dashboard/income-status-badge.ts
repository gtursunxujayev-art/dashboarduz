/**
 * Label and Tailwind classes for an income's lifecycle status.
 * The adjustments page also styles dark mode; the finance page does not (yet).
 */
export function getIncomeStatusBadge(status: string, options: { darkMode: boolean }): { label: string; className: string } {
  if (status === 'pending_refund') {
    return {
      label: "Sariq: Qaytarish so'rovi",
      className: `bg-yellow-100 text-yellow-800${options.darkMode ? ' dark:bg-yellow-900/40 dark:text-yellow-200' : ''}`,
    };
  }
  if (status === 'refunded') {
    return {
      label: 'Qizil: Qaytarilgan',
      className: `bg-red-100 text-red-800${options.darkMode ? ' dark:bg-red-900/40 dark:text-red-200' : ''}`,
    };
  }
  return {
    label: 'Aktiv',
    className: `bg-emerald-100 text-emerald-800${options.darkMode ? ' dark:bg-emerald-900/40 dark:text-emerald-200' : ''}`,
  };
}
