'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconAddressBook,
  IconAlertTriangle,
  IconArrowsExchange,
  IconBell,
  IconBook2,
  IconBrandTelegram,
  IconBug,
  IconBuildingSkyscraper,
  IconCalendarCheck,
  IconChartBar,
  IconChartLine,
  IconChevronRight,
  IconCoins,
  IconLayoutDashboard,
  IconLogout,
  IconPhone,
  IconPlugConnected,
  IconSettings,
  IconUserCog,
  IconUsersGroup,
  IconWallet,
  IconX,
} from '@tabler/icons-react';
import type { Icon as NavIcon } from '@tabler/icons-react';
import { useAuth } from '@/contexts/auth-context';
import { BrandMark } from '@/components/ui/brand-mark';
import { UserAvatar } from '@/components/ui/user-avatar';

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);
const AGENT_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/income',
  '/dashboard/adjustments',
  '/dashboard/sotuvchilar',
  '/dashboard/calls',
  '/dashboard/corporate-calls',
  '/dashboard/customers',
  '/dashboard/finance',
  '/dashboard/finance/bonus-details',
]);
const FINANCE_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/attendance',
  '/dashboard/course-sales',
  '/dashboard/course-sales/intensive',
  '/dashboard/course-sales/online',
  '/dashboard/course-sales/offline',
  '/dashboard/analytics',
  '/dashboard/analytics/reports',
  '/dashboard/analytics/funnel',
  '/dashboard/finance',
  '/dashboard/finance/bonus-details',
  '/dashboard/adjustments',
]);
const TASHKILIY_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/adjustments',
  '/dashboard/customers',
  '/dashboard/course-sales',
  '/dashboard/course-sales/intensive',
  '/dashboard/course-sales/online',
  '/dashboard/course-sales/offline',
  '/dashboard/courses',
  '/dashboard/settings',
]);
const ADMIN_ONLY_HREFS = new Set([
  '/dashboard/integrations',
  '/dashboard/notifications',
  '/dashboard/income-problems',
  '/dashboard/income-debug',
]);

const ROLE_LABELS: Record<string, string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  Agent: 'Agent',
  OnlineAgent: 'Online agent',
  OfflineAgent: 'Offline agent',
  Dashboard: 'Dashboard',
  OfflineDashboard: 'Offline dashboard',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

type NavigationItem = {
  name: string;
  href: string;
  icon?: NavIcon;
  children?: NavigationItem[];
};

type NavigationGroup = {
  label: string | null;
  items: NavigationItem[];
};

type SidebarProps = {
  pendingAdjustmentCount?: number;
  tenantName?: string;
  tenantPlan?: string;
  mobileOpen: boolean;
  desktopOpen: boolean;
  onMobileClose: () => void;
};

const navigationGroups: NavigationGroup[] = [
  {
    label: null,
    items: [
      { name: 'Boshqaruv', href: '/dashboard', icon: IconLayoutDashboard },
    ],
  },
  {
    label: 'Savdo',
    items: [
      { name: 'Tushum', href: '/dashboard/income', icon: IconCoins },
      { name: "Qaytarish / O'zgarish", href: '/dashboard/adjustments', icon: IconArrowsExchange },
      { name: 'Sotuvchilar', href: '/dashboard/sotuvchilar', icon: IconUsersGroup },
      { name: 'Mijozlar', href: '/dashboard/customers', icon: IconAddressBook },
      {
        name: 'Kurslar sotuvi',
        href: '/dashboard/course-sales',
        icon: IconChartBar,
        children: [
          { name: 'Intensiv', href: '/dashboard/course-sales/intensive' },
          { name: 'Online', href: '/dashboard/course-sales/online' },
          { name: 'Oflayn', href: '/dashboard/course-sales/offline' },
        ],
      },
    ],
  },
  {
    label: 'Aloqa',
    items: [
      { name: "Qo'ng'iroqlar", href: '/dashboard/calls', icon: IconPhone },
      { name: "Korporativ qo'ng'iroq", href: '/dashboard/corporate-calls', icon: IconBuildingSkyscraper },
      { name: 'Davomat', href: '/dashboard/attendance', icon: IconCalendarCheck },
    ],
  },
  {
    label: 'Tahlil va moliya',
    items: [
      {
        name: 'Tahlil',
        href: '/dashboard/analytics',
        icon: IconChartLine,
        children: [
          { name: 'Hisobotlar', href: '/dashboard/analytics/reports' },
          { name: 'Voronka', href: '/dashboard/analytics/funnel' },
        ],
      },
      {
        name: 'Moliya',
        href: '/dashboard/finance',
        icon: IconWallet,
        children: [
          { name: 'Bonus', href: '/dashboard/bonus' },
          { name: 'Bonus tafsiloti', href: '/dashboard/finance/bonus-details' },
        ],
      },
      { name: 'Tushum muammolari', href: '/dashboard/income-problems', icon: IconAlertTriangle },
      { name: 'Tushum debug', href: '/dashboard/income-debug', icon: IconBug },
    ],
  },
  {
    label: 'Tizim',
    items: [
      { name: 'Kurslar', href: '/dashboard/courses', icon: IconBook2 },
      { name: 'Sozlamalar', href: '/dashboard/settings', icon: IconSettings },
      { name: 'Foydalanuvchilar', href: '/dashboard/users', icon: IconUserCog },
      { name: 'Telegram bot', href: '/dashboard/telegram-bot', icon: IconBrandTelegram },
      { name: 'Integratsiyalar', href: '/dashboard/integrations', icon: IconPlugConnected },
      { name: 'Bildirishnomalar', href: '/dashboard/notifications', icon: IconBell },
    ],
  },
];

