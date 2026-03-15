'use client';

import { useMemo } from 'react';

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
}

export default function MultiSelectDropdown({
  label,
  options,
  selectedIds,
  onChange,
  placeholder = 'Select values',
  disabled = false,
  loading = false,
  loadingText = 'Loading options...',
  emptyText = 'No options available.',
}: MultiSelectDropdownProps) {
  const selectedLabels = useMemo(() => {
    const selected = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.label);
    return selected.length > 0 ? selected.join(', ') : placeholder;
  }, [options, placeholder, selectedIds]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <details className="relative mt-1">
        <summary
          style={{ backgroundColor: disabled ? '#F3F4F6' : '#FFFFFF', color: disabled ? '#6B7280' : '#111827' }}
          className={`list-none rounded-md border border-gray-300 px-3 py-2 text-sm ${disabled ? '' : 'cursor-pointer'}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">{selectedLabels}</span>
            <span className="text-xs text-gray-500">{selectedIds.length} selected</span>
          </div>
        </summary>

        {!disabled && (
          <div
            style={{ backgroundColor: '#FFFFFF', color: '#111827' }}
            className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 p-2 shadow-lg"
          >
            {loading ? (
              <p className="px-2 py-2 text-sm text-gray-500">{loadingText}</p>
            ) : options.length === 0 ? (
              <p className="px-2 py-2 text-sm text-gray-500">{emptyText}</p>
            ) : (
              <div className="space-y-1">
                {options.map((option) => (
                  <label key={option.id} className="flex items-start gap-3 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50">
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
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
      </details>
    </div>
  );
}
