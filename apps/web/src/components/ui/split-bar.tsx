/**
 * Proportion bar of two or three real parts (for example Online vs Ofline, plus "Intensiv va
 * boshqa"). The first segment takes the accent, the optional third a lighter accent, and the
 * second the quieter tone.
 */
export function SplitBar({
  first,
  second,
  third = 0,
  tone = 'surface',
  className = '',
}: {
  first: number;
  second: number;
  third?: number;
  tone?: 'surface' | 'ink';
  className?: string;
}) {
  const parts = [Math.max(0, first), Math.max(0, third), Math.max(0, second)];
  const total = parts.reduce((sum, part) => sum + part, 0);
  const rest = tone === 'ink' ? 'bg-white/20' : 'bg-gray-200';
  const accent = tone === 'ink' ? 'bg-blue-500' : 'bg-blue-600 dark:bg-blue-500';
  const softAccent = tone === 'ink' ? 'bg-sky-300/70' : 'bg-sky-300 dark:bg-sky-400/70';
  const segments = [
    { value: parts[0] ?? 0, className: `origin-left animate-grow-x ${accent}` },
    { value: parts[1] ?? 0, className: softAccent },
    { value: parts[2] ?? 0, className: rest },
  ].filter((segment) => segment.value > 0);

  return (
    <div className={`flex h-2 w-full gap-0.5 overflow-hidden rounded-full ${className}`} aria-hidden="true">
      {total > 0 ? (
        segments.map((segment, index) => (
          <span
            // Order is fixed (first, third, second), so the index is a stable key.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className={`h-full rounded-full ${segment.className}`}
            // Grow by value from a zero basis, so the gaps between segments never push the bar past 100%.
            style={{ flexGrow: segment.value, flexBasis: 0 }}
          />
        ))
      ) : (
        <span className={`h-full flex-1 rounded-full ${rest}`} />
      )}
    </div>
  );
}

export function sharePercent(part: number, total: number): string {
  if (!total || total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}
