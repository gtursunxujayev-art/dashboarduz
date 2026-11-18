'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar, { SIDEBAR_OPEN_WIDTH, SIDEBAR_RAIL_WIDTH } from '@/components/dashboard/sidebar';
import Header from '@/components/dashboard/header';
import DashboardAiShell from '@/components/dashboard/dashboard-ai-shell';
import { PageTitleSlotContext } from '@/components/ui/page-title-slot';
import { trpc } from '@/lib/trpc';

const LIVE_LEADERBOARD_PATH = '/dashboard/live-leaderboard';
const OFFLINE_LEADERBOARD_PATH = '/dashboard/offline-leaderboard';
// New key on purpose: the sidebar now opens on hover by default, so the old "open" preference is not carried over.
const SIDEBAR_PINNED_STORAGE_KEY = 'dashboarduz-sidebar-pinned';

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLeaderboardRoute = pathname === LIVE_LEADERBOARD_PATH || pathname === OFFLINE_LEADERBOARD_PATH;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [titleSlot, setTitleSlot] = useState<HTMLDivElement | null>(null);
  const titleSlotValue = useMemo(() => ({ available: true, element: titleSlot }), [titleSlot]);
  const tenantQuery = trpc.tenant.get.useQuery(undefined, {
    enabled: !isLeaderboardRoute,
    retry: 1,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const adjustmentBadgeQuery = trpc.customerIncome.adjustmentBadgeCount.useQuery(undefined, {
    enabled: !isLeaderboardRoute,
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY) === 'true') setSidebarPinned(true);
    } catch {
      // Storage unavailable: keep the hover rail.
    }
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const togglePinned = useCallback(() => {
    setSidebarPinned((value) => {
      try {
        window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, value ? 'false' : 'true');
      } catch {
        // Ignore: the choice just won't survive a reload.
      }
      return !value;
    });
  }, []);
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      togglePinned();
    } else {
      setMobileSidebarOpen((value) => !value);
    }
  }, [togglePinned]);

  if (isLeaderboardRoute) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-white">
        {children}
      </div>
    );
  }

  const pendingAdjustmentCount = adjustmentBadgeQuery.data?.pendingTotal ?? 0;

  return (
    <div
      className="min-h-[100dvh] bg-background text-foreground lg:pl-[var(--sidebar-offset)] lg:transition-[padding] lg:duration-300 lg:ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ '--sidebar-offset': `${sidebarPinned ? SIDEBAR_OPEN_WIDTH : SIDEBAR_RAIL_WIDTH}px` } as React.CSSProperties}
    >
      <Sidebar
        pendingAdjustmentCount={pendingAdjustmentCount}
        tenantName={tenantQuery.data?.name || undefined}
        tenantPlan={(tenantQuery.data?.plan || 'free').toString()}
        mobileOpen={mobileSidebarOpen}
        pinned={sidebarPinned}
        onTogglePinned={togglePinned}
        onMobileClose={closeMobileSidebar}
      />
      <PageTitleSlotContext.Provider value={titleSlotValue}>
      <div className="flex min-h-[100dvh] min-w-0 flex-col">
        <Header pendingAdjustmentCount={pendingAdjustmentCount} onToggleSidebar={toggleSidebar} titleSlotRef={setTitleSlot} />
        <main className="relative flex-1 focus:outline-none">
          <div className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-1 sm:px-6 lg:px-10">
            <DashboardAiShell>
              {children}
            </DashboardAiShell>
          </div>
        </main>
      </div>
      </PageTitleSlotContext.Provider>
    </div>
  );
}
