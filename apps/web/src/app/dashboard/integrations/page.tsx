'use client';

import { trpc } from '@/lib/trpc';
import IntegrationCards from '@/components/dashboard/integration-cards';

export default function IntegrationsPage() {
  const listQuery = trpc.integrations.list.useQuery();
  const amocrmIntegration = listQuery.data?.find((integration: any) => integration.type === 'amocrm');
  const utelIntegration = listQuery.data?.find((integration: any) => integration.type === 'voip_utel');

  const amocrmWebhook = `${process.env.NEXT_PUBLIC_API_URL}/webhooks/amocrm`;
  const utelWebhook = String((utelIntegration?.config as any)?.webhookUrl || `${process.env.NEXT_PUBLIC_API_URL}/webhooks/utel`);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your CRM, messaging, and VoIP services to Dashboarduz
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-6">
            <h2 className="text-lg font-medium text-gray-900">Available Integrations</h2>
            <p className="mt-1 text-sm text-gray-500">
              Connect these services to sync data and automate workflows
            </p>
          </div>
          
          <IntegrationCards />
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Webhook Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                AmoCRM Webhook URL
              </label>
              <div className="mt-1 flex rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={amocrmWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(amocrmWebhook)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Add this URL in AmoCRM webhook settings after OAuth connection.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                UTeL Webhook URL
              </label>
              <div className="mt-1 flex rounded-md shadow-sm">
                <input
                  type="text"
                  readOnly
                  value={utelWebhook}
                  className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-l-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <button
                  onClick={() => navigator.clipboard.writeText(utelWebhook)}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-r-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Use the full URL (including integration key) in UTeL webhook settings.
              </p>
            </div>

            {amocrmIntegration?.status === 'pending' && (
              <p className="text-xs text-amber-700">
                AmoCRM is pending authorization. Click Connect in the card above to complete OAuth.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
