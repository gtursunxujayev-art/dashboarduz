'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/dashboard/sidebar';
import Header from '@/components/dashboard/header';
import DashboardAiShell from '@/components/dashboard/dashboard-ai-shell';
import { trpc } from '@/lib/trpc';

const LIVE_LEADERBOARD_PATH = '/dashboard/live-leaderboard';
const OFFLINE_LEADERBOARD_PATH = '/dashboard/offline-leaderboard';
const DESKTOP_SIDEBAR_STORAGE_KEY = 'dashboarduz-desktop-sidebar-open';

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLeaderboardRoute = pathname === LIVE_LEADERBOARD_PATH || pathname === OFFLINE_LEADERBOARD_PATH;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
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
    if (window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY) === 'false') {
      setDesktopSidebarOpen(false);
    }
  }, []);

  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setDesktopSidebarOpen((value) => {
        window.localStorage.setItem(DESKTOP_SIDEBAR_STORAGE_KEY, value ? 'false' : 'true');
        return !value;
      });
    } else {
      setMobileSidebarOpen((value) => !value);
    }
  }, []);

  if (isLeaderboardRoute) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 text-white">
        {children}
      </div>
    );
  }

  const pendingAdjustmentCount = adjustmentBadgeQuery.data?.pendingTotal ?? 0;

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      <Sidebar
        pendingAdjustmentCount={pendingAdjustmentCount}
        tenantName={tenantQuery.data?.name || undefined}
        tenantPlan={(tenantQuery.data?.plan || 'free').toString()}
        mobileOpen={mobileSidebarOpen}
        desktopOpen={desktopSidebarOpen}
        onMobileClose={closeMobileSidebar}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header pendingAdjustmentCount={pendingAdjustmentCount} onToggleSidebar={toggleSidebar} />
        <main className="relative flex-1 focus:outline-none">
          <div className="mx-auto w-full max-w-[1680px] px-4 pb-10 pt-2 sm:px-6 lg:px-8">
            <DashboardAiShell>
              {children}
            </DashboardAiShell>
          </div>
        </main>
      </div>
    </div>
  );
}
