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
        <p className="mt-1 text-sm text-gray-500">Detailed call metrics and sales activity.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Total Calls</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.totalCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Inbound Calls</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.inboundCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Outbound Calls</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.outboundCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Call Duration</p>
          <p className="text-2xl font-semibold text-gray-900">{Math.round(data.metrics.totalCallDuration || 0)}s</p>
        </div>
      </div>
    </div>
  );
}
