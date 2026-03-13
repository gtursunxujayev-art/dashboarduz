'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

export default function RegisterPage() {
  const [step, setStep] = useState<'phone' | 'verify' | 'tenant'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const router = useRouter();
  const { login } = useAuth();
  
  const requestOtp = trpc.auth.requestOtp.useMutation();
  const verifyOtp = trpc.auth.verifyOtp.useMutation();

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await requestOtp.mutateAsync({ phone });
      setStep('verify');
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await verifyOtp.mutateAsync({ phone, code: otp });
      if (result.success && result.user) {
        // If user already exists (returning user), log them in
        if (result.token) {
          login(result.token, result.user);
        } else {
          // New user, proceed to tenant setup
          setStep('tenant');
        }
      } else {
        setError('Invalid OTP code');
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // For now, we'll use the same verify endpoint which creates tenant
      // In a real implementation, we'd have a separate tenant creation endpoint
      const result = await verifyOtp.mutateAsync({ phone, code: otp });
      if (result.success && result.token && result.user) {
        login(result.token, result.user);
      } else {
        setError('Failed to create tenant');
      }
    } catch (err: any) {
      setError(err.message || 'Tenant creation failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create your tenant account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Set up your multi-tenant CRM integration workspace
          </p>
        </div>

        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'phone' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                1
              </div>
              <span className="mt-2 text-xs text-gray-600">Phone</span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-200 mx-2"></div>
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'verify' ? 'bg-blue-600 text-white' : step === 'tenant' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                2
              </div>
              <span className="mt-2 text-xs text-gray-600">Verify</span>
            </div>
            <div className="flex-1 h-0.5 bg-gray-200 mx-2"></div>
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${step === 'tenant' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                3
              </div>
              <span className="mt-2 text-xs text-gray-600">Tenant</span>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Step 1: Phone Input */}
          {step === 'phone' && (
            <form onSubmit={handlePhoneSubmit} className="space-y-4">
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
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="+1234567890"
                  disabled={isLoading}
                />
                <p className="mt-1 text-xs text-gray-500">
                  We'll send a verification code to this number
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending OTP...
                  </span>
                ) : (
                  'Send Verification Code'
                )}
              </button>
            </form>
          )}

          {/* Step 2: OTP Verification */}
          {step === 'verify' && (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-2">
                  Enter the 6-digit code sent to <span className="font-semibold">{phone}</span>
                </p>
                <input
                  id="otp"
                  name="otp"
                  type="text"
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  disabled={isLoading}
                />
                <div className="mt-2 flex justify-between">
                  <button
                    type="button"
                    onClick={() => setStep('phone')}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    Change phone number
                  </button>
                  <button
                    type="button"
                    onClick={handlePhoneSubmit}
                    className="text-sm text-blue-600 hover:text-blue-500"
                  >
                    Resend code
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Verifying...
                  </span>
                ) : (
                  'Verify Code'
                )}
              </button>
            </form>
          )}

          {/* Step 3: Tenant Setup */}
          {step === 'tenant' && (
            <form onSubmit={handleTenantSubmit} className="space-y-4">
              <div>
                <label htmlFor="tenantName" className="block text-sm font-medium text-gray-700">
                  Tenant/Company Name
                </label>
                <input
                  id="tenantName"
                  name="tenantName"
                  type="text"
                  required
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  placeholder="Your Company Name"
                  disabled={isLoading}
                />
                <p className="mt-1 text-xs text-gray-500">
                  This will be your workspace name in Dashboarduz
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <h4 className="text-sm font-medium text-blue-800 mb-2">What you get:</h4>
                <ul className="text-xs text-blue-700 space-y-1">
                  <li className="flex items-start">
                    <svg className="w-4 h-4 mr-1 mt-0.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Multi-tenant CRM integration workspace
                  </li>
                  <li className="flex items-start">
                    <svg className="w-4 h-4 mr-1 mt-0.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Connect AmoCRM, Telegram, Google Sheets, VoIP
                  </li>
                  <li className="flex items-start">
                    <svg className="w-4 h-4 mr-1 mt-0.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Real-time dashboard and analytics
                  </li>
                  <li className="flex items-start">
                    <svg className="w-4 h-4 mr-1 mt-0.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Free plan with basic features
                  </li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating workspace...
                  </span>
                ) : (
                  'Create Workspace'
                )}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Link
                href="/auth/login"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
