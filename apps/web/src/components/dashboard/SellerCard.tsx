'use client';

import Link from 'next/link';

interface Seller {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
  metrics: {
    totalLeads: number;
    activeLeads: number;
    wonLeads: number;
    lostLeads: number;
    conversionRate: number;
    totalDealAmount: number;
    averageDealAmount: number;
    totalCalls: number;
    inboundCalls: number;
    outboundCalls: number;
    totalCallDuration: number;
    averageCallDuration: number;
  };
}

interface SellerCardProps {
  seller: Seller;
}

export default function SellerCard({ seller }: SellerCardProps) {
  const displayName = seller.name || seller.email || seller.phone || 'Noma\'lum';
  const lastLogin = seller.lastLoginAt 
    ? new Date(seller.lastLoginAt).toLocaleDateString('uz-UZ', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Hech qachon';

  return (
    <div className="border border-gray-200 rounded-lg p-6 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex-shrink-0">
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-blue-600 font-semibold text-lg">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">{displayName}</h3>
            <div className="flex items-center space-x-2 mt-1">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {seller.roles.join(', ')}
              </span>
              <span className="text-sm text-gray-500">
                Oxirgi kirish: {lastLogin}
              </span>
            </div>
            <div className="mt-2 flex space-x-4 text-sm text-gray-500">
              {seller.email && (
                <span className="flex items-center">
                  <svg className="mr-1.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  {seller.email}
                </span>
              )}
              {seller.phone && (
                <span className="flex items-center">
                  <svg className="mr-1.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {seller.phone}
                </span>
              )}
            </div>
          </div>
        </div>
        <Link
          href={`/dashboard/sotuvchilar/${seller.id}`}
          className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Batafsil
        </Link>
      </div>

      {/* Metrics Grid */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-100 rounded-md p-2">
              <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">{seller.metrics.totalCalls}</p>
              <p className="text-xs text-gray-500">Jami qo&apos;ng&apos;iroqlar</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-100 rounded-md p-2">
              <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">{seller.metrics.inboundCalls}</p>
              <p className="text-xs text-gray-500">Kiruvchi qo&apos;ng&apos;iroqlar</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-purple-100 rounded-md p-2">
              <svg className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">{seller.metrics.outboundCalls}</p>
              <p className="text-xs text-gray-500">Chiquvchi qo&apos;ng&apos;iroqlar</p>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-yellow-100 rounded-md p-2">
              <svg className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">
                {seller.metrics.averageDealAmount.toLocaleString()} UZS
              </p>
              <p className="text-xs text-gray-500">O'rtacha Sotuv</p>
            </div>
          </div>
        </div>
      </div>

      {/* Additional Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Qabul qilingan qo'ng'iroqlar:</span>
          <span className="font-medium">{seller.metrics.inboundCalls}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Amalga oshirilgan qo'ng'iroqlar:</span>
          <span className="font-medium">{seller.metrics.outboundCalls}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">O'rtacha qo'ng'iroq davomiyligi:</span>
          <span className="font-medium">{Math.round(seller.metrics.averageCallDuration)}s</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Jami sotuv summasi:</span>
          <span className="font-medium">{seller.metrics.totalDealAmount.toLocaleString()} UZS</span>
        </div>
      </div>
    </div>
  );
}
