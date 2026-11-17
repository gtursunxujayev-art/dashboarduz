'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import type { Icon } from '@tabler/icons-react';
import {
  IconAddressBook,
  IconArrowLeft,
  IconChevronDown,
  IconCircleDot,
  IconCode,
  IconFileDescription,
  IconHash,
  IconLayoutKanban,
  IconMail,
  IconPhone,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getInitials } from '@/components/ui/user-avatar';
import { UZ_TASHKENT_DATE_TIME, formatDateTime } from '@/lib/format';

function DetailItem({ icon: ItemIcon, label, children }: { icon: Icon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <dt className="flex items-center gap-2.5 text-[13px] font-medium text-gray-500">
        <ItemIcon className="h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} aria-hidden="true" />
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right text-sm font-semibold text-gray-900">{children}</dd>
    </div>
  );
}

/** One point on the vertical timeline in the meta column. */
function TimelineItem({ label, children, last = false }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden="true" className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px bg-gray-200" />}
      <span aria-hidden="true" className="relative mt-1 flex h-[15px] w-[15px] flex-shrink-0 items-center justify-center rounded-full bg-blue-50 ring-1 ring-blue-200">
        <span className="h-[7px] w-[7px] rounded-full bg-blue-600" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-500">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-gray-900">{children}</p>
      </div>
    </li>
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
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Main record column */}
          <div className="min-w-0 space-y-6">
            <section className="panel p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <IconFileDescription className="h-6 w-6" stroke={1.6} />
                  </span>
                  <div className="min-w-0">
                    <p className="caption">Lid nomi</p>
                    <h2 className="mt-1 break-words text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{lead.title || '-'}</h2>
                  </div>
                </div>
                <span className={`badge ${lead.status ? 'badge-blue' : 'badge-neutral'}`}>{lead.status || '-'}</span>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                    <IconAddressBook className="h-4 w-4" stroke={1.8} />
                  </span>
                  <h3 className="section-title">Kontakt</h3>
                </div>
              </div>
              <div className="panel-body">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-700"
                    >
                      {getInitials(lead.contact?.name || lead.contact?.phone || '?')}
                    </span>
                    <p className="min-w-0 break-words text-base font-semibold text-gray-900">
                      {lead.contact?.name || 'Kontakt nomi yo‘q'}
                    </p>
                  </div>
                  {lead.contact?.phone || lead.contact?.email ? (
                    <div className="flex flex-wrap gap-2">
                      {lead.contact?.phone ? (
                        <span className="badge badge-neutral tabular px-3 py-1.5 text-[13px]">
                          <IconPhone className="h-4 w-4 text-gray-500" stroke={1.8} aria-hidden="true" />
                          {lead.contact.phone}
                        </span>
                      ) : null}
                      {lead.contact?.email ? (
                        <span className="badge badge-neutral px-3 py-1.5 text-[13px]">
                          <IconMail className="h-4 w-4 text-gray-500" stroke={1.8} aria-hidden="true" />
                          {lead.contact.email}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <details className="panel group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-gray-700 sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2.5">
                  <IconCode className="h-4 w-4 text-gray-400" stroke={1.8} />
                  Raw metadata (AmoCRM)
                </span>
                <IconChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" stroke={1.8} />
              </summary>
              <div className="px-5 pb-5 sm:px-6">
                <pre className="max-h-80 overflow-auto rounded-[16px] bg-gray-50 p-4 text-xs leading-relaxed text-gray-700">
                  {JSON.stringify(lead.metadata || {}, null, 2)}
                </pre>
              </div>
            </details>
          </div>

          {/* Meta and timeline column */}
          <aside className="min-w-0 space-y-6 xl:sticky xl:top-20">
            <section className="panel">
              <dl className="divide-y divide-gray-100 px-5 py-2 sm:px-6">
                <DetailItem icon={IconHash} label="AmoCRM ID"><span className="tabular">{lead.amocrmId || '-'}</span></DetailItem>
                <DetailItem icon={IconLayoutKanban} label="Pipeline">{lead.pipelineName || '-'}</DetailItem>
                <DetailItem icon={IconCircleDot} label="Holat">{lead.status || '-'}</DetailItem>
              </dl>
            </section>

            <section className="panel p-5 sm:p-6">
              <ol>
                <TimelineItem label="Yaratilgan sana">
                  <span className="tabular">{formatDateTime(lead.createdAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-', invalidText: '-' })}</span>
                </TimelineItem>
                <TimelineItem label="Yangilangan sana" last>
                  <span className="tabular">{formatDateTime(lead.updatedAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-', invalidText: '-' })}</span>
                </TimelineItem>
              </ol>
            </section>
          </aside>
        </div>
      ) : (
        <EmptyState title="Lid topilmadi." icon={IconFileDescription} />
      )}
    </div>
  );
}
