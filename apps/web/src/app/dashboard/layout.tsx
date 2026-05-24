import ProtectedRoute from '@/components/auth/protected-route';
import DashboardAccessGuard from '@/components/auth/dashboard-access-guard';
import DashboardShell from '@/components/dashboard/dashboard-shell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <DashboardAccessGuard>
        <DashboardShell>{children}</DashboardShell>
      </DashboardAccessGuard>
    </ProtectedRoute>
  );
}
