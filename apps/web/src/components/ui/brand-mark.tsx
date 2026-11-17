import { IconChartArcs } from '@tabler/icons-react';

/** The product mark: a cobalt tile with the chart glyph. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-10 w-10 rounded-xl' : 'h-9 w-9 rounded-[10px]';
  const glyph = size === 'lg' ? 'h-[22px] w-[22px]' : 'h-5 w-5';
  return (
    <span
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center bg-blue-600 text-white shadow-sm ${box}`}
    >
      <IconChartArcs className={glyph} stroke={2} />
    </span>
  );
}
