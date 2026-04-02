import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@dashboarduz/api-types';

export const trpc: CreateTRPCReact<AppRouter, unknown, null> = createTRPCReact<AppRouter>();

function normalizeBaseUrl(url?: string) {
  return (url || 'http://localhost:3001').replace(/\/+$/, '');
}

export function createTRPCClient() {
  const apiBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${apiBaseUrl}/api/trpc`,
        headers() {
          const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
          return {
            Authorization: token ? `Bearer ${token}` : '',
          };
        },
      }),
    ],
    transformer: superjson,
  });
}

export const trpcClient = typeof window !== 'undefined' ? createTRPCClient() : null as any;

export type { AppRouter };
