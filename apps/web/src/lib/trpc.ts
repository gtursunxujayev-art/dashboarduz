import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

// Use any type for now to get the build to pass
type AppRouter = any;

export const trpc = createTRPCReact<AppRouter>() as any;

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
