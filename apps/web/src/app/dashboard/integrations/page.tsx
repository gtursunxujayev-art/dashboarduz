'use client';

import { trpc } from '@/lib/trpc';
import IntegrationCards from '@/components/dashboard/integration-cards';

export default function IntegrationsPage() {
  const listQuery = trpc.integrations.list.useQuery();
  const utelIntegration = listQuery.data?.find((integration: any) => integration.type === 'voip_utel');
  const faceIdIntegration = listQuery.data?.find((integration: any) => integration.type === 'faceid_attendance');

  const amocrmWebhook = `${process.env.NEXT_PUBLIC_API_URL}/webhooks/amocrm`;
  const utelWebhook = String((utelIntegration?.config as any)?.webhookUrl || `${process.env.NEXT_PUBLIC_API_URL}/webhooks/utel`);
  const faceIdWebhook = String((faceIdIntegration?.config as any)?.webhookUrl || `${process.env.NEXT_PUBLIC_API_URL}/webhooks/faceid`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Integratsiyalar</h1>
        <p className="mt-1 text-sm text-gray-500">
          CRM, xabarnoma va VoIP xizmatlarini Dashboarduz ga ulang
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900">Mavjud integratsiyalar</h2>
            <p className="mt-1 text-sm text-gray-500">
              Ma'lumotlarni sinxronlash va jarayonlarni avtomatlashtirish uchun xizmatlarni ulang
            </p>
          </div>
          
          <IntegrationCards />
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Webhook sozlamalari</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                AmoCRM webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={amocrmWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(amocrmWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Token orqali ulanganidan keyin shu URL ni AmoCRM webhook sozlamasiga qo'shing.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                UTeL webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={utelWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(utelWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                UTeL webhook sozlamasida to'liq URL dan foydalaning (integration key bilan).
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Face ID webhook manzili
              </label>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-0 rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={faceIdWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md sm:rounded-none sm:rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(faceIdWebhook)}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md sm:rounded-r-md sm:rounded-l-none text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Nusxalash
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Face ID webhook POST so'rovlari ushbu URL ga yuboriladi.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
