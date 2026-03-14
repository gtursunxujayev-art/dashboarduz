'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const availableRoles = ['Admin', 'Manager', 'Agent'] as const;

export default function UsersPage() {
  const usersQuery = trpc.users.list.useQuery();
  const updateRole = trpc.users.updateRole.useMutation();
  const [error, setError] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, nextRole: (typeof availableRoles)[number]) => {
    setError(null);
    try {
      await updateRole.mutateAsync({
        userId,
        roles: [nextRole],
      });
      await usersQuery.refetch();
    } catch (err: any) {
      setError(err?.message || 'Failed to update role');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-5 border-b border-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">Manage workspace users and roles (Admin only).</p>
        </div>
        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {usersQuery.error && (
            <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {usersQuery.error.message}
            </p>
          )}

          {usersQuery.isLoading ? (
            <p className="text-sm text-gray-600">Loading users...</p>
          ) : usersQuery.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">User</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Login</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Role</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Last Login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {usersQuery.data.map((user: any) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 text-sm text-gray-800">
                        {user.name || user.email || user.phone || 'User'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{user.username || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        <select
                          value={user.roles?.[0] || 'Agent'}
                          onChange={(e) => handleRoleChange(user.id, e.target.value as (typeof availableRoles)[number])}
                          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                          disabled={updateRole.isLoading}
                        >
                          {availableRoles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No users found in this workspace.</p>
          )}
        </div>
      </div>
    </div>
  );
}
