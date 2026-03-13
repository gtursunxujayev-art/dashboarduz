'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';

export default function Header() {
  const { user } = useAuth();
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  
  // TODO: Fetch tenants for the user
  const tenantsQuery = trpc.integrations.list.useQuery();

  const currentTenant = {
    id: user?.tenantId || '',
    name: 'My Workspace', // TODO: Fetch actual tenant name
    plan: 'Free',
  };

  return (
    <header className="bg-white shadow">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <h2 className="text-lg font-semibold text-gray-900">Dashboard</h2>
            </div>
          </div>
          
          <div className="flex items-center">
            {/* Tenant Switcher */}
            <div className="relative ml-3">
              <div>
                <button
                  onClick={() => setTenantMenuOpen(!tenantMenuOpen)}
                  className="max-w-xs bg-white flex items-center text-sm rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <div className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
                    <div className="flex items-center">
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-700">{currentTenant.name}</p>
                        <p className="text-xs text-gray-500">{currentTenant.plan} Plan</p>
                      </div>
                      <svg className="ml-2 h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </button>
              </div>
              
              {tenantMenuOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-medium text-gray-500">Your Workspaces</p>
                  </div>
                  <div className="py-1">
                    <div className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer">
                      <div className="font-medium">My Workspace</div>
                      <div className="text-xs text-gray-500">Free Plan</div>
                    </div>
                  </div>
                  <div className="border-t border-gray-100 py-1">
                    <button className="w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-100">
                      + Create new workspace
                    </button>
                  </div>
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
                  {user?.email?.split('@')[0] || user?.phone || 'User'}
                </div>
                <div className="text-xs text-gray-500">
                  {user?.roles?.map(role => role.charAt(0).toUpperCase() + role.slice(1)).join(', ')}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
