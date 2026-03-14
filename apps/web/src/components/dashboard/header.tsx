'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';

export default function Header() {
  const { user } = useAuth();
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);

  const currentTenant = {
    id: user?.tenantId || '',
    name: 'My Workspace', // TODO: Fetch actual tenant name
    plan: 'Free',
  };

  return (
    <header className="relative z-20 bg-white shadow">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between py-3">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
            </div>
          </div>
          
          <div className="flex items-center">
            {/* Tenant Switcher */}
            <div className="relative ml-3">
              <button
                type="button"
                onClick={() => setTenantMenuOpen((open) => !open)}
                className="max-w-xs bg-white flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                aria-expanded={tenantMenuOpen}
                aria-controls="workspace-panel"
              >
                <div className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
                  <div className="flex items-center">
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-700">{currentTenant.name}</p>
                      <p className="text-xs text-gray-500">{currentTenant.plan} Plan</p>
                    </div>
                    <svg className={`ml-2 h-5 w-5 text-gray-400 transition-transform ${tenantMenuOpen ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
              </button>

              {tenantMenuOpen && (
                <div
                  id="workspace-panel"
                  className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
                >
                  <p className="px-2 py-1 text-xs font-medium text-gray-500">Your Workspaces</p>
                  <button
                    type="button"
                    className="mt-1 w-full rounded-lg px-3 py-3 text-left text-sm text-gray-700 transition hover:bg-gray-100"
                  >
                    <div className="font-medium">My Workspace</div>
                    <div className="text-xs text-gray-500">Free Plan</div>
                  </button>
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-blue-600 transition hover:bg-blue-50"
                  >
                    + Create new workspace
                  </button>
                </div>
              )}
            </div>

            {/* Notifications */}
            <button className="ml-4 p-1 rounded-full text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
              <span className="sr-only">View notifications</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </button>

            {/* User Profile */}
            <div className="ml-4 flex items-center">
              <div className="ml-3">
                <div className="text-sm font-medium text-gray-700">
                  {user?.email?.split('@')[0] || user?.phone || 'Account'}
                </div>
                <div className="text-xs text-gray-500">
                  {user?.roles?.map((role: string) => role.charAt(0).toUpperCase() + role.slice(1)).join(', ')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
