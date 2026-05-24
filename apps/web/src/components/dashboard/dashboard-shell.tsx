'use client';

import { usePathname } from 'next/navigation';
import Sidebar from '@/components/dashboard/sidebar';
import Header from '@/components/dashboard/header';
import DashboardAiShell from '@/components/dashboard/dashboard-ai-shell';

const LIVE_LEADERBOARD_PATH = '/dashboard/live-leaderboard';

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === LIVE_LEADERBOARD_PATH) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
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
