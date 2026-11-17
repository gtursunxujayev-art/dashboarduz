'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { BrandMark } from '@/components/ui/brand-mark';
import { getPostLoginPath, useAuth } from '@/contexts/auth-context';

type LoginMode = 'otp' | 'password';

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>('otp');

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const router = useRouter();
  const { user, isLoading: isAuthLoading, login } = useAuth();
  const requestOtp = trpc.auth.requestOtp.useMutation();
  const verifyOtp = trpc.auth.verifyOtp.useMutation();
  const loginWithPassword = trpc.auth.loginWithPassword.useMutation();

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (!otpSent) {
        await requestOtp.mutateAsync({ phone });
        setOtpSent(true);
      } else {
        const result = await verifyOtp.mutateAsync({ phone, code: otp });
        if (result.success && result.token && result.user) {
          login(result.token, result.user);
          return;
        }
        setError("OTP kod noto'g'ri");
      }
    } catch (err: any) {
      setError(err?.message || 'Autentifikatsiya muvaffaqiyatsiz');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await loginWithPassword.mutateAsync({
        login: loginValue,
        password,
      });
      if (result.success && result.token && result.user) {
        login(result.token, result.user);
        return;
      }
      setError("Login yoki parol noto'g'ri");
    } catch (err: any) {
      setError(err?.message || 'Autentifikatsiya muvaffaqiyatsiz');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthLoading && user) {
      router.replace(getPostLoginPath(user.roles));
    }
  }, [isAuthLoading, router, user]);

  const inputClass = 'mt-1.5 block h-11 w-full rounded-[10px] border border-gray-200 px-3.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:bg-gray-50 disabled:text-gray-500';
  const labelClass = 'block text-sm font-medium text-gray-700';
  const submitClass = 'inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50';
  const tabClass = (active: boolean) => `h-9 rounded-md px-3 text-sm font-medium ${
    active ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'
  }`;

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-[15px] font-semibold tracking-tight text-gray-900">Dashboarduz</span>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-sm animate-rise-in">
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Dashboarduz ga kirish</h2>
            <p className="mt-2 text-sm text-gray-600">
              Telefon OTP yoki login-parol orqali tizimga kiring
            </p>

            <div className="mt-8 grid grid-cols-2 gap-1 rounded-[10px] bg-gray-200/70 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('otp');
                  setError('');
                }}
                aria-pressed={mode === 'otp'}
                className={tabClass(mode === 'otp')}
              >
                Telefon OTP
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('password');
                  setError('');
                }}
                aria-pressed={mode === 'password'}
                className={tabClass(mode === 'password')}
              >
                Login + Parol
              </button>
            </div>

            {error && (
              <div role="alert" className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {mode === 'otp' ? (
              <form onSubmit={handleOtpSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="phone" className={labelClass}>
                    Telefon raqam
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClass}
                    placeholder="+998993667666"
                    disabled={otpSent || isLoading}
                  />
                </div>

                {otpSent && (
                  <div>
                    <label htmlFor="otp" className={labelClass}>
                      OTP kod
                    </label>
                    <input
                      id="otp"
                      name="otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      className={`${inputClass} tabular tracking-[0.3em]`}
                      placeholder="6 xonali kodni kiriting"
                      maxLength={6}
                      disabled={isLoading}
                    />
                  </div>
                )}

                <button type="submit" disabled={isLoading} className={submitClass}>
                  {isLoading ? 'Bajarilmoqda...' : otpSent ? 'OTP ni tasdiqlash' : 'OTP yuborish'}
                </button>
              </form>
            ) : (
              <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login" className={labelClass}>
                    Login
                  </label>
                  <input
                    id="login"
                    name="login"
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
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                    placeholder="********"
                    disabled={isLoading}
                  />
                </div>

                <button type="submit" disabled={isLoading} className={submitClass}>
                  {isLoading ? 'Kirilmoqda...' : 'Kirish'}
                </button>
              </form>
            )}

            <p className="mt-6 text-xs leading-relaxed text-gray-500">
              Telegram akkauntini bog'lash Integratsiyalar bo'limida kirgandan keyin mavjud.
            </p>

            <div className="mt-6 border-t border-gray-200 pt-6">
              <Link href="/auth/register" className="text-sm font-medium text-blue-600 hover:text-blue-700">
                Yangi tenant akkaunt yaratish
              </Link>
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
