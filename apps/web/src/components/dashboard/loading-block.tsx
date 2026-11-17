'use client';

type Props = {
  message?: string;
  className?: string;
  compact?: boolean;
};

export default function LoadingBlock({
  message = 'Yuklanmoqda...',
  className = '',
  compact = false,
}: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center rounded-lg bg-gray-100/70 px-4 ${
        compact ? 'min-h-[56px] py-3' : 'min-h-[96px] py-6'
      } ${className}`.trim()}
    >
      <div className="flex items-center gap-2.5 text-sm text-gray-500">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
          aria-hidden="true"
        />
        <span>{message}</span>
      </div>
    </div>
  );
}
