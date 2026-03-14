'use client';

import { trpc } from '@/lib/trpc';

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const sellerQuery = trpc.sellers.getById.useQuery({ id: params.id });

  if (sellerQuery.isLoading) {
    return <p className="text-sm text-gray-600">Loading seller details...</p>;
  }

  if (!sellerQuery.data) {
    return <p className="text-sm text-red-700">Seller not found.</p>;
  }

  const data = sellerQuery.data;
  const seller = data.seller;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{seller.name || seller.email || seller.phone || 'Seller'}</h1>
        <p className="mt-1 text-sm text-gray-500">Detailed metrics, leads, and call activity.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Total Leads</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.totalLeads}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Won Leads</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.wonLeads}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Total Calls</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.totalCalls}</p>
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <h2 className="text-lg font-semibold text-gray-900">Recent Leads</h2>
        {data.recentLeads.length ? (
          <ul className="mt-3 space-y-2">
            {data.recentLeads.map((lead: any) => (
              <li key={lead.id} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
                <p className="font-medium text-gray-800">{lead.title}</p>
                <p className="text-xs text-gray-500">Status: {lead.status || '-'}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No recent leads.</p>
        )}
      </div>
    </div>
  );
}
