'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

const VIRTUALIZE_THRESHOLD = 30;

export default function SellersList({ sellers }: SellersListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Plain list for small data sets
  if (sellers.length < VIRTUALIZE_THRESHOLD) {
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

  return <VirtualizedSellersList sellers={sellers} parentRef={parentRef} />;
}

function VirtualizedSellersList({
  sellers,
  parentRef,
}: {
  sellers: Seller[];
  parentRef: React.RefObject<HTMLDivElement>;
}) {
  const virtualizer = useVirtualizer({
    count: sellers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
  });

  return (
    <div className="bg-white shadow rounded-lg">
      <div
        ref={parentRef}
        className="px-4 py-5 sm:p-6"
        style={{ maxHeight: '80vh', overflow: 'auto' }}
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const seller = sellers[virtualRow.index]!;
            return (
              <div
                key={seller.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="pb-6">
                  <SellerCard seller={seller} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
