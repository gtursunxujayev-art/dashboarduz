'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

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

  const { login } = useAuth();
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
        setError('Invalid OTP code');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
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
      setError('Invalid login or password');
    } catch (err: any) {
      setError(err?.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in to Dashboarduz</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Use Phone OTP or sign in with login and password
          </p>
        </div>

        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <div className="mb-6 grid grid-cols-2 gap-2 rounded-md bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('otp');
                setError('');
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium ${mode === 'otp' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >
              Phone OTP
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError('');
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium ${mode === 'password' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}
            >
              Login + Password
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {mode === 'otp' ? (
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                  Phone Number
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="+998993667666"
                  disabled={otpSent || isLoading}
                />
              </div>

              {otpSent && (
                <div>
                  <label htmlFor="otp" className="block text-sm font-medium text-gray-700">
                    OTP Code
                  </label>
                  <input
                    id="otp"
                    name="otp"
                    type="text"
                    required
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    placeholder="Enter 6-digit code"
                    maxLength={6}
                    disabled={isLoading}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 px-4 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? 'Processing...' : otpSent ? 'Verify OTP' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label htmlFor="login" className="block text-sm font-medium text-gray-700">
                  Login
                </label>
                <input
                  id="login"
                  name="login"
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
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="********"
                  disabled={isLoading}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 px-4 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          <p className="mt-4 text-xs text-gray-500 text-center">
            Telegram account linking is available after login in integrations.
          </p>

          <div className="mt-6 text-center">
            <Link href="/auth/register" className="font-medium text-blue-600 hover:text-blue-500">
              Create a new tenant account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
