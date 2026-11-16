import { systemPrisma, type DbClient } from '@dashboarduz/db';

import { parseFloatOrZero } from '../../lib/object';
import { decryptIntegrationTokens } from '../security/encryption';

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

type MetaTokens = {
  accessToken?: string;
  access_token?: string;
};

type MetaInsightRow = {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  spend?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
};

export type NormalizedMetaInsight = {
  date: Date;
  accountId: string;
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
  adId: string;
  adName: string | null;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  raw: unknown;
};

function toInteger(value: unknown): number {
  return Math.max(0, Math.round(parseFloatOrZero(value)));
}

function formatDateKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseMetaDate(dateKey: string | undefined): Date {
  const safeKey = /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || '')) ? String(dateKey) : formatDateKey(new Date());

  return new Date(`${safeKey}T00:00:00.000Z`);
}

export function normalizeMetaAdAccountId(input: string): string {
  const trimmed = String(input || '').trim();

  if (!trimmed) {
    return '';
  }

  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed.replace(/^act_/, '')}`;
}

function getLeadCount(actions: MetaInsightRow['actions']): number {
  if (!Array.isArray(actions)) {
    return 0;
  }

  return actions.reduce((total, action) => {
    const type = String(action.action_type || '').toLowerCase();

    if (type === 'lead' || type.includes('lead')) {
      return total + toInteger(action.value);
    }

    return total;
  }, 0);
}

async function metaGet<T>(path: string, params: Record<string, string>, accessToken: string): Promise<T> {
  const search = new URLSearchParams({
    ...params,
    access_token: accessToken,
  });
  const response = await fetch(`${META_API_BASE}/${path}?${search.toString()}`);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body?.error?.message === 'string'
      ? body.error.message
      : `Meta API request failed with status ${response.status}`;

    throw new Error(message);
  }

  return body as T;
}

export async function validateMetaAdAccount(accessToken: string, adAccountId: string) {
  const accountPath = normalizeMetaAdAccountId(adAccountId);

  return metaGet<{
    id?: string;
    name?: string;
    account_status?: number;
    currency?: string;
  }>(accountPath, { fields: 'id,name,account_status,currency' }, accessToken);
}

async function fetchMetaInsights(
  accessToken: string,
  adAccountId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<NormalizedMetaInsight[]> {
  const accountPath = normalizeMetaAdAccountId(adAccountId);
  const accountId = accountPath.replace(/^act_/, '');
  const fields = [
    'date_start',
    'date_stop',
    'campaign_id',
    'campaign_name',
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
    'impressions',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'spend',
    'actions',
  ].join(',');

  const rows: NormalizedMetaInsight[] = [];
  let nextUrl: string | null = null;

  do {
    let payload: { data?: MetaInsightRow[]; paging?: { next?: string } };

    if (nextUrl) {
      payload = await fetch(nextUrl).then(async (response) => {
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(String(body?.error?.message || `Meta API request failed with status ${response.status}`));
        }

        return body as { data?: MetaInsightRow[]; paging?: { next?: string } };
      });
    } else {
      payload = await metaGet<{ data?: MetaInsightRow[]; paging?: { next?: string } }>(
        `${accountPath}/insights`,
        {
          fields,
          level: 'ad',
          time_increment: '1',
          limit: '500',
          time_range: JSON.stringify({
            since: formatDateKey(dateFrom),
            until: formatDateKey(dateTo),
          }),
        },
        accessToken,
      );
    }

    for (const row of payload.data || []) {
      rows.push({
        date: parseMetaDate(row.date_start),
        accountId,
        campaignId: row.campaign_id || '',
        campaignName: row.campaign_name || null,
        adSetId: row.adset_id || '',
        adSetName: row.adset_name || null,
        adId: row.ad_id || '',
        adName: row.ad_name || null,
        impressions: toInteger(row.impressions),
        clicks: toInteger(row.clicks),
        spend: parseFloatOrZero(row.spend),
        ctr: parseFloatOrZero(row.ctr),
        cpc: parseFloatOrZero(row.cpc),
        cpm: parseFloatOrZero(row.cpm),
        leads: getLeadCount(row.actions),
        raw: row,
      });
    }
    nextUrl = payload.paging?.next || null;
  } while (nextUrl);

  return rows;
}

export async function syncMetaAdInsightsForTenant(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
  db: DbClient = systemPrisma,
) {
  const integration = await db.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'meta_ads',
      },
    },
  });

  if (!integration || integration.status !== 'active' || !integration.tokensEncrypted) {
    throw new Error('Meta Ads integration is not connected.');
  }

  const config = (integration.config || {}) as Record<string, unknown>;
  const tokens = decryptIntegrationTokens<MetaTokens>(integration.tokensEncrypted);
  const accessToken = String(tokens.accessToken || tokens.access_token || '').trim();
  const adAccountId = String(config.adAccountId || config.accountId || '').trim();

  if (!accessToken || !adAccountId) {
    throw new Error('Meta Ads integration is missing token or ad account id.');
  }

  const insights = await fetchMetaInsights(accessToken, adAccountId, dateFrom, dateTo);
  let imported = 0;

  for (const insight of insights) {
    const data = {
      campaignName: insight.campaignName,
      adSetName: insight.adSetName,
      adName: insight.adName,
      impressions: insight.impressions,
      clicks: insight.clicks,
      spend: insight.spend,
      ctr: insight.ctr,
      cpc: insight.cpc,
      cpm: insight.cpm,
      leads: insight.leads,
      raw: insight.raw as any,
    };

    const key = {
      tenantId,
      date: insight.date,
      accountId: insight.accountId,
      campaignId: insight.campaignId,
      adSetId: insight.adSetId,
      adId: insight.adId,
    };

    // Atomic insert-or-update on the null-safe unique key (no find-then-create race).
    await db.metaAdInsight.upsert({
      where: { tenantId_date_accountId_campaignId_adSetId_adId: key },
      create: { ...key, ...data },
      update: data,
    });
    imported += 1;
  }

  await db.integration.update({
    where: { id: integration.id },
    data: {
      lastSyncAt: new Date(),
      errorMessage: null,
    },
  });

  return { imported };
}
