'use client';

import { trpc } from '@/lib/trpc';

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const sellerQuery = trpc.sellers.getById.useQuery({ id: params.id });

  if (sellerQuery.isLoading) {
    return <p className="text-sm text-gray-600">Sotuvchi ma'lumotlari yuklanmoqda...</p>;
  }

  if (!sellerQuery.data) {
    return <p className="text-sm text-red-700">Sotuvchi topilmadi.</p>;
  }

  const data = sellerQuery.data;
  const seller = data.seller;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{seller.name || seller.email || seller.phone || 'Sotuvchi'}</h1>
        <p className="mt-1 text-sm text-gray-500">Qo'ng'iroq metrikalari va sotuv faolligi.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Jami qo'ng'iroqlar</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.totalCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Kiruvchi qo'ng'iroqlar</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.inboundCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Chiquvchi qo'ng'iroqlar</p>
          <p className="text-2xl font-semibold text-gray-900">{data.metrics.outboundCalls}</p>
        </div>
        <div className="rounded-lg bg-white p-4 shadow">
          <p className="text-xs uppercase text-gray-500">Suhbat davomiyligi</p>
          <p className="text-2xl font-semibold text-gray-900">{Math.round(data.metrics.totalCallDuration || 0)} son</p>
        </div>
      </div>
    </div>
  );
}
