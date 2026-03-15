'use client';

import { trpc } from '@/lib/trpc';

export default function LeadDetailsPage({ params }: { params: { id: string } }) {
  const leadQuery = trpc.leads.getById.useQuery({ id: params.id });

  if (leadQuery.isLoading) {
    return <p className="text-sm text-gray-600">Loading lead...</p>;
  }

  if (leadQuery.error || !leadQuery.data) {
    return <p className="text-sm text-red-700">Lead not found.</p>;
  }

  const lead = leadQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{lead.title}</h1>
        <p className="mt-1 text-sm text-gray-500">Live AmoCRM lead details.</p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-gray-500">Status</dt>
            <dd className="text-sm text-gray-800">{lead.status || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">AmoCRM ID</dt>
            <dd className="text-sm text-gray-800">{lead.amocrmId || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Pipeline</dt>
            <dd className="text-sm text-gray-800">{lead.pipelineName || lead.pipelineId || '-'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Created</dt>
            <dd className="text-sm text-gray-800">{new Date(lead.createdAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-gray-500">Updated</dt>
            <dd className="text-sm text-gray-800">{new Date(lead.updatedAt).toLocaleString()}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
