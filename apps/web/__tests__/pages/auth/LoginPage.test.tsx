import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import LoginPage from '@/app/auth/login/page';
import { useAuth } from '@/contexts/auth-context';

const requestOtpMutate = jest.fn();
const verifyOtpMutate = jest.fn();
const loginWithPasswordMutate = jest.fn();

jest.mock('@/contexts/auth-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/trpc', () => ({
  trpc: {
    auth: {
      requestOtp: {
        useMutation: () => ({
          mutateAsync: requestOtpMutate,
        }),
      },
      verifyOtp: {
        useMutation: () => ({
          mutateAsync: verifyOtpMutate,
        }),
      },
      loginWithPassword: {
        useMutation: () => ({
          mutateAsync: loginWithPasswordMutate,
        }),
      },
    },
  },
}));

const useAuthMock = useAuth as jest.Mock;

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthMock.mockReturnValue({
      user: null,
      isLoading: false,
      login: jest.fn(),
      logout: jest.fn(),
      refreshUser: jest.fn(),
    });
  });

  it('renders otp and password tabs', () => {
    render(<LoginPage />);
    expect(screen.getByText('Phone OTP')).toBeInTheDocument();
    expect(screen.getByText('Login + Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
  });

  it('switches to password mode', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Login + Password'));
    expect(screen.getByLabelText('Login')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
