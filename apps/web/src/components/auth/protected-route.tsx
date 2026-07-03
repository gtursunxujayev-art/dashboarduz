'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: Array<'Admin' | 'Manager' | 'TeamLeader' | 'Agent' | 'OnlineAgent' | 'OfflineAgent' | 'Dashboard' | 'OfflineDashboard' | 'Finance' | 'Tashkiliy'>;
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Yuklanmoqda...</p>
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
