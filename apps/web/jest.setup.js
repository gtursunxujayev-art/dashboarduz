// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: jest.fn(),
      replace: jest.fn(),
      prefetch: jest.fn(),
      back: jest.fn(),
    };
  },
  usePathname() {
    return '';
  },
  useSearchParams() {
    return new URLSearchParams();
  },
}));

// Mock tRPC
jest.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      requestOtp: {
        useMutation: () => ({
          mutateAsync: jest.fn(),
          isLoading: false,
        }),
      },
      verifyOtp: {
        useMutation: () => ({
          mutateAsync: jest.fn(),
          isLoading: false,
        }),
      },
      telegramLogin: {
        useMutation: () => ({
          mutateAsync: jest.fn(),
          isLoading: false,
        }),
      },
    },
    leads: {
      list: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: null,
        }),
      },
    },
    integrations: {
      list: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

// Mock auth context
jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: null,
    token: null,
    login: jest.fn(),
    logout: jest.fn(),
    isLoading: false,
  }),
  AuthProvider: ({ children }) => children,
}));

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});