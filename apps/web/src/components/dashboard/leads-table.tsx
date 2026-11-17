'use client';

import { useState } from 'react';
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconClipboardList, IconFileDescription, IconSearch } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';

interface LeadRow {
  id: string;
  title?: string | null;
  amocrmId?: string | number | null;
  status?: string | null;
  source?: string | null;
  pipelineName?: string | null;
  createdAt: string | Date | null;
  contact?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
}

export default function LeadsTable({ pipelineIds }: { pipelineIds?: string[] }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const leadsQuery = trpc.leads.list.useQuery({
    page,
    limit: 10,
    search: search || undefined,
    pipelineIds: pipelineIds && pipelineIds.length > 0 ? pipelineIds : undefined,
  });

  const leads = leadsQuery.data?.data || [];
  const pagination = leadsQuery.data?.pagination;

  const getStatusColor = (status: string) => status ? 'badge-blue' : 'badge-neutral';

  return (
    <section className="panel overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-3 sm:px-4">
        <div className="relative w-full sm:max-w-sm">
          <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
          <input
            type="text"
            placeholder="Jonli AmoCRM lidlarini qidirish..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field rounded-full pl-10"
          />
        </div>
        {typeof pagination?.total === 'number' ? (
          <span className="badge badge-neutral tabular">{pagination.total}</span>
        ) : null}
      </div>

      <div className="px-2 sm:px-3">
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Lid</th>
                <th scope="col">Kontakt</th>
                <th scope="col">Holat</th>
                <th scope="col">Manba</th>
                <th scope="col">Yaratilgan sana</th>
                <th scope="col" className="text-right">Amal</th>
              </tr>
            </thead>
            <tbody>
              {(leads as LeadRow[]).map((lead) => (
                <tr key={lead.id}>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600" aria-hidden="true">
                        <IconFileDescription className="h-[18px] w-[18px]" stroke={1.6} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium leading-tight text-gray-900">
                          {lead.title}
                        </div>
                        {lead.amocrmId && (
                          <div className="tabular mt-0.5 text-[13px] text-gray-500">
                            AmoCRM: {lead.amocrmId}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {lead.contact ? (
                      <div className="flex items-center gap-3">
                        <UserAvatar name={lead.contact.name || lead.contact.phone || lead.contact.email || '?'} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium leading-tight text-gray-900">{lead.contact.name}</div>
                          <div className="tabular mt-0.5 text-[13px] text-gray-500">{lead.contact.phone || lead.contact.email}</div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">Kontakt yo&apos;q</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className={`badge ${getStatusColor(lead.status || '')}`}>
                      {lead.status || "Noma'lum"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-sm text-gray-600">
                    <div>{lead.source || '-'}</div>
                    {lead.pipelineName && (
                      <div className="mt-0.5 text-[13px] text-gray-400">{lead.pipelineName}</div>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap text-sm text-gray-500">
                    {lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : '-'}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="btn btn-sm btn-ghost"
                    >
                      Ko&apos;rish
                      <IconArrowRight className="h-3.5 w-3.5" stroke={1.8} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {leads.length === 0 && !leadsQuery.isLoading && (
          <EmptyState
            icon={IconClipboardList}
            title="Lidlar topilmadi"
            description="Lidlarni ko'rish uchun AmoCRM ni ulang va webhook yuborishni yoqing."
            className="mb-3 mt-1 py-12"
          />
        )}

        {/* Loading State */}
        {leadsQuery.isLoading && (
          <LoadingBlock className="mb-3 mt-1 py-12" message="Lidlar yuklanmoqda..." />
        )}
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
          <div className="flex flex-1 justify-between sm:hidden">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="btn btn-secondary btn-sm"
            >
              Oldingi
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!pagination.hasMore}
              className="btn btn-secondary btn-sm"
            >
              Keyingi
            </button>
          </div>
          <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
            <div>
              <p className="tabular text-sm text-gray-600">
                <span className="font-medium text-gray-900">{leads.length === 0 ? 0 : (page - 1) * 10 + 1}</span> dan{' '}
                <span className="font-medium text-gray-900">{(page - 1) * 10 + leads.length}</span>
                {typeof pagination.total === 'number' ? (
                  <>
                    {' '} / <span className="font-medium text-gray-900">{pagination.total}</span> ta natija
                  </>
                ) : (
                  " (jonli AmoCRM ma'lumotlari)"
                )}
              </p>
            </div>
            <nav className="flex items-center gap-1.5" aria-label="Pagination">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="btn btn-secondary btn-sm btn-icon w-8"
              >
                <span className="sr-only">Oldingi</span>
                <IconChevronLeft className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              </button>
              <span className="tabular flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-blue-600 px-2 text-sm font-medium text-white">{page}</span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!pagination.hasMore}
                className="btn btn-secondary btn-sm btn-icon w-8"
              >
                <span className="sr-only">Keyingi</span>
                <IconChevronRight className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              </button>
            </nav>
          </div>
        </div>
      )}
    </section>
  );
}
