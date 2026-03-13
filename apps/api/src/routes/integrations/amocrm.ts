// AmoCRM OAuth2 routes

import express from 'express';
import { amocrmService } from '../../services/integrations/amocrm';
import { prisma } from '@dashboarduz/db';
import { encryptIntegrationTokens } from '../../services/security/encryption';

const router = express.Router();

// Initiate AmoCRM OAuth flow
router.get('/auth', (req, res) => {
  const state = req.query.state as string || '';
  const authUrl = amocrmService.getAuthUrl(state);
  res.redirect(authUrl);
});

// OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || typeof code !== 'string') {
      throw new Error('Missing authorization code');
    }

    // State format: tenant:{tenantId}
    const tenantId = typeof state === 'string' && state.startsWith('tenant:')
      ? state.split(':')[1]
      : undefined;
    
    if (!tenantId) {
      throw new Error('Tenant ID not found');
    }

    // Exchange code for tokens
    const tokens = await amocrmService.exchangeCode(code);

    // Store tokens (encrypted)
    const encryptedTokens = encryptIntegrationTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
    });

    await prisma.integration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type: 'amocrm',
        },
      },
      update: {
        status: 'active',
        tokensEncrypted: encryptedTokens,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastSyncAt: new Date(),
      },
      create: {
        tenantId,
        type: 'amocrm',
        status: 'active',
        tokensEncrypted: encryptedTokens,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastSyncAt: new Date(),
      },
    });

    // Redirect to frontend
    const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000');
    redirectUrl.searchParams.set('integration', 'amocrm');
    redirectUrl.searchParams.set('status', 'connected');

    res.redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error('[AmoCRM Auth] Callback error:', error);
    
    const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000');
    redirectUrl.searchParams.set('integration', 'amocrm');
    redirectUrl.searchParams.set('status', 'error');
    redirectUrl.searchParams.set('message', error.message);
    
    res.redirect(redirectUrl.toString());
  }
});

export default router;
