describe('Authentication UI (MVP)', () => {
  beforeEach(() => {
    cy.visit('/auth/login');
  });

  it('shows OTP mode by default', () => {
    cy.contains('Sign in to Dashboarduz').should('be.visible');
    cy.contains('Phone OTP').should('be.visible');
    cy.get('input[name="phone"]').should('be.visible');
    cy.contains('Send OTP').should('be.visible');
  });

  it('switches to login/password mode', () => {
    cy.contains('Login + Password').click();
    cy.get('input[name="login"]').should('be.visible');
    cy.get('input[name="password"]').should('be.visible');
    cy.contains('Sign in').should('be.visible');
  });

  it('has register navigation', () => {
    cy.contains('Create a new tenant account')
      .should('be.visible')
      .and('have.attr', 'href', '/auth/register');
  });
});
