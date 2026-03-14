'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export default function CallsPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const callsQuery = trpc.calls.list.useQuery({
    page: 1,
    limit: 50,
  });
  const clickToCall = trpc.calls.clickToCall.useMutation();

  const submitClickToCall = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const result = await clickToCall.mutateAsync({
        from: from.trim(),
        to: to.trim(),
      });
      setSuccess(`Call started: ${result.callIdExternal}`);
      setFrom('');
      setTo('');
      await callsQuery.refetch();
    } catch (err: any) {
      setError(err?.message || 'Failed to start call');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Call History</h1>
        <p className="mt-1 text-sm text-gray-500">
          View and manage VoIP calls from UTeL and other providers
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <form onSubmit={submitClickToCall} className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="From number"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="To number"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              disabled={clickToCall.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {clickToCall.isLoading ? 'Calling...' : 'Click to Call'}
            </button>
          </form>

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
            <p className="text-sm text-gray-600">No calls yet. Connect UTeL and start or receive calls to populate history.</p>
          )}
        </div>
      </div>
    </div>
  );
}
