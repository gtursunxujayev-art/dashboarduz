'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const integrations = [
  {
    id: 'amocrm',
    name: 'AmoCRM',
    description: 'Connect your AmoCRM account to sync leads and contacts',
    icon: (
      <svg className="h-8 w-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
    ),
    color: 'bg-blue-50 border-blue-200',
    status: 'disconnected',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: 'Connect Telegram bot for notifications and messaging',
    icon: (
      <svg className="h-8 w-8 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.06-.2-.07-.06-.17-.04-.24-.02-.1.02-1.79 1.12-5.06 3.3-.48.33-.91.49-1.3.48-.43-.01-1.26-.24-1.88-.44-.76-.24-1.36-.37-1.31-.78.03-.24.37-.48 1-.74z"/>
      </svg>
    ),
    color: 'bg-blue-50 border-blue-200',
    status: 'disconnected',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    description: 'Deferred for MVP (Google OAuth disabled)',
    icon: (
      <svg className="h-8 w-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
      </svg>
    ),
    color: 'bg-green-50 border-green-200',
    status: 'disconnected',
  },
  {
    id: 'voip_utel',
    name: 'VoIP (UTeL)',
    description: 'Connect UTeL VoIP for call tracking and recording',
    icon: (
      <svg className="h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    ),
    color: 'bg-purple-50 border-purple-200',
    status: 'disconnected',
  },
];

export default function IntegrationCards() {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const integrationsQuery = trpc.integrations.list.useQuery();
  const connectAmoCRM = trpc.integrations.connectAmoCRM.useMutation();
  const connectTelegram = trpc.integrations.connectTelegram.useMutation();
  const connectVoIP = trpc.integrations.connectVoIP.useMutation();
  const disconnectIntegration = trpc.integrations.disconnect.useMutation();

  // Update integration status from API
  const updatedIntegrations = integrations.map(integration => {
    const apiIntegration = integrationsQuery.data?.find((i: any) => i.type === integration.id);
    return {
      ...integration,
      status: apiIntegration?.status || 'disconnected',
      lastSync: apiIntegration?.lastSyncAt,
    };
  });

  const handleConnect = async (integrationId: string) => {
    setConnecting(integrationId);
    setError(null);

    try {
      switch (integrationId) {
        case 'amocrm':
          // TODO: Implement OAuth2 flow
          window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/api/integrations/amocrm/auth`;
          break;
        case 'telegram':
          const botToken = prompt('Enter your Telegram Bot Token:');
          if (botToken) {
            await connectTelegram.mutateAsync({ botToken });
            await integrationsQuery.refetch();
          }
          break;
        case 'google_sheets':
          setError('Google Sheets integration is disabled in MVP');
          break;
        case 'voip_utel':
          const apiToken = prompt('Enter your UTeL API Token:');
          if (apiToken) {
            await connectVoIP.mutateAsync({ apiToken });
            await integrationsQuery.refetch();
          }
          break;
      }
    } catch (err: any) {
      setError(err.message || `Failed to connect ${integrationId}`);
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    if (confirm(`Are you sure you want to disconnect ${integrationId}?`)) {
      try {
        await disconnectIntegration.mutateAsync({ type: integrationId as any });
        await integrationsQuery.refetch();
      } catch (err: any) {
        setError(err.message || `Failed to disconnect ${integrationId}`);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'pending': return 'text-yellow-600 bg-yellow-100';
      case 'error': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Connected';
      case 'pending': return 'Pending';
      case 'error': return 'Error';
      default: return 'Not Connected';
    }
  };

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {updatedIntegrations.map((integration) => (
          <div
            key={integration.id}
            className={`relative rounded-lg border p-4 ${integration.color}`}
          >
            <div className="flex items-start">
              <div className="flex-shrink-0">
                {integration.icon}
              </div>
              <div className="ml-4 flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-900">
                    {integration.name}
                  </h4>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(integration.status)}`}>
                    {getStatusText(integration.status)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {integration.description}
                </p>
                
                {integration.status === 'active' && integration.lastSync && (
                  <p className="mt-2 text-xs text-gray-500">
                    Last synced: {new Date(integration.lastSync).toLocaleDateString()}
                  </p>
                )}

                <div className="mt-4 flex space-x-3">
                  {integration.status === 'disconnected' ? (
                    <button
                      onClick={() => handleConnect(integration.id)}
                      disabled={connecting === integration.id}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {connecting === integration.id ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Connecting...
                        </>
                      ) : (
                        'Connect'
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => handleDisconnect(integration.id)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Disconnect
                      </button>
                      {integration.status === 'active' && (
                        <button className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                          Configure
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 text-sm text-gray-500">
        <p>Need help setting up integrations? Check our <a href="#" className="text-blue-600 hover:text-blue-500">documentation</a>.</p>
      </div>
    </div>
  );
}
