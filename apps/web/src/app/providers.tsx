'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';
import { trpc, trpcClient } from '@/lib/trpc';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));

    const [trpcClientState] = useState(() => {
    try {
      const { createTRPCClient } = require('@/lib/trpc');
      return createTRPCClient();
    } catch (error) {
      console.error('Failed to create TRPC client:', error);
      // Return a mock client for SSR
      return {
        queryClient: queryClient,
        // Add minimal mock methods
        $request: () => Promise.resolve({}),
      } as any;
    }
  });

  return (
    <trpc.Provider client={trpcClientState} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
