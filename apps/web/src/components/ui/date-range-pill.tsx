'use client';

import { useEffect, useRef, useState } from 'react';
import { IconCalendar, IconChevronDown } from '@tabler/icons-react';

type Props = {
  label: string;
  active: boolean;
  dateFrom: string;
  dateTo: string;
  onApply: (bounds: { dateFrom: string; dateTo: string }) => void;
};

/** The date pill of the dashboard filter bar. Shows the covered days; opens a picker for a custom range. */
export function DateRangePill({ label, active, dateFrom, dateTo, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(dateFrom);
  const [draftTo, setDraftTo] = useState(dateTo);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraftFrom(dateFrom);
    setDraftTo(dateTo);
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, dateFrom, dateTo]);

  const invalid = !draftFrom || !draftTo || draftTo < draftFrom;
  const inputClass = 'mt-1.5 h-10 w-full rounded-[12px] border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex h-10 items-center gap-2.5 whitespace-nowrap rounded-full bg-white px-4 text-sm font-medium shadow active:scale-[0.99] ${
          active ? 'text-blue-700 ring-2 ring-inset ring-blue-500/60 dark:text-blue-300' : 'text-gray-800 hover:bg-gray-50'
        }`}
      >
        <IconCalendar className="h-[18px] w-[18px] text-gray-500" stroke={1.6} />
        <span className="tabular">{label}</span>
        <IconChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} stroke={1.6} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Ixtiyoriy davr"
          className="absolute left-0 top-full z-40 mt-2 w-[300px] animate-rise-in rounded-[20px] bg-white p-4 shadow-xl"
        >
          <p className="text-sm font-semibold text-gray-900">Ixtiyoriy davr</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-[13px] font-medium text-gray-500">
              Boshlanish
              <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => setDraftFrom(event.target.value)} className={inputClass} />
            </label>
            <label className="block text-[13px] font-medium text-gray-500">
              Tugash
              <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => setDraftTo(event.target.value)} className={inputClass} />
            </label>
          </div>
          {draftFrom && draftTo && draftTo < draftFrom ? (
            <p className="mt-2 text-xs text-red-600">Tugash sanasi boshlanishdan oldin bo&apos;lmasin.</p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-sm btn-ghost h-9"
            >
              Bekor qilish
            </button>
            <button
              type="button"
              disabled={invalid}
              onClick={() => {
                onApply({ dateFrom: draftFrom, dateTo: draftTo });
                setOpen(false);
              }}
              className="btn btn-sm btn-primary h-9 px-4"
            >
              Qo&apos;llash
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
