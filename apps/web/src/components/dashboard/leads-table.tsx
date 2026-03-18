'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';

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

  const getStatusColor = (status: string) => status ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800';

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
        <div className="flex space-x-2">
          <input
            type="text"
            placeholder="Jonli AmoCRM lidlarini qidirish..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Lid
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Kontakt
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Holat
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Manba
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Yaratilgan sana
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Amal
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {leads.map((lead: any) => (
              <tr key={lead.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {lead.title}
                      </div>
                      {lead.amocrmId && (
                        <div className="text-xs text-gray-500">
                          AmoCRM: {lead.amocrmId}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {lead.contact ? (
                    <div>
                      <div className="text-sm text-gray-900">{lead.contact.name}</div>
                      <div className="text-xs text-gray-500">{lead.contact.phone || lead.contact.email}</div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">Kontakt yo&apos;q</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(lead.status || '')}`}>
                    {lead.status || "Noma'lum"}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div>{lead.source || '-'}</div>
                  {lead.pipelineName && (
                    <div className="text-xs text-gray-400">{lead.pipelineName}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(lead.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    Ko&apos;rish
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex-1 flex justify-between sm:hidden">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
              className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Oldingi
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={!pagination.hasMore}
              className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keyingi
            </button>
          </div>
          <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-gray-700">
                <span className="font-medium">{leads.length === 0 ? 0 : (page - 1) * 10 + 1}</span> dan{' '}
                <span className="font-medium">{(page - 1) * 10 + leads.length}</span>
                {typeof pagination.total === 'number' ? (
                  <>
                    {' '} / <span className="font-medium">{pagination.total}</span> ta natija
                  </>
                ) : (
                  " (jonli AmoCRM ma'lumotlari)"
                )}
              </p>
            </div>
            <div>
              <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Oldingi</span>
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={!pagination.hasMore}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="sr-only">Keyingi</span>
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {leads.length === 0 && !leadsQuery.isLoading && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">Lidlar topilmadi</h3>
          <p className="mt-1 text-sm text-gray-500">
            Lidlarni ko'rish uchun AmoCRM ni ulang va webhook yuborishni yoqing.
          </p>
        </div>
      )}

      {/* Loading State */}
      {leadsQuery.isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Lidlar yuklanmoqda...</p>
        </div>
      )}
    </div>
  );
}
