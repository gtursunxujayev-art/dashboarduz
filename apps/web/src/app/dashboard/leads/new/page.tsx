'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function NewLeadPage() {
  const router = useRouter();
  const createLead = trpc.leads.create.useMutation();
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const lead = await createLead.mutateAsync({
        title: title.trim(),
        status: status.trim() || undefined,
      });
      router.push(`/dashboard/leads/${lead.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create lead');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Create Lead</h1>
        <p className="mt-1 text-sm text-gray-500">Add a lead manually to your tenant workspace.</p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Lead Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="Lead title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="new / contacted / qualified / lost"
            />
          </div>
          <button
            type="submit"
            disabled={createLead.isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {createLead.isLoading ? 'Creating...' : 'Create Lead'}
          </button>
        </form>
      </div>
    </div>
  );
}
