'use client';

import { useEffect, useRef, useState } from 'react';
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
  IconPinned,
  IconPinnedOff,
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
import { getInitials } from '@/components/ui/user-avatar';
import { isAgentOnly as sharedIsAgentOnly, isFinanceOnly as sharedIsFinanceOnly, isTashkiliyOnly as sharedIsTashkiliyOnly } from '@dashboarduz/shared';

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
  OnlineAdmin: 'Online admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  OnlineTeamLeader: 'Online team lider',
  OfflineTeamLeader: 'Oflayn team lider',
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
  /** Desktop: keep the sidebar open instead of a hover-to-open rail. */
  pinned: boolean;
  onTogglePinned: () => void;
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

/** Collapsed rail width and opened width on desktop. The shell pads the page by the rail width. */
export const SIDEBAR_RAIL_WIDTH = 72;
export const SIDEBAR_OPEN_WIDTH = 272;

function CountBadge({ count, compact }: { count: number; compact: boolean }) {
  if (count <= 0) return null;
  if (compact) {
    return <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-slate-950" aria-hidden="true" />;
  }
  return (
    <span className="tabular inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function Sidebar({
  pendingAdjustmentCount = 0,
  tenantName,
  tenantPlan,
  mobileOpen,
  pinned,
  onTogglePinned,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [hoverOpen, setHoverOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const handleLogout = () => {
    onMobileClose();
    logout();
  };

  // The same role rules as the route guard (shared helpers), so the menu never offers a blocked page.
  const roles: string[] = user?.roles ?? [];
  // Only a full Admin gets the company-wide tools (integrations, notifications, debug); OnlineAdmin does not.
  const isAdmin = roles.includes('Admin');
  const isAgentOnly = sharedIsAgentOnly(roles);
  const isFinanceOnly = sharedIsFinanceOnly(roles);
  const isTashkiliyOnly = sharedIsTashkiliyOnly(roles);
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
    setHoverOpen(false);
    // Close the drawer and the hover panel on navigation only.
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

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  // A short delay on both edges keeps the rail from flickering open when the pointer only crosses it.
  const scheduleHover = (open: boolean) => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverOpen(open), open ? 90 : 180);
  };

  const displayName = user?.name?.trim()
    || user?.username?.trim()
    || user?.email?.split('@')[0]
    || user?.phone
    || 'Akkaunt';
  const roleLabel = user?.roles?.map((role: string) => ROLE_LABELS[role] || role).join(', ');

  /** `expanded` false renders the icon rail: labels fade out and sub-items hide. */
  const renderPanel = (expanded: boolean, variant: 'desktop' | 'mobile') => {
    const label = `whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'pointer-events-none opacity-0'}`;
    return (
      <div className="flex h-full flex-col bg-slate-950 text-slate-300">
        <div className="flex h-[72px] flex-shrink-0 items-center gap-3 px-4">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg" tabIndex={expanded || variant === 'mobile' ? 0 : -1}>
            <BrandMark size="lg" />
            <span className={`min-w-0 ${label}`}>
              <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight text-white">
                {tenantName || 'Dashboarduz'}
              </span>
              <span className="block truncate text-xs leading-tight text-slate-400">
                {tenantName ? `Dashboarduz, ${tenantPlan || 'free'} tarif` : 'Savdo boshqaruvi'}
              </span>
            </span>
          </Link>
          {variant === 'desktop' ? (
            <button
              type="button"
              onClick={onTogglePinned}
              title={pinned ? 'Menyuni yig\'ish' : 'Menyuni ochiq qoldirish'}
              aria-pressed={pinned}
              className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white ${label}`}
            >
              <span className="sr-only">{pinned ? 'Menyuni yig\'ish' : 'Menyuni ochiq qoldirish'}</span>
              {pinned ? <IconPinnedOff className="h-[18px] w-[18px]" stroke={1.6} /> : <IconPinned className="h-[18px] w-[18px]" stroke={1.6} />}
            </button>
          ) : (
            <button
              type="button"
              onClick={onMobileClose}
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <span className="sr-only">Menyuni yopish</span>
              <IconX className="h-5 w-5" stroke={1.5} />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2 [scrollbar-color:theme(colors.slate.700)_transparent]" aria-label="Asosiy menyu">
          {visibleGroups.map((group) => (
            <div key={group.label ?? 'root'}>
              {group.label ? (
                <div className="relative mb-1.5 h-5 px-3">
                  <p className={`text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500 ${label}`}>{group.label}</p>
                  <span aria-hidden="true" className={`absolute left-4 right-4 top-1/2 h-px bg-white/10 transition-opacity duration-200 ${expanded ? 'opacity-0' : 'opacity-100'}`} />
                </div>
              ) : null}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const children = (item.children || []).filter(itemVisible);
                  const selfActive = isItemActive(item.href);
                  const childActive = children.some((child) => isItemActive(child.href));
                  const current = selfActive && !childActive;
                  const showChildren = expanded && children.length > 0 && (selfActive || childActive);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onMobileClose}
                        aria-current={current ? 'page' : undefined}
                        title={expanded ? undefined : item.name}
                        className={`group relative flex h-11 items-center gap-3 rounded-xl px-[14px] text-sm active:scale-[0.98] ${
                          current
                            ? 'bg-blue-600 font-medium text-white shadow-[0_8px_20px_-8px_rgb(34_72_226/0.8)]'
                            : childActive
                              ? 'bg-white/[0.07] font-medium text-white'
                              : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                        }`}
                      >
                        {Icon ? (
                          <Icon
                            stroke={1.6}
                            className={`h-5 w-5 flex-shrink-0 ${current || childActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`}
                          />
                        ) : null}
                        <span className={`min-w-0 flex-1 truncate ${label}`}>{item.name}</span>
                        {item.href === '/dashboard/adjustments' ? (
                          expanded ? <CountBadge count={pendingAdjustmentCount} compact={false} /> : <CountBadge count={pendingAdjustmentCount} compact />
                        ) : null}
                        {children.length > 0 ? (
                          <IconChevronRight
                            stroke={1.6}
                            className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${showChildren ? 'rotate-90' : ''} ${current ? 'text-white/80' : 'text-slate-500'} ${label}`}
                          />
                        ) : null}
                      </Link>
                      {showChildren ? (
                        <ul className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                          {children.map((child) => {
                            const isCurrent = isItemActive(child.href);
                            return (
                              <li key={child.href}>
                                <Link
                                  href={child.href}
                                  onClick={onMobileClose}
                                  aria-current={isCurrent ? 'page' : undefined}
                                  className={`flex h-9 items-center whitespace-nowrap rounded-lg px-3 text-sm ${
                                    isCurrent
                                      ? 'bg-white/10 font-medium text-white'
                                      : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
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

        <div className="flex-shrink-0 border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-xl px-1 py-2">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white" aria-hidden="true">
              {getInitials(displayName)}
            </span>
            <div className={`min-w-0 flex-1 ${label}`}>
              <p className="truncate text-sm font-medium leading-tight text-white">{displayName}</p>
              <p className="truncate text-xs leading-tight text-slate-400">{roleLabel || user?.email || user?.phone}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Chiqish"
              className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-500/15 hover:text-red-300 active:scale-[0.96] ${label}`}
            >
              <span className="sr-only">Chiqish</span>
              <IconLogout className="h-[18px] w-[18px]" stroke={1.6} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const desktopExpanded = pinned || hoverOpen;

  return (
    <>
      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menyu">
          <div className="absolute inset-0 bg-slate-950/60" onClick={onMobileClose} />
          <div className="relative h-full w-[272px] max-w-[85vw] animate-slide-in-left shadow-xl">
            {renderPanel(true, 'mobile')}
          </div>
        </div>
      ) : null}

      {/* Desktop: icon rail that slides open over the page on hover, or a pinned full sidebar. */}
      <aside
        onMouseEnter={() => { if (!pinned) scheduleHover(true); }}
        onMouseLeave={() => { if (!pinned) scheduleHover(false); }}
        onFocus={() => { if (!pinned) setHoverOpen(true); }}
        onBlur={(event) => {
          if (!pinned && !event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverOpen(false);
        }}
        style={{ width: desktopExpanded ? SIDEBAR_OPEN_WIDTH : SIDEBAR_RAIL_WIDTH }}
        className={`fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-r border-white/[0.06] transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
          hoverOpen && !pinned ? 'shadow-[24px_0_60px_-20px_rgb(2_6_23/0.55)]' : ''
        }`}
      >
        <div className="h-full" style={{ width: SIDEBAR_OPEN_WIDTH }}>
          {renderPanel(desktopExpanded, 'desktop')}
        </div>
      </aside>
    </>
  );
}
