'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function CallsPage() {
  const [error, setError] = useState<string | null>(null);

  const callsQuery = trpc.calls.list.useQuery({
    page: 1,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Call History</h1>
        <p className="mt-1 text-sm text-gray-500">
          View inbound and webhook-ingested VoIP calls from UTeL
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            UTeL is configured in webhook-only mode. Click-to-call is disabled.
          </p>

          {callsQuery.isLoading ? (
            <p className="text-sm text-gray-600">Loading calls...</p>
          ) : callsQuery.data?.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Call ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">From</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">To</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Duration</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Lead</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Started</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {callsQuery.data.data.map((call: any) => (
                    <tr key={call.id}>
                      <td className="px-4 py-3 text-xs text-gray-700">{call.callIdExternal}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{call.from}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{call.to}</td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-700">{call.status}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{call.duration ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{call.lead?.title || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{new Date(call.startedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No calls yet. Connect UTeL webhook and send call events to populate history.</p>
          )}
        </div>
      </div>
    </div>
  );
}
