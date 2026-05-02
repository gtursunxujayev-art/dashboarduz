import ProtectedRoute from '@/components/auth/protected-route';
import DashboardAccessGuard from '@/components/auth/dashboard-access-guard';
import Sidebar from '@/components/dashboard/sidebar';
import Header from '@/components/dashboard/header';
import DashboardAiShell from '@/components/dashboard/dashboard-ai-shell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <DashboardAccessGuard>
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
      </DashboardAccessGuard>
    </ProtectedRoute>
  );
}