function matchesPath(pathname: string, href: string) {
  return href === '/dashboard'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Title of the deepest navigation entry matching a path. */
export function getNavigationTitle(pathname: string): string | null {
  const trail = getNavigationTrail(pathname);
  return trail.length ? trail[trail.length - 1].name : null;
}

/** Breadcrumb for a path: its navigation group, parent entry and the deepest matching entry. Used by the header. */
export function getNavigationTrail(pathname: string): Array<{ name: string; href?: string }> {
  let best: { length: number; trail: Array<{ name: string; href?: string }> } = { length: 0, trail: [] };
  for (const group of navigationGroups) {
    const visit = (item: NavigationItem, parents: NavigationItem[]) => {
      if (matchesPath(pathname, item.href) && item.href.length > best.length) {
        best = {
          length: item.href.length,
          trail: [
            ...(group.label ? [{ name: group.label }] : []),
            ...parents.map((parent) => ({ name: parent.name, href: parent.href })),
            { name: item.name, href: item.href },
          ],
        };
      }
      item.children?.forEach((child) => visit(child, [...parents, item]));
    };
    group.items.forEach((item) => visit(item, []));
  }
  return best.trail;
}

function CountBadge({ count, onAccent }: { count: number; onAccent: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={`tabular inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none ${
        onAccent ? 'bg-white text-blue-700' : 'bg-red-500 text-white'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function Sidebar({
  pendingAdjustmentCount = 0,
  tenantName,
  tenantPlan,
  mobileOpen,
  desktopOpen,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const handleLogout = () => {
    onMobileClose();
    logout();
  };

  const isAdmin = user?.roles.includes('Admin');
  const isAgentOnly = Boolean(user?.roles.some((role: string) => AGENT_ROLES.has(role)) && !user?.roles.some((role: string) => PRIVILEGED_ROLES.has(role)));
  const isFinanceOnly = Boolean(
    user?.roles.includes('Finance')
      && !user?.roles.includes('Admin')
      && !user?.roles.includes('Manager')
      && !user?.roles.includes('TeamLeader')
      && !user?.roles.some((role: string) => AGENT_ROLES.has(role)),
  );
  const isTashkiliyOnly = Boolean(
    user?.roles.includes('Tashkiliy')
      && !user?.roles.includes('Admin')
      && !user?.roles.includes('Manager')
      && !user?.roles.includes('TeamLeader')
      && !user?.roles.some((role: string) => AGENT_ROLES.has(role))
      && !user?.roles.includes('Finance'),
  );
  const itemVisible = (item: NavigationItem) => (
    isAgentOnly
      ? AGENT_ALLOWED_HREFS.has(item.href)
      : isFinanceOnly
        ? FINANCE_ALLOWED_HREFS.has(item.href)
        : isTashkiliyOnly
          ? TASHKILIY_ALLOWED_HREFS.has(item.href)
          : isAdmin
            ? true
            : !ADMIN_ONLY_HREFS.has(item.href)
  );
  const isItemActive = (href: string) => matchesPath(pathname, href);
  const visibleGroups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter(itemVisible) }))
    .filter((group) => group.items.length > 0);

  useEffect(() => {
    onMobileClose();
    // Close the drawer on navigation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMobileClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, onMobileClose]);

  const displayName = user?.name?.trim()
    || user?.username?.trim()
    || user?.email?.split('@')[0]
    || user?.phone
    || 'Akkaunt';
  const roleLabel = user?.roles?.map((role: string) => ROLE_LABELS[role] || role).join(', ');

  const panel = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-[68px] flex-shrink-0 items-center justify-between gap-2 px-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3 rounded-md">
          <BrandMark />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight text-gray-900">
              {tenantName || 'Dashboarduz'}
            </span>
            <span className="block truncate text-xs leading-tight text-gray-500">
              {tenantName ? `Dashboarduz, ${tenantPlan || 'free'} tarif` : 'Savdo boshqaruvi'}
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={onMobileClose}
          className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
        >
          <span className="sr-only">Menyuni yopish</span>
          <IconX className="h-5 w-5" stroke={1.5} />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-3" aria-label="Asosiy menyu">
        {visibleGroups.map((group) => (
          <div key={group.label ?? 'root'}>
            {group.label ? (
              <p className="mb-1.5 px-3 text-xs font-medium text-gray-400">{group.label}</p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const children = (item.children || []).filter(itemVisible);
                const selfActive = isItemActive(item.href);
                const childActive = children.some((child) => isItemActive(child.href));
                const current = selfActive && !childActive;
                const expanded = children.length > 0 && (selfActive || childActive);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      aria-current={current ? 'page' : undefined}
                      className={`group flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm active:scale-[0.99] ${
                        current
                          ? 'bg-blue-600 font-medium text-white shadow-sm'
                          : childActive
                            ? 'font-medium text-gray-900 hover:bg-gray-100'
                            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`}
                    >
                      {Icon ? (
                        <Icon
                          stroke={1.6}
                          className={`h-[19px] w-[19px] flex-shrink-0 ${
                            current
                              ? 'text-white'
                              : childActive
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-400 group-hover:text-gray-700'
                          }`}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {item.href === '/dashboard/adjustments' ? (
                        <CountBadge count={pendingAdjustmentCount} onAccent={current} />
                      ) : null}
                      {children.length > 0 ? (
                        <IconChevronRight
                          stroke={1.6}
                          className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''} ${current ? 'text-white/80' : 'text-gray-400'}`}
                        />
                      ) : null}
                    </Link>
                    {expanded ? (
                      <ul className="ml-[21px] mt-1 space-y-0.5 border-l border-gray-200 pl-3">
                        {children.map((child) => {
                          const isCurrent = isItemActive(child.href);
                          return (
                            <li key={child.href}>
                              <Link
                                href={child.href}
                                onClick={onMobileClose}
                                aria-current={isCurrent ? 'page' : undefined}
                                className={`flex h-9 items-center rounded-md px-3 text-sm ${
                                  isCurrent
                                    ? 'bg-blue-50 font-medium text-blue-700'
                                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                                }`}
                              >
                                {child.name}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="flex-shrink-0 p-3">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
          <UserAvatar name={displayName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-gray-900">{displayName}</p>
            <p className="truncate text-xs leading-tight text-gray-500">{roleLabel || user?.email || user?.phone}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Chiqish"
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 active:scale-[0.96]"
          >
            <span className="sr-only">Chiqish</span>
            <IconLogout className="h-[18px] w-[18px]" stroke={1.6} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menyu">
          <div className="absolute inset-0 bg-slate-950/60" onClick={onMobileClose} />
          <div className="relative h-full w-72 max-w-[85vw] shadow-xl">
            {panel}
          </div>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      {desktopOpen ? (
        <aside className="sticky top-0 hidden h-[100dvh] w-[260px] flex-shrink-0 border-r border-gray-200 lg:block">
          {panel}
        </aside>
      ) : null}
    </>
  );
}
