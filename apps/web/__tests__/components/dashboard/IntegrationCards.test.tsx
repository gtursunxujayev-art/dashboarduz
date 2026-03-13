import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IntegrationCards from '@/components/dashboard/integration-cards';
import { trpc } from '@/lib/trpc';

// Mock tRPC
jest.mock('@/lib/trpc');

describe('IntegrationCards', () => {
  const mockTrpc = trpc as jest.Mocked<typeof trpc>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock the integrations query
    mockTrpc.integrations.list.useQuery.mockReturnValue({
      data: [
        {
          id: '1',
          type: 'amocrm',
          status: 'connected',
          config: { accountName: 'Test Account' },
          createdAt: new Date().toISOString(),
        },
        {
          id: '2',
          type: 'telegram',
          status: 'disconnected',
          config: {},
          createdAt: new Date().toISOString(),
        },
        {
          id: '3',
          type: 'google_sheets',
          status: 'connected',
          config: { spreadsheetId: 'test-id' },
          createdAt: new Date().toISOString(),
        },
        {
          id: '4',
          type: 'utel',
          status: 'pending',
          config: {},
          createdAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    } as any);
  });

  it('renders integration cards with correct status', () => {
    render(<IntegrationCards />);

    // Check for integration types
    expect(screen.getByText('AmoCRM')).toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
    expect(screen.getByText('UTeL VoIP')).toBeInTheDocument();

    // Check status badges
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('shows loading state when data is loading', () => {
    mockTrpc.integrations.list.useQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: jest.fn(),
    } as any);

    render(<IntegrationCards />);
    expect(screen.getByText('Loading integrations...')).toBeInTheDocument();
  });

  it('shows error state when there is an error', () => {
    mockTrpc.integrations.list.useQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
      refetch: jest.fn(),
    } as any);

    render(<IntegrationCards />);
    expect(screen.getByText('Error loading integrations')).toBeInTheDocument();
  });

  it('handles connect button click for disconnected integrations', () => {
    const mockWindowLocation = { href: '' };
    Object.defineProperty(window, 'location', {
      value: mockWindowLocation,
      writable: true,
    });

    render(<IntegrationCards />);

    // Find and click the connect button for AmoCRM
    const connectButtons = screen.getAllByText('Connect');
    fireEvent.click(connectButtons[0]); // First connect button (AmoCRM)

    expect(window.location.href).toBe('http://localhost:3001/api/integrations/amocrm/auth');
  });

  it('shows disconnect button for connected integrations', () => {
    render(<IntegrationCards />);

    // AmoCRM should show disconnect button since it's connected
    const disconnectButtons = screen.getAllByText('Disconnect');
    expect(disconnectButtons.length).toBeGreaterThan(0);
  });
});