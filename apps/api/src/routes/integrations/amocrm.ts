import express from 'express';
import { amocrmService } from '../../services/integrations/amocrm';
import { prisma } from '@dashboarduz/db';
import { encryptIntegrationTokens } from '../../services/security/encryption';
import { verifySignedAmoCRMState } from '../../services/integrations/oauth-state';

const router = express.Router();

function normalizeBaseUrl(url?: string): string | null {
  if (!url) {
    return null;
  }
  return url.replace(/\/+$/, '');
}

function getFrontendBaseUrl(): string {
  const explicit = normalizeBaseUrl(process.env.FRONTEND_URL || process.env.CORS_ORIGIN);
  if (explicit) {
    return explicit;
  }
  return 'http://localhost:3000';
}

router.get('/auth', (req, res) => {
  const state = req.query.state as string | undefined;
  if (!state) {
    return res.status(400).json({ error: 'Missing OAuth state' });
  }

  const authUrl = amocrmService.getAuthUrl(state);
  return res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code) {
      throw new Error('Missing authorization code');
    }
    if (!state) {
      throw new Error('Missing OAuth state');
    }

    const verifiedState = verifySignedAmoCRMState(state);
    const tenantId = verifiedState.tenantId;

    const tokens = await amocrmService.exchangeCode(code);
    const accountInfo = await amocrmService.fetchAccountInfo(tokens.access_token);
    const accountId = accountInfo.id ? String(accountInfo.id) : undefined;

    await prisma.integration.upsert({
      where: {
        tenantId_type: {
          tenantId,
          type: 'amocrm',
        },
      },
      update: {
        status: 'active',
        tokensEncrypted: encryptIntegrationTokens({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
        }),
        refreshToken: encryptIntegrationTokens({ refresh_token: tokens.refresh_token }),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastSyncAt: new Date(),
        config: {
          account_id: accountId || null,
          account_name: accountInfo.name || null,
          domain: accountInfo.domain || null,
          subdomain: accountInfo.subdomain || null,
          connectedAt: new Date().toISOString(),
        },
        errorMessage: null,
      },
      create: {
        tenantId,
        type: 'amocrm',
        status: 'active',
        tokensEncrypted: encryptIntegrationTokens({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          token_type: tokens.token_type,
        }),
        refreshToken: encryptIntegrationTokens({ refresh_token: tokens.refresh_token }),
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastSyncAt: new Date(),
        config: {
          account_id: accountId || null,
          account_name: accountInfo.name || null,
          domain: accountInfo.domain || null,
          subdomain: accountInfo.subdomain || null,
          connectedAt: new Date().toISOString(),
        },
      },
    });

    const redirectUrl = new URL(`${getFrontendBaseUrl()}/dashboard/integrations`);
    redirectUrl.searchParams.set('integration', 'amocrm');
    redirectUrl.searchParams.set('status', 'connected');
    return res.redirect(redirectUrl.toString());
  } catch (error: any) {
    console.error('[AmoCRM Auth] Callback error:', error);
    const redirectUrl = new URL(`${getFrontendBaseUrl()}/dashboard/integrations`);
    redirectUrl.searchParams.set('integration', 'amocrm');
    redirectUrl.searchParams.set('status', 'error');
    redirectUrl.searchParams.set('message', error.message || 'auth_failed');
    return res.redirect(redirectUrl.toString());
  }
});

export default router;
