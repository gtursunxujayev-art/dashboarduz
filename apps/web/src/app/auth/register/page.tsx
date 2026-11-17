'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { BrandMark } from '@/components/ui/brand-mark';
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

      setError("Ro'yxatdan o'tish muvaffaqiyatsiz");
    } catch (err: any) {
      setError(err?.message || "Ro'yxatdan o'tish muvaffaqiyatsiz");
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = 'mt-1.5 block h-11 w-full rounded-[10px] border border-gray-200 px-3.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:bg-gray-50 disabled:text-gray-500';
  const labelClass = 'block text-sm font-medium text-gray-700';
  const submitClass = 'inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight text-gray-900">Dashboarduz</span>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm animate-rise-in">
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Tenant akkaunt yarating</h2>
            <p className="mt-2 text-sm text-gray-600">Login va parol bilan ro'yxatdan o'ting</p>

            {error && (
              <div role="alert" className="mt-6 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div>
                <label htmlFor="login" className={labelClass}>
                  Login
                </label>
                <input
                  id="login"
                  type="text"
                  autoComplete="username"
                  required
                  value={loginValue}
                  onChange={(e) => setLoginValue(e.target.value)}
                  className={inputClass}
                  placeholder="your-login"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className={labelClass}>
                  Parol
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Kamida 8 ta belgi"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className={labelClass}>
                  Parolni tasdiqlang
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Parolni qayta kiriting"
                  disabled={isLoading}
                />
              </div>

              <p className="text-xs leading-relaxed text-gray-500">
                Akkaunt yaratishdan oldin bir xil parolni ikki marta kiriting.
              </p>

              <button type="submit" disabled={isLoading} className={submitClass}>
                {isLoading ? 'Akkaunt yaratilmoqda...' : 'Akkaunt yaratish'}
              </button>
            </form>

            <div className="mt-6 border-t border-gray-200 pt-6">
              <p className="text-sm text-gray-600">
                Akkauntingiz bormi?{' '}
                <Link href="/auth/login" className="font-medium text-blue-600 hover:text-blue-700">
                  Kirish
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden p-3 lg:block">
        <div className="relative isolate flex h-full flex-col justify-between overflow-hidden rounded-[24px] bg-slate-950 p-12 text-white xl:p-16">
          <Image
            src="/art/login-glass.webp"
            alt=""
            fill
            priority
            sizes="55vw"
            className="-z-10 object-cover object-right-bottom"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-950/70 via-transparent to-slate-950/80" aria-hidden="true" />

          <p className="max-w-[14ch] text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">
            Savdo, tushum va qo'ng'iroqlar bitta panelda.
          </p>
          <p className="max-w-sm text-base leading-relaxed text-white/80">
            AmoCRM, Telegram, Google Sheets va VoIP xizmatlarini bitta platformada boshqaring.
          </p>
        </div>
      </div>
    </div>
  );
}
