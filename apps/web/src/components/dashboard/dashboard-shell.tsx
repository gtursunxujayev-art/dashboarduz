'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/dashboard/sidebar';
import Header from '@/components/dashboard/header';
import DashboardAiShell from '@/components/dashboard/dashboard-ai-shell';
import { trpc } from '@/lib/trpc';

const LIVE_LEADERBOARD_PATH = '/dashboard/live-leaderboard';
const OFFLINE_LEADERBOARD_PATH = '/dashboard/offline-leaderboard';

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLeaderboardRoute = pathname === LIVE_LEADERBOARD_PATH || pathname === OFFLINE_LEADERBOARD_PATH;
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

  if (isLeaderboardRoute) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar pendingAdjustmentCount={adjustmentBadgeQuery.data?.pendingTotal ?? 0} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          tenantName={tenantQuery.data?.name || 'Ish maydoni'}
          tenantPlan={(tenantQuery.data?.plan || 'free').toString()}
          pendingAdjustmentCount={adjustmentBadgeQuery.data?.pendingTotal ?? 0}
        />
        <main className="relative flex-1 overflow-y-auto focus:outline-none">
          <div className="py-6">
            <div className="w-full px-4 sm:px-6 md:px-8">
              <DashboardAiShell>
                {children}
              </DashboardAiShell>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
