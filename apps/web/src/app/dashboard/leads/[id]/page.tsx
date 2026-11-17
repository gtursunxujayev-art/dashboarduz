'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { IconAddressBook, IconArrowLeft, IconChevronDown, IconCode, IconFileDescription } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { UserAvatar } from '@/components/ui/user-avatar';
import { UZ_TASHKENT_DATE_TIME, formatDateTime } from '@/lib/format';

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-[13px] font-medium text-gray-500">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900 sm:text-right">{children}</dd>
    </div>
  );
}

export default function LeadDetailsPage() {
  const params = useParams<{ id: string | string[] }>();
  const leadId = useMemo(() => {
    if (!params?.id) return '';
    return Array.isArray(params.id) ? params.id[0] || '' : params.id;
  }, [params]);

  const leadQuery = trpc.leads.getById.useQuery(
    { id: leadId },
    { enabled: Boolean(leadId), retry: false },
  );

  const lead = leadQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lid tafsiloti"
        description={<>AmoCRM lid ma&apos;lumotlari</>}
        actions={(
          <Link
            href="/dashboard/leads"
            className="btn btn-secondary"
          >
            <IconArrowLeft className="h-4 w-4" stroke={1.8} />
            Lidlar ro&apos;yxatiga qaytish
          </Link>
        )}
      />

      {leadQuery.isLoading ? (
        <div className="panel p-5 sm:p-6">
          <LoadingBlock message="Lid ma'lumotlari yuklanmoqda..." />
        </div>
      ) : leadQuery.error ? (
        <p className="alert alert-error">
          {leadQuery.error.message || "Lid ma'lumotini yuklab bo'lmadi."}
        </p>
      ) : lead ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="panel">
              <div className="panel-header">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                    <IconFileDescription className="h-5 w-5" stroke={1.6} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-500">Lid nomi</p>
                    <h2 className="truncate text-lg font-semibold tracking-tight text-gray-900">{lead.title || '-'}</h2>
                  </div>
                </div>
                <span className={`badge ${lead.status ? 'badge-blue' : 'badge-neutral'}`}>{lead.status || '-'}</span>
              </div>
              <dl className="divide-y divide-gray-100 px-5 pb-2 pt-3 sm:px-6">
                <DetailItem label="AmoCRM ID"><span className="tabular">{lead.amocrmId || '-'}</span></DetailItem>
                <DetailItem label="Pipeline">{lead.pipelineName || '-'}</DetailItem>
                <DetailItem label="Holat">{lead.status || '-'}</DetailItem>
                <DetailItem label="Yaratilgan sana">
                  <span className="tabular">{formatDateTime(lead.createdAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-', invalidText: '-' })}</span>
                </DetailItem>
                <DetailItem label="Yangilangan sana">
                  <span className="tabular">{formatDateTime(lead.updatedAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-', invalidText: '-' })}</span>
                </DetailItem>
              </dl>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gray-100 text-gray-600">
                    <IconAddressBook className="h-4 w-4" stroke={1.8} />
                  </span>
                  <h3 className="section-title">Kontakt</h3>
                </div>
              </div>
              <div className="panel-body">
                <div className="flex items-start gap-3">
                  <UserAvatar name={lead.contact?.name || lead.contact?.phone || '?'} />
                  <p className="min-w-0 break-words pt-1.5 text-sm text-gray-900">
                    {lead.contact?.name || 'Kontakt nomi yo‘q'}
                    {lead.contact?.phone ? ` · ${lead.contact.phone}` : ''}
                    {lead.contact?.email ? ` · ${lead.contact.email}` : ''}
                  </p>
                </div>
              </div>
            </section>
          </div>

          <details className="panel group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-gray-700 sm:px-6 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2.5">
                <IconCode className="h-4 w-4 text-gray-400" stroke={1.8} />
                Raw metadata (AmoCRM)
              </span>
              <IconChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" stroke={1.8} />
            </summary>
            <div className="px-5 pb-5 sm:px-6">
              <pre className="max-h-80 overflow-auto rounded-[10px] bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
                {JSON.stringify(lead.metadata || {}, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      ) : (
        <EmptyState title="Lid topilmadi." icon={IconFileDescription} />
      )}
    </div>
  );
}
