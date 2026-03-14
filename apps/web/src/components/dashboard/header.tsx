'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';

export default function Header() {
  const { user } = useAuth();
  const tenantQuery = trpc.tenant.get.useQuery(undefined, {
    retry: 1,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const tenantName = tenantQuery.data?.name || 'Workspace';
  const tenantPlan = (tenantQuery.data?.plan || 'free').toString();

  return (
    <header className="relative z-30 border-b border-gray-200 bg-white">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between py-3">
          <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>

          <div className="flex items-center gap-4">
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-left shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-expanded={menuOpen}
              >
                <div className="flex items-center gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{tenantName}</p>
                    <p className="text-xs capitalize text-gray-500">{tenantPlan} plan</p>
                  </div>
                  <svg
                    className={`h-4 w-4 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl">
                  <p className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Workspace</p>
                  <div className="mt-2 rounded-lg border border-gray-100 px-3 py-3">
                    <p className="text-sm font-medium text-gray-800">{tenantName}</p>
                    <p className="text-xs capitalize text-gray-500">{tenantPlan} plan</p>
                  </div>
                </div>
              )}
            </div>

            <button className="rounded-full p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <span className="sr-only">Notifications</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
              </svg>
            </button>

            <div className="text-right">
              <p className="text-sm font-medium text-gray-800">{user?.email?.split('@')[0] || user?.phone || 'Account'}</p>
              <p className="text-xs text-gray-500">
                {user?.roles?.map((role: string) => role.charAt(0).toUpperCase() + role.slice(1)).join(', ')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
