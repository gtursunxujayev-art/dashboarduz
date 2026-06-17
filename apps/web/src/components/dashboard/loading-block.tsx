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
      className={`flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4 ${
        compact ? 'min-h-[56px] py-3' : 'min-h-[96px] py-6'
      } ${className}`.trim()}
    >
      <div className="flex items-center gap-3 text-sm text-gray-600">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
          aria-hidden="true"
        />
        <span>{message}</span>
      </div>
    </div>
  );
}
