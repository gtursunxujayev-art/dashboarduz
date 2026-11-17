'use client';

import { useState } from 'react';
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconClipboardList, IconSearch } from '@tabler/icons-react';
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
  createdAt: string | Date;
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
    <div className="space-y-4">
      {/* Filters */}
      <div className="panel p-3 sm:p-4">
        <div className="relative w-full sm:max-w-sm">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
          <input
            type="text"
            placeholder="Jonli AmoCRM lidlarini qidirish..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="field pl-9"
          />
        </div>
      </div>

      <div className="panel p-2 sm:p-3">
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
                    <div className="text-sm font-medium text-gray-900">
                      {lead.title}
                    </div>
                    {lead.amocrmId && (
                      <div className="tabular mt-0.5 text-xs text-gray-500">
                        AmoCRM: {lead.amocrmId}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    {lead.contact ? (
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={lead.contact.name || lead.contact.phone || lead.contact.email || '?'} size="sm" />
                        <div className="min-w-0">
                          <div className="text-sm text-gray-900">{lead.contact.name}</div>
                          <div className="tabular text-xs text-gray-500">{lead.contact.phone || lead.contact.email}</div>
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
                      <div className="text-xs text-gray-400">{lead.pipelineName}</div>
                    )}
                  </td>
                  <td className="tabular whitespace-nowrap text-sm text-gray-600">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="btn btn-sm btn-secondary"
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
            className="m-1 py-12"
          />
        )}

        {/* Loading State */}
        {leadsQuery.isLoading && (
          <LoadingBlock className="m-1 py-12" message="Lidlar yuklanmoqda..." />
        )}

        {/* Pagination */}
        {pagination && (
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-gray-100 px-2 pb-1 pt-3 sm:px-3">
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
                <span className="tabular min-w-[2rem] text-center text-sm font-medium text-gray-700">{page}</span>
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
      </div>
    </div>
  );
}
