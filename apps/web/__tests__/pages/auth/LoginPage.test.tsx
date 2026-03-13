import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from '@/app/auth/login/page';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

// Mock dependencies
jest.mock('@/lib/trpc');
jest.mock('@/contexts/auth-context');
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

describe('LoginPage', () => {
  const mockTrpc = trpc as jest.Mocked<typeof trpc>;
  const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock auth context
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: jest.fn(),
      logout: jest.fn(),
      isLoading: false,
    });

    // Mock tRPC mutations
    mockTrpc.auth.requestOtp.useMutation.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({ success: true }),
      isLoading: false,
    } as any);

    mockTrpc.auth.verifyOtp.useMutation.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({
        success: true,
        token: 'test-token',
        user: { id: '1', email: 'test@example.com' },
      }),
      isLoading: false,
    } as any);

    mockTrpc.auth.telegramLogin.useMutation.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({ success: true }),
      isLoading: false,
    } as any);
  });

  it('renders login page with phone tab active by default', () => {
    render(<LoginPage />);

    expect(screen.getByText('Phone Login')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
    expect(screen.getByText('Send OTP')).toBeInTheDocument();
  });

  it('switches between login tabs', () => {
    render(<LoginPage />);

    // Click Google tab
    fireEvent.click(screen.getByText('Google'));
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument();

    // Click Telegram tab
    fireEvent.click(screen.getByText('Telegram'));
    expect(screen.getByText('Sign in with Telegram')).toBeInTheDocument();

    // Click back to Phone tab
    fireEvent.click(screen.getByText('Phone'));
    expect(screen.getByLabelText('Phone Number')).toBeInTheDocument();
  });

  it('handles phone number submission and OTP request', async () => {
    const mockRequestOtp = jest.fn().mockResolvedValue({ success: true });
    mockTrpc.auth.requestOtp.useMutation.mockReturnValue({
      mutateAsync: mockRequestOtp,
      isLoading: false,
    } as any);

    render(<LoginPage />);

    // Enter phone number
    const phoneInput = screen.getByLabelText('Phone Number');
    fireEvent.change(phoneInput, { target: { value: '+1234567890' } });

    // Submit form
    const submitButton = screen.getByText('Send OTP');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockRequestOtp).toHaveBeenCalledWith({ phone: '+1234567890' });
    });

    // Should show OTP input after successful request
    expect(screen.getByLabelText('OTP Code')).toBeInTheDocument();
    expect(screen.getByText('Verify OTP')).toBeInTheDocument();
  });

  it('handles OTP verification', async () => {
    const mockVerifyOtp = jest.fn().mockResolvedValue({
      success: true,
      token: 'test-token',
      user: { id: '1', email: 'test@example.com' },
    });
    mockTrpc.auth.verifyOtp.useMutation.mockReturnValue({
      mutateAsync: mockVerifyOtp,
      isLoading: false,
    } as any);

    const mockLogin = jest.fn();
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      login: mockLogin,
      logout: jest.fn(),
      isLoading: false,
    });

    render(<LoginPage />);

    // Simulate OTP sent state by setting phone and showing OTP input
    const phoneInput = screen.getByLabelText('Phone Number');
    fireEvent.change(phoneInput, { target: { value: '+1234567890' } });
    fireEvent.click(screen.getByText('Send OTP'));

    await waitFor(() => {
      expect(screen.getByLabelText('OTP Code')).toBeInTheDocument();
    });

    // Enter OTP
    const otpInput = screen.getByLabelText('OTP Code');
    fireEvent.change(otpInput, { target: { value: '123456' } });

    // Submit OTP
    fireEvent.click(screen.getByText('Verify OTP'));

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        phone: '+1234567890',
        code: '123456',
      });
      expect(mockLogin).toHaveBeenCalledWith('test-token', { id: '1', email: 'test@example.com' });
    });
  });

  it('shows error message when OTP verification fails', async () => {
    const mockVerifyOtp = jest.fn().mockResolvedValue({
      success: false,
      error: 'Invalid OTP',
    });
    mockTrpc.auth.verifyOtp.useMutation.mockReturnValue({
      mutateAsync: mockVerifyOtp,
      isLoading: false,
    } as any);

    render(<LoginPage />);

    // Simulate OTP sent state
    const phoneInput = screen.getByLabelText('Phone Number');
    fireEvent.change(phoneInput, { target: { value: '+1234567890' } });
    fireEvent.click(screen.getByText('Send OTP'));

    await waitFor(() => {
      expect(screen.getByLabelText('OTP Code')).toBeInTheDocument();
    });

    // Enter OTP and submit
    const otpInput = screen.getByLabelText('OTP Code');
    fireEvent.change(otpInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify OTP'));

    await waitFor(() => {
      expect(screen.getByText('Invalid OTP code')).toBeInTheDocument();
    });
  });

  it('handles Google login button click', () => {
    const mockWindowLocation = { href: '' };
    Object.defineProperty(window, 'location', {
      value: mockWindowLocation,
      writable: true,
    });

    render(<LoginPage />);

    // Switch to Google tab
    fireEvent.click(screen.getByText('Google'));
    
    // Click Google login button
    fireEvent.click(screen.getByText('Sign in with Google'));

    expect(window.location.href).toBe('http://localhost:3001/api/auth/google');
  });

  it('shows loading state during OTP request', () => {
    mockTrpc.auth.requestOtp.useMutation.mockReturnValue({
      mutateAsync: jest.fn(),
      isLoading: true,
    } as any);

    render(<LoginPage />);

    expect(screen.getByText('Sending...')).toBeInTheDocument();
  });

  it('shows loading state during OTP verification', () => {
    // First set up OTP sent state
    mockTrpc.auth.requestOtp.useMutation.mockReturnValue({
      mutateAsync: jest.fn().mockResolvedValue({ success: true }),
      isLoading: false,
    } as any);

    mockTrpc.auth.verifyOtp.useMutation.mockReturnValue({
      mutateAsync: jest.fn(),
      isLoading: true,
    } as any);

    render(<LoginPage />);

    // Enter phone and send OTP
    const phoneInput = screen.getByLabelText('Phone Number');
    fireEvent.change(phoneInput, { target: { value: '+1234567890' } });
    fireEvent.click(screen.getByText('Send OTP'));

    // Should show verifying state
    expect(screen.getByText('Verifying...')).toBeInTheDocument();
  });
});