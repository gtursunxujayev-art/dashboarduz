/// <reference types="cypress" />

// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
      loginWithPhone(phone: string, otp: string): Chainable<void>;
      logout(): Chainable<void>;
      navigateToDashboard(): Chainable<void>;
      createMockIntegration(type: string): Chainable<void>;
    }
  }
}

Cypress.Commands.add('login', (email: string, password: string) => {
  cy.visit('/auth/login');
  cy.get('input[name="email"]').type(email);
  cy.get('input[name="password"]').type(password);
  cy.get('button[type="submit"]').click();
  cy.url().should('include', '/dashboard');
});

Cypress.Commands.add('loginWithPhone', (phone: string, otp: string) => {
  cy.visit('/auth/login');
  cy.contains('Phone').click();
  cy.get('input[name="phone"]').type(phone);
  cy.contains('Send OTP').click();
  cy.get('input[name="otp"]').type(otp);
  cy.contains('Verify OTP').click();
  cy.url().should('include', '/dashboard');
});

Cypress.Commands.add('logout', () => {
  cy.get('[data-testid="user-menu"]').click();
  cy.contains('Logout').click();
  cy.url().should('include', '/auth/login');
});

Cypress.Commands.add('navigateToDashboard', () => {
  cy.visit('/dashboard');
  cy.url().should('include', '/dashboard');
});

Cypress.Commands.add('createMockIntegration', (type: string) => {
  cy.intercept('POST', '/api/integrations/connect', {
    statusCode: 200,
    body: { success: true, integrationId: 'mock-id' },
  }).as('connectIntegration');

  cy.visit('/dashboard/integrations');
  cy.contains(type).parents('[data-testid="integration-card"]').within(() => {
    cy.contains('Connect').click();
  });
  cy.wait('@connectIntegration');
});

// Export something to make this file a module
export {};