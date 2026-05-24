'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type ThemeMode = 'light' | 'dark';
const THEME_STORAGE_KEY = 'dashboarduz-theme';
const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  Agent: 'Agent',
  OnlineAgent: 'Online agent',
  OfflineAgent: 'Offline agent',
  Dashboard: 'Dashboard',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

export default function Header() {
  const { user } = useAuth();
  const tenantQuery = trpc.tenant.get.useQuery(undefined, {
    retry: 1,
  });
  const adjustmentBadgeQuery = trpc.customerIncome.adjustmentBadgeCount.useQuery(undefined, {
    retry: false,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const pendingAdjustmentCount = adjustmentBadgeQuery.data?.pendingTotal ?? 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    const getInitialTheme = (): ThemeMode => {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null;
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
      return 'light';
    };

    const initialTheme = getInitialTheme();
    setTheme(initialTheme);
    document.documentElement.classList.toggle('dark', initialTheme === 'dark');
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  const handleThemeChange = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const tenantName = tenantQuery.data?.name || 'Ish maydoni';
  const tenantPlan = (tenantQuery.data?.plan || 'free').toString();
  const accountDisplayName = user?.name?.trim()
    || user?.username?.trim()
    || user?.email?.split('@')[0]
    || user?.phone
    || 'Akkaunt';

  return (
    <header className="relative z-30 border-b border-gray-200 bg-white">
      <div className="pl-12 pr-3 sm:px-6 lg:px-8">
        <div className="flex min-h-12 flex-col gap-2 py-2 sm:min-h-16 sm:gap-3 sm:py-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">Boshqaruv paneli</h2>

          <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto sm:gap-4">
            <div className="inline-flex rounded-md border border-gray-300 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => handleThemeChange('light')}
                className={`px-2 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs ${theme === 'light' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                aria-label="Yorug' mavzu"
              >
                Yorug'
              </button>
              <button
                type="button"
                onClick={() => handleThemeChange('dark')}
                className={`border-l border-gray-300 px-2 py-1 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs ${theme === 'dark' ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                aria-label="Tungi mavzu"
              >
                Tungi
              </button>
            </div>

            <div ref={menuRef} className="relative min-w-[150px] sm:min-w-[180px]">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-left shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:px-4 sm:py-2"
                aria-expanded={menuOpen}
              >
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-xs font-medium text-gray-800 sm:text-sm">{tenantName}</p>
                    <p className="text-[11px] capitalize text-gray-500 sm:text-xs">{tenantPlan} tarif</p>
                  </div>
                  <svg
                    className={`h-4 w-4 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl">
                  <p className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Ish maydoni</p>
                  <div className="mt-2 rounded-lg border border-gray-100 px-3 py-3">
                    <p className="text-sm font-medium text-gray-800">{tenantName}</p>
                    <p className="text-xs capitalize text-gray-500">{tenantPlan} tarif</p>
                  </div>
                </div>
              )}
            </div>

            <Link
              href="/dashboard/adjustments"
              className="relative rounded-full p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className="sr-only">Bildirishnomalar</span>
              <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
              </svg>
              {pendingAdjustmentCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {pendingAdjustmentCount > 99 ? '99+' : pendingAdjustmentCount}
                </span>
              )}
            </Link>

            <div className="text-right">
              <p className="max-w-[80px] truncate text-xs font-medium text-gray-800 sm:max-w-none sm:text-sm">{accountDisplayName}</p>
              <p className="text-[11px] text-gray-500 sm:text-xs">
                {user?.roles?.map((role: string) => ROLE_LABELS[role] || role).join(', ')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
