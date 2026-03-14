import React from 'react';
import { render, screen } from '@testing-library/react';
import ProtectedRoute from '@/components/auth/protected-route';
import { useAuth } from '@/contexts/auth-context';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

jest.mock('@/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

const useAuthMock = useAuth as jest.Mock;

describe('ProtectedRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children when user is authenticated', () => {
    useAuthMock.mockReturnValue({
      user: { userId: '1', tenantId: 't1', roles: ['Admin'] },
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
      refreshUser: jest.fn(),
    });

    render(
      <ProtectedRoute>
        <div data-testid="content">Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows loading state while auth is loading', () => {
    useAuthMock.mockReturnValue({
      user: null,
      isLoading: true,
      login: jest.fn(),
      logout: jest.fn(),
      refreshUser: jest.fn(),
    });

    render(
      <ProtectedRoute>
        <div data-testid="content">Protected Content</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
