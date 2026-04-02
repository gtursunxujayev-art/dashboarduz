'use client';

import { useRef, ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type VirtualTableProps<T> = {
  rows: T[];
  estimateRowHeight?: number;
  headerContent: ReactNode;
  /** Should return <td> elements (NOT wrapped in <tr>) */
  renderRowCells: (row: T, index: number) => ReactNode;
  getRowKey: (row: T, index: number) => string | number;
  tableClassName?: string;
  containerClassName?: string;
  /** Minimum row count before virtualization kicks in. Default 30. */
  virtualizeThreshold?: number;
};

export default function VirtualTable<T>({
  rows,
  estimateRowHeight = 40,
  headerContent,
  renderRowCells,
  getRowKey,
  tableClassName = 'min-w-full divide-y divide-gray-200',
  containerClassName = '',
  virtualizeThreshold = 30,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Fall back to a plain table for small data sets
  if (rows.length < virtualizeThreshold) {
    return (
      <div className={containerClassName}>
        <table className={tableClassName}>
          <thead className="bg-gray-50">{headerContent}</thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map((row, i) => (
              <tr key={getRowKey(row, i)}>{renderRowCells(row, i)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <VirtualizedInner {...{ rows, estimateRowHeight, headerContent, renderRowCells, getRowKey, tableClassName, containerClassName, parentRef }} />;
}

function VirtualizedInner<T>({
  rows,
  estimateRowHeight,
  headerContent,
  renderRowCells,
  getRowKey,
  tableClassName,
  containerClassName,
  parentRef,
}: {
  rows: T[];
  estimateRowHeight: number;
  headerContent: ReactNode;
  renderRowCells: (row: T, index: number) => ReactNode;
  getRowKey: (row: T, index: number) => string | number;
  tableClassName: string;
  containerClassName: string;
  parentRef: React.RefObject<HTMLDivElement>;
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 10,
  });

  return (
    <div
      ref={parentRef}
      className={containerClassName}
      style={{ maxHeight: '70vh', overflow: 'auto' }}
    >
      <table className={tableClassName} style={{ tableLayout: 'fixed' }}>
        <thead className="bg-gray-50 sticky top-0 z-10">{headerContent}</thead>
        <tbody className="bg-white">
          <tr style={{ height: `${virtualizer.getTotalSize()}px`, visibility: 'hidden' }}>
            <td />
          </tr>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            return (
              <tr
                key={getRowKey(row, virtualRow.index)}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: `${virtualRow.start}px`,
                  left: 0,
                  width: '100%',
                  display: 'table-row',
                }}
              >
                {renderRowCells(row, virtualRow.index)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
