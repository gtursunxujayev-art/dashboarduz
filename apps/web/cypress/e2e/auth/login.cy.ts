describe('Authentication Flow', () => {
  beforeEach(() => {
    cy.visit('/auth/login');
  });

  it('should display login page with all authentication options', () => {
    // Check page title
    cy.contains('Dashboarduz').should('be.visible');
    cy.contains('Multi-Tenant CRM Integrator').should('be.visible');

    // Check authentication tabs
    cy.contains('Phone').should('be.visible');
    cy.contains('Google').should('be.visible');
    cy.contains('Telegram').should('be.visible');

    // Phone tab should be active by default
    cy.get('input[name="phone"]').should('be.visible');
    cy.contains('Send OTP').should('be.visible');
  });

  it('should switch between authentication tabs', () => {
    // Switch to Google tab
    cy.contains('Google').click();
    cy.contains('Sign in with Google').should('be.visible');

    // Switch to Telegram tab
    cy.contains('Telegram').click();
    cy.contains('Sign in with Telegram').should('be.visible');

    // Switch back to Phone tab
    cy.contains('Phone').click();
    cy.get('input[name="phone"]').should('be.visible');
  });

  it('should handle phone OTP flow (mock)', () => {
    // Mock the OTP request
    cy.intercept('POST', '/api/auth/request-otp', {
      statusCode: 200,
      body: { success: true },
    }).as('requestOtp');

    // Mock the OTP verification
    cy.intercept('POST', '/api/auth/verify-otp', {
      statusCode: 200,
      body: {
        success: true,
        token: 'mock-jwt-token',
        user: {
          id: '1',
          email: 'test@example.com',
          phone: '+1234567890',
        },
      },
    }).as('verifyOtp');

    // Enter phone number
    cy.get('input[name="phone"]').type('+1234567890');
    cy.contains('Send OTP').click();

    // Wait for OTP request
    cy.wait('@requestOtp');

    // Should show OTP input
    cy.get('input[name="otp"]').should('be.visible');
    cy.contains('Verify OTP').should('be.visible');

    // Enter OTP and verify
    cy.get('input[name="otp"]').type('123456');
    cy.contains('Verify OTP').click();

    // Wait for verification
    cy.wait('@verifyOtp');

    // Should redirect to dashboard
    cy.url().should('include', '/dashboard');
  });

  it('should show error for invalid phone number', () => {
    // Mock failed OTP request
    cy.intercept('POST', '/api/auth/request-otp', {
      statusCode: 400,
      body: { error: 'Invalid phone number' },
    }).as('requestOtpFailed');

    // Enter invalid phone number
    cy.get('input[name="phone"]').type('invalid');
    cy.contains('Send OTP').click();

    // Wait for failed request
    cy.wait('@requestOtpFailed');

    // Should show error message
    cy.contains('Invalid phone number').should('be.visible');
  });

  it('should show error for invalid OTP', () => {
    // Mock successful OTP request
    cy.intercept('POST', '/api/auth/request-otp', {
      statusCode: 200,
      body: { success: true },
    }).as('requestOtp');

    // Mock failed OTP verification
    cy.intercept('POST', '/api/auth/verify-otp', {
      statusCode: 400,
      body: { error: 'Invalid OTP code' },
    }).as('verifyOtpFailed');

    // Enter phone and request OTP
    cy.get('input[name="phone"]').type('+1234567890');
    cy.contains('Send OTP').click();
    cy.wait('@requestOtp');

    // Enter invalid OTP
    cy.get('input[name="otp"]').type('000000');
    cy.contains('Verify OTP').click();

    // Wait for failed verification
    cy.wait('@verifyOtpFailed');

    // Should show error message
    cy.contains('Invalid OTP code').should('be.visible');
  });

  it('should redirect to Google OAuth', () => {
    // Switch to Google tab
    cy.contains('Google').click();
    
    // Click Google login button
    cy.contains('Sign in with Google').click();

    // Should redirect to Google OAuth URL
    cy.url().should('include', '/api/auth/google');
  });

  it('should have responsive design', () => {
    // Test on mobile viewport
    cy.viewport('iphone-x');

    // Check mobile layout
    cy.contains('Phone').should('be.visible');
    cy.get('input[name="phone"]').should('be.visible');

    // Switch back to desktop
    cy.viewport(1280, 720);
  });
});