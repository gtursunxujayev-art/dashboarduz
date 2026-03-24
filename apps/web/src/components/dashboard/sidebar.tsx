'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const AGENT_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/income',
  '/dashboard/adjustments',
  '/dashboard/sotuvchilar',
  '/dashboard/calls',
  '/dashboard/customers',
  '/dashboard/course-sales',
  '/dashboard/analytics',
  '/dashboard/finance',
]);
const FINANCE_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/course-sales',
  '/dashboard/analytics',
  '/dashboard/finance',
  '/dashboard/adjustments',
]);
const TASHKILIY_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/adjustments',
  '/dashboard/customers',
  '/dashboard/course-sales',
  '/dashboard/courses',
  '/dashboard/settings',
]);
const ADMIN_ONLY_HREFS = new Set([
  '/dashboard/integrations',
  '/dashboard/notifications',
]);

const navigation = [
  { name: 'Boshqaruv', href: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { name: 'Tushum', href: '/dashboard/income', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { name: "Qaytarish / O'zgarish", href: '/dashboard/adjustments', icon: 'M8.228 9.247a4.5 4.5 0 117.544 2.581M15.772 14.753a4.5 4.5 0 11-7.544-2.581M4.5 4.5v5h5m10-5v5h-5' },
  { name: 'Sotuvchilar', href: '/dashboard/sotuvchilar', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { name: "Qo'ng'iroqlar", href: '/dashboard/calls', icon: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z' },
  { name: 'Mijozlar', href: '/dashboard/customers', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { name: 'Kurslar sotuvi', href: '/dashboard/course-sales', icon: 'M9 19V6m4 13V10m4 9V4M4 20h16' },
  { name: 'Tahlil', href: '/dashboard/analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { name: 'Moliya', href: '/dashboard/finance', icon: 'M3 10h18M7 15h1m4 0h5M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z' },
  { name: 'Bonus', href: '/dashboard/bonus', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { name: 'Kurslar', href: '/dashboard/courses', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5 4.462 5 2 6.567 2 8.5v9.75A1.75 1.75 0 003.75 20H9m3-13.747C13.168 5.477 14.754 5 16.5 5 19.538 5 22 6.567 22 8.5v9.75A1.75 1.75 0 0120.25 20H15m-3-13.747v13' },
  { name: 'Sozlamalar', href: '/dashboard/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { name: 'Foydalanuvchilar', href: '/dashboard/users', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 5.197v-1a6 6 0 00-4.5-5.799M12 11a3 3 0 100-6 3 3 0 000 6z' },
  { name: 'Integratsiyalar', href: '/dashboard/integrations', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  { name: 'Bildirishnomalar', href: '/dashboard/notifications', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
];

export default function Sidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const adjustmentBadgeQuery = trpc.customerIncome.adjustmentBadgeCount.useQuery(undefined, {
    retry: false,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const pendingAdjustmentCount = adjustmentBadgeQuery.data?.pendingTotal ?? 0;
  const handleLogout = () => {
    setSidebarOpen(false);
    logout();
  };

  const roles = user?.roles || [];
  const isAdmin = user?.roles.includes('Admin');
  const canSeeBonusPage = Boolean(user?.roles.includes('Admin') || user?.roles.includes('Manager'));
  const isAgentOnly = Boolean(user?.roles.includes('Agent') && !user?.roles.some((role: string) => PRIVILEGED_ROLES.has(role)));
  const isFinanceOnly = Boolean(
    user?.roles.includes('Finance')
      && !user?.roles.includes('Admin')
      && !user?.roles.includes('Manager')
      && !user?.roles.includes('Agent'),
  );
  const isTashkiliyOnly = Boolean(
    user?.roles.includes('Tashkiliy')
      && !user?.roles.includes('Admin')
      && !user?.roles.includes('Manager')
      && !user?.roles.includes('Agent')
      && !user?.roles.includes('Finance'),
  );
  const visibleNavigation = (isAgentOnly
    ? navigation.filter((item) => AGENT_ALLOWED_HREFS.has(item.href))
    : isFinanceOnly
      ? navigation.filter((item) => FINANCE_ALLOWED_HREFS.has(item.href))
      : isTashkiliyOnly
        ? navigation.filter((item) => TASHKILIY_ALLOWED_HREFS.has(item.href))
      : isAdmin
        ? navigation
        : navigation.filter((item) => !ADMIN_ONLY_HREFS.has(item.href)))
    .filter((item) => item.href !== '/dashboard/bonus' || canSeeBonusPage);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile sidebar toggle */}
      <div className="fixed left-4 top-4 z-50 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="relative rounded-md border border-gray-200 bg-white p-2 text-gray-500 shadow-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
        >
          <span className="sr-only">Menyuni ochish</span>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {pendingAdjustmentCount > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
              {pendingAdjustmentCount > 99 ? '99+' : pendingAdjustmentCount}
            </span>
          )}
        </button>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-0 z-40 flex pointer-events-none">
            <div className="relative pointer-events-auto flex-1 flex flex-col max-w-xs w-full bg-white">
              <div className="absolute top-0 right-0 -mr-12 pt-2">
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
                >
                  <span className="sr-only">Menyuni yopish</span>
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
                <div className="flex-shrink-0 flex items-center px-4">
                  <h1 className="text-xl font-bold text-gray-900">Dashboarduz</h1>
                </div>
                <nav className="mt-5 px-2 space-y-1">
                  {visibleNavigation.map((item) => (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`group flex items-center px-2 py-2 text-base font-medium rounded-md ${
                        pathname === item.href
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`}
                    >
                      <svg
                        className={`mr-4 h-6 w-6 ${
                          pathname === item.href ? 'text-gray-500' : 'text-gray-400 group-hover:text-gray-500'
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                      </svg>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{item.name}</span>
                        {item.href === '/dashboard/adjustments' && pendingAdjustmentCount > 0 && (
                          <span className="inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                            {pendingAdjustmentCount > 99 ? '99+' : pendingAdjustmentCount}
                          </span>
                        )}
                      </span>
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex-shrink-0 flex border-t border-gray-200 p-4">
                <div className="w-full space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{user?.email || user?.phone}</p>
                    <p className="text-xs text-gray-500">{user?.roles.join(', ')}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                  >
                    Chiqish
                  </button>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 w-14">{/* Spacer */}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <div className="flex flex-col w-64">
          <div className="flex flex-col h-0 flex-1 border-r border-gray-200 bg-white">
            <div className="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
              <div className="flex items-center flex-shrink-0 px-4">
                <h1 className="text-xl font-bold text-gray-900">Dashboarduz</h1>
              </div>
              <nav className="mt-5 flex-1 px-2 bg-white space-y-1">
                {visibleNavigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                      pathname === item.href
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <svg
                      className={`mr-3 h-6 w-6 ${
                        pathname === item.href ? 'text-gray-500' : 'text-gray-400 group-hover:text-gray-500'
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                    </svg>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{item.name}</span>
                      {item.href === '/dashboard/adjustments' && pendingAdjustmentCount > 0 && (
                        <span className="inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                          {pendingAdjustmentCount > 99 ? '99+' : pendingAdjustmentCount}
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </nav>
            </div>
            <div className="flex-shrink-0 border-t border-gray-200 p-4">
              <div className="w-full space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">{user?.email || user?.phone}</p>
                  <p className="text-xs text-gray-500">{user?.roles.join(', ')}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
                >
                  Chiqish
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
