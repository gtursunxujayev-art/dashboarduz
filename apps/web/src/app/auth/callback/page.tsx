'use client';

export const dynamic = 'force-dynamic';

import { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';

function AuthCallbackContent() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/auth/login?error=auth_callback_disabled');
  }, [router]);

  return <div className="min-h-screen" />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-sm text-gray-600">Yo'naltirilmoqda...</div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
