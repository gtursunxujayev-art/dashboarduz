'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getPostLoginPath, useAuth } from '@/contexts/auth-context';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    router.replace(user ? getPostLoginPath(user.roles) : '/auth/login');
  }, [isLoading, router, user]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-gray-500">Ish maydoni tayyorlanmoqda...</p>
      </div>
    </div>
  );
}
