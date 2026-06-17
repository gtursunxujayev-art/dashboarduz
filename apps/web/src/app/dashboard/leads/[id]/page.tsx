'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lid tafsiloti</h1>
          <p className="mt-1 text-sm text-gray-500">AmoCRM lid ma&apos;lumotlari</p>
        </div>
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Lidlar ro&apos;yxatiga qaytish
        </Link>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          {leadQuery.isLoading ? (
            <LoadingBlock message="Lid ma'lumotlari yuklanmoqda..." />
          ) : leadQuery.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {leadQuery.error.message || "Lid ma'lumotini yuklab bo'lmadi."}
            </p>
          ) : lead ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Lid nomi</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{lead.title || '-'}</p>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">AmoCRM ID</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{lead.amocrmId || '-'}</p>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Pipeline</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{lead.pipelineName || '-'}</p>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Holat</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{lead.status || '-'}</p>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Yaratilgan sana</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDate(lead.createdAt)}</p>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Yangilangan sana</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDate(lead.updatedAt)}</p>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Kontakt</p>
                <p className="mt-1 text-sm text-gray-900">
                  {lead.contact?.name || 'Kontakt nomi yo‘q'}
                  {lead.contact?.phone ? ` · ${lead.contact.phone}` : ''}
                  {lead.contact?.email ? ` · ${lead.contact.email}` : ''}
                </p>
              </div>

              <details className="rounded-md border border-gray-200 bg-white px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                  Raw metadata (AmoCRM)
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
                  {JSON.stringify(lead.metadata || {}, null, 2)}
                </pre>
              </details>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Lid topilmadi.</p>
          )}
        </div>
      </div>
    </div>
  );
}
