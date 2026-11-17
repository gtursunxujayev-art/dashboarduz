export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

/** Initials avatar. Neutral on purpose: the accent colour is reserved for actions and data. */
export function UserAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8 text-[11px]' : 'h-9 w-9 text-xs';
  return (
    <span
      aria-hidden="true"
      className={`flex flex-shrink-0 items-center justify-center rounded-full bg-gray-200 font-semibold text-gray-700 ${box}`}
    >
      {getInitials(name)}
    </span>
  );
}
