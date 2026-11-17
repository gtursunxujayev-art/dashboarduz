'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Option = {
  id: string;
  label: string;
  description?: string;
};

interface MultiSelectDropdownProps {
  label: string;
  options: Option[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  /** Keeps the label for screen readers only, for toolbars where the placeholder says enough. */
  hideLabel?: boolean;
}

export default function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onChange,
  placeholder = 'Qiymatlarni tanlang',
  disabled = false,
  loading = false,
  loadingText = 'Variantlar yuklanmoqda...',
  emptyText = 'Variantlar topilmadi.',
  hideLabel = false,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedLabels = useMemo(() => {
    const selected = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.label);
    return selected.length > 0 ? selected.join(', ') : placeholder;
  }, [options, placeholder, selectedIds]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  return (
    <div ref={containerRef}>
      <label className={hideLabel ? 'sr-only' : 'block text-[13px] font-medium text-gray-500'}>{label}</label>
      <div className={hideLabel ? 'relative' : 'relative mt-1'}>
        <button
          type="button"
          onClick={() => {
            if (disabled) {
              return;
            }
            setIsOpen((value) => !value);
          }}
          aria-expanded={isOpen}
          aria-label={hideLabel ? label : undefined}
          className={`w-full text-left text-sm ${hideLabel ? 'h-10 rounded-full px-4 shadow' : 'h-10 rounded-[12px] border border-gray-200 px-3.5'} ${disabled ? 'bg-gray-50 text-gray-500' : `cursor-pointer bg-white text-gray-900 ${hideLabel ? 'hover:bg-gray-50' : 'hover:border-gray-300'}`}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{selectedLabels}</span>
            <span className="text-xs text-gray-500">{selectedIds.length} ta tanlandi</span>
          </div>
        </button>

        {!disabled && isOpen && (
          <div
            className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-[16px] bg-white p-2 text-gray-900 shadow-lg"
          >
            {loading ? (
              <p className="px-2 py-2 text-sm text-gray-500">{loadingText}</p>
            ) : options.length === 0 ? (
              <p className="px-2 py-2 text-sm text-gray-500">{emptyText}</p>
            ) : (
              <div className="space-y-1">
                {options.map((option) => (
                  <label key={option.id} className="flex items-start gap-3 rounded-[10px] px-2 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(option.id)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          onChange(Array.from(new Set([...selectedIds, option.id])));
                          return;
                        }
                        onChange(selectedIds.filter((id) => id !== option.id));
                      }}
                      className="checkbox mt-1"
                    />
                    <div className="min-w-0">
                      <p className="truncate">{option.label}</p>
                      {option.description && (
                        <p className="text-xs text-gray-500">{option.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
