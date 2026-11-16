import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardAccessGuard from '@/components/auth/dashboard-access-guard';
import { useAuth } from '@/contexts/auth-context';

const replaceMock = jest.fn();
let pathnameMock = '/dashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
  usePathname: () => pathnameMock,
}));

jest.mock('@/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

const useAuthMock = useAuth as jest.Mock;

function renderAs(roles: string[], pathname: string) {
  pathnameMock = pathname;
  useAuthMock.mockReturnValue({
    user: { userId: '1', tenantId: 't1', roles },
    isLoading: false,
  });
  return render(
    <DashboardAccessGuard>
      <div data-testid="content">Content</div>
    </DashboardAccessGuard>,
  );
}

describe('DashboardAccessGuard income-debug', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lets admins open /dashboard/income-debug', () => {
    renderAs(['Admin'], '/dashboard/income-debug');
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each([
    [['Manager']],
    [['Finance']],
    [['Finance', 'Agent']],
  ])('redirects %j away from /dashboard/income-debug', (roles) => {
    renderAs(roles, '/dashboard/income-debug');
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });

  it('leaves other pages unchanged for non-admin privileged users', () => {
    renderAs(['Finance', 'Agent'], '/dashboard/income');
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });
});
