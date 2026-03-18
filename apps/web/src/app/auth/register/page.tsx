'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

export default function RegisterPage() {
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const { user, isLoading: isAuthLoading, login } = useAuth();
  const registerWithPassword = trpc.auth.registerWithPassword.useMutation();

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace('/dashboard');
    }
  }, [isAuthLoading, router, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Parollar mos emas');
      return;
    }

    setIsLoading(true);
    try {
      const result = await registerWithPassword.mutateAsync({
        login: loginValue,
        password,
        confirmPassword,
      });

      if (result.success && result.token && result.user) {
        login(result.token, result.user);
        return;
      }

      setError('RoвЂyxatdan oвЂtish muvaffaqiyatsiz');
    } catch (err: any) {
      setError(err?.message || 'RoвЂyxatdan oвЂtish muvaffaqiyatsiz');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Tenant akkaunt yarating</h2>
          <p className="mt-2 text-center text-sm text-gray-600">Login va parol bilan roвЂyxatdan oвЂting</p>
        </div>

        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login" className="block text-sm font-medium text-gray-700">
                Login
              </label>
              <input
                id="login"
                type="text"
                required
                value={loginValue}
                onChange={(e) => setLoginValue(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="your-login"
                disabled={isLoading}
              />
            </div>

            <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Parol
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Kamida 8 ta belgi"
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Parolni tasdiqlang
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="Parolni qayta kiriting"
                disabled={isLoading}
              />
            </div>

            <p className="text-xs text-gray-500">
              Akkaunt yaratishdan oldin bir xil parolni ikki marta kiriting.
            </p>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2 px-4 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? 'Akkaunt yaratilmoqda...' : 'Akkaunt yaratish'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Akkauntingiz bormi?{' '}
              <Link href="/auth/login" className="font-medium text-blue-600 hover:text-blue-500">
                Kirish
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

