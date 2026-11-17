/**
 * Two-part proportion bar (for example Online vs Ofline). Both parts are real data:
 * the first segment takes the accent, the second the quieter tone.
 */
export function SplitBar({
  first,
  second,
  tone = 'surface',
  className = '',
}: {
  first: number;
  second: number;
  tone?: 'surface' | 'ink';
  className?: string;
}) {
  const total = Math.max(0, first) + Math.max(0, second);
  const firstShare = total > 0 ? (Math.max(0, first) / total) * 100 : 0;
  const rest = tone === 'ink' ? 'bg-white/20' : 'bg-gray-200';
  const accent = tone === 'ink' ? 'bg-blue-500' : 'bg-blue-600 dark:bg-blue-500';

  return (
    <div className={`flex h-2 w-full gap-0.5 overflow-hidden rounded-full ${className}`} aria-hidden="true">
      {total > 0 ? (
        <>
          {firstShare > 0 ? (
            <span className={`h-full origin-left animate-grow-x rounded-full ${accent}`} style={{ width: `${firstShare}%` }} />
          ) : null}
          {firstShare < 100 ? <span className={`h-full flex-1 rounded-full ${rest}`} /> : null}
        </>
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
