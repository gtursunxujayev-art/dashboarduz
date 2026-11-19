'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: Array<'Admin' | 'OnlineAdmin' | 'Manager' | 'TeamLeader' | 'OnlineTeamLeader' | 'OfflineTeamLeader' | 'Agent' | 'OnlineAgent' | 'OfflineAgent' | 'Dashboard' | 'OfflineDashboard' | 'Finance' | 'Tashkiliy'>;
}

export default function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth/login');
    } else if (!isLoading && user && requiredRoles) {
      const hasRequiredRole = requiredRoles.some((role) => user.roles.includes(role));
      if (!hasRequiredRole) {
        router.replace('/dashboard');
      }
    }
  }, [user, isLoading, router, requiredRoles]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
          <p className="mt-3 text-sm text-gray-500">Yuklanmoqda...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect in useEffect
  }

  if (requiredRoles) {
    const hasRequiredRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRequiredRole) {
      return null; // Will redirect in useEffect
    }
  }

  return <>{children}</>;
}
