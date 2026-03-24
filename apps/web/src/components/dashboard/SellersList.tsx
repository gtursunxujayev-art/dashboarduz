'use client';

import SellerCard from './SellerCard';

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
    followUpCount: number;
    noteCount: number;
    stageChangeCount: number;
    overdueFollowUpCount: number;
    todayFollowUpCount: number;
  };
}

interface SellersListProps {
  sellers: Seller[];
}

export default function SellersList({ sellers }: SellersListProps) {
  return (
    <div className="bg-white shadow rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <div className="space-y-6">
          {sellers.map((seller) => (
            <SellerCard key={seller.id} seller={seller} />
          ))}
        </div>
      </div>
    </div>
  );
}
