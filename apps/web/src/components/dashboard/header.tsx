'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconBell, IconChevronRight, IconLayoutSidebar, IconMoon, IconSun } from '@tabler/icons-react';
import { useAuth } from '@/contexts/auth-context';
import { getNavigationTrail } from '@/components/dashboard/sidebar';
import { UserAvatar } from '@/components/ui/user-avatar';

type ThemeMode = 'light' | 'dark';
const THEME_STORAGE_KEY = 'dashboarduz-theme';

type HeaderProps = {
  pendingAdjustmentCount?: number;
  onToggleSidebar?: () => void;
};

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.setAttribute('data-theme', theme);
}

const UZ_WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

// Browsers ship no Uzbek locale data, so the date is assembled by hand (Tashkent time).
function todayLabel() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${UZ_WEEKDAYS[weekday]}, ${day}-${UZ_MONTHS[month - 1]}`;
}

export default function Header({ pendingAdjustmentCount = 0, onToggleSidebar }: HeaderProps) {
  const { user } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [today, setToday] = useState('');
  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    const initialTheme: ThemeMode = stored === 'dark' || stored === 'light'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setTheme(initialTheme);
    applyTheme(initialTheme);
    setToday(todayLabel());
  }, []);

  const handleThemeChange = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  };

  const accountDisplayName = user?.name?.trim()
    || user?.username?.trim()
    || user?.email?.split('@')[0]
    || user?.phone
    || 'Akkaunt';
  const trail = getNavigationTrail(pathname);
  const crumbs = trail.length ? trail : [{ name: 'Boshqaruv paneli' }];

  const themeOptions: Array<{ mode: ThemeMode; label: string; Icon: typeof IconSun }> = [
    { mode: 'light', label: "Yorug' mavzu", Icon: IconSun },
    { mode: 'dark', label: 'Tungi mavzu', Icon: IconMoon },
  ];
  const iconButton = 'relative inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] text-gray-500 hover:bg-gray-200/70 hover:text-gray-900 active:scale-[0.96]';

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <button type="button" onClick={onToggleSidebar} className={`${iconButton} -ml-2`}>
          <span className="sr-only">Menyuni ochish yoki yopish</span>
          <IconLayoutSidebar className="h-5 w-5" stroke={1.6} />
          {pendingAdjustmentCount > 0 ? (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background lg:hidden" aria-hidden="true" />
          ) : null}
        </button>

        <nav aria-label="Joylashuv" className="flex min-w-0 flex-1 items-center gap-3">
          <ol className="flex min-w-0 items-center gap-1.5 text-sm">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={`${crumb.name}-${index}`} className={`flex min-w-0 items-center gap-1.5 ${last ? '' : 'hidden sm:flex'}`}>
                  {index > 0 ? <IconChevronRight className="hidden h-4 w-4 flex-shrink-0 text-gray-300 sm:block" stroke={1.6} aria-hidden="true" /> : null}
                  {last ? (
                    <span aria-current="page" className="truncate font-medium text-gray-900">{crumb.name}</span>
                  ) : crumb.href ? (
                    <Link href={crumb.href} className="truncate text-gray-500 hover:text-gray-900">{crumb.name}</Link>
                  ) : (
                    <span className="truncate text-gray-500">{crumb.name}</span>
                  )}
                </li>
              );
            })}
          </ol>
          {today ? <span className="hidden flex-shrink-0 text-[13px] text-gray-400 xl:inline">{today}</span> : null}
        </nav>

        <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
          <div className="inline-flex h-10 items-center gap-0.5 rounded-[10px] bg-white p-1 shadow" role="group" aria-label="Mavzu">
            {themeOptions.map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleThemeChange(mode)}
                aria-label={label}
                aria-pressed={theme === mode}
                title={label}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${
                  theme === mode ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                <Icon className="h-[18px] w-[18px]" stroke={1.6} />
              </button>
            ))}
          </div>

          <Link href="/dashboard/adjustments" className={iconButton}>
            <span className="sr-only">Bildirishnomalar</span>
            <IconBell className="h-5 w-5" stroke={1.6} />
            {pendingAdjustmentCount > 0 && (
              <span className="tabular absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-background">
                {pendingAdjustmentCount > 99 ? '99+' : pendingAdjustmentCount}
              </span>
            )}
          </Link>

          <span title={accountDisplayName} className="ml-1">
            <UserAvatar name={accountDisplayName} />
          </span>
        </div>
      </div>
    </header>
  );
}
