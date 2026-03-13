describe('Dashboard Navigation', () => {
  beforeEach(() => {
    // Mock authentication and navigate to dashboard
    cy.intercept('GET', '/api/auth/me', {
      statusCode: 200,
      body: {
        user: {
          id: '1',
          email: 'test@example.com',
          phone: '+1234567890',
          roles: ['admin'],
        },
      },
    }).as('getUser');

    cy.intercept('GET', '/api/leads*', {
      statusCode: 200,
      body: {
        leads: [],
        total: 0,
        page: 1,
        limit: 10,
      },
    }).as('getLeads');

    cy.intercept('GET', '/api/integrations', {
      statusCode: 200,
      body: [],
    }).as('getIntegrations');

    // Set auth token in localStorage
    cy.window().then((win) => {
      win.localStorage.setItem('auth_token', 'mock-jwt-token');
    });

    cy.visit('/dashboard');
    cy.wait('@getUser');
  });

  it('should display dashboard with all sections', () => {
    // Check dashboard header
    cy.contains('Welcome back').should('be.visible');
    cy.contains('test@example.com').should('be.visible');

    // Check stats cards
    cy.contains('Total Leads').should('be.visible');
    cy.contains('Active Integrations').should('be.visible');
    cy.contains('Pending Notifications').should('be.visible');
    cy.contains('Recent Calls').should('be.visible');

    // Check integration cards
    cy.contains('AmoCRM').should('be.visible');
    cy.contains('Telegram').should('be.visible');
    cy.contains('Google Sheets').should('be.visible');
    cy.contains('UTeL VoIP').should('be.visible');

    // Check recent leads section
    cy.contains('Recent Leads').should('be.visible');
  });

  it('should navigate to leads page', () => {
    // Click leads in sidebar
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Leads').click();
    });

    // Should navigate to leads page
    cy.url().should('include', '/dashboard/leads');
    cy.contains('All Leads').should('be.visible');
    cy.contains('Create Lead').should('be.visible');
  });

  it('should navigate to integrations page', () => {
    // Click integrations in sidebar
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Integrations').click();
    });

    // Should navigate to integrations page
    cy.url().should('include', '/dashboard/integrations');
    cy.contains('Integration Settings').should('be.visible');
  });

  it('should navigate to calls page', () => {
    // Click calls in sidebar
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Calls').click();
    });

    // Should navigate to calls page
    cy.url().should('include', '/dashboard/calls');
    cy.contains('Call History').should('be.visible');
  });

  it('should navigate to notifications page', () => {
    // Click notifications in sidebar
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Notifications').click();
    });

    // Should navigate to notifications page
    cy.url().should('include', '/dashboard/notifications');
    cy.contains('Notification Queue').should('be.visible');
  });

  it('should navigate to analytics page', () => {
    // Click analytics in sidebar
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Analytics').click();
    });

    // Should navigate to analytics page
    cy.url().should('include', '/dashboard/analytics');
    cy.contains('Performance Metrics').should('be.visible');
  });

  it('should handle user menu actions', () => {
    // Click user menu
    cy.get('[data-testid="user-menu"]').click();

    // Check menu options
    cy.contains('Profile').should('be.visible');
    cy.contains('Settings').should('be.visible');
    cy.contains('Logout').should('be.visible');

    // Click logout
    cy.contains('Logout').click();

    // Should redirect to login page
    cy.url().should('include', '/auth/login');
  });

  it('should be responsive on mobile', () => {
    // Switch to mobile view
    cy.viewport('iphone-x');

    // Check mobile sidebar toggle
    cy.get('[data-testid="mobile-menu-toggle"]').should('be.visible').click();
    
    // Check sidebar is visible
    cy.get('[data-testid="sidebar"]').should('be.visible');

    // Click a menu item
    cy.get('[data-testid="sidebar"]').within(() => {
      cy.contains('Leads').click();
    });

    // Should navigate to leads page
    cy.url().should('include', '/dashboard/leads');

    // Switch back to desktop
    cy.viewport(1280, 720);
  });

  it('should display integration status correctly', () => {
    // Mock integrations data
    cy.intercept('GET', '/api/integrations', {
      statusCode: 200,
      body: [
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
      ],
    }).as('getIntegrationsWithData');

    // Reload page to get new integrations data
    cy.reload();
    cy.wait('@getIntegrationsWithData');

    // Check integration status
    cy.contains('AmoCRM').parents('[data-testid="integration-card"]').within(() => {
      cy.contains('Connected').should('be.visible');
      cy.contains('Disconnect').should('be.visible');
    });

    cy.contains('Telegram').parents('[data-testid="integration-card"]').within(() => {
      cy.contains('Disconnected').should('be.visible');
      cy.contains('Connect').should('be.visible');
    });
  });
});