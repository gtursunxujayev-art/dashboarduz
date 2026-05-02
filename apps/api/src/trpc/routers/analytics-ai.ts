import { protectedProcedure, router } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  classifyCourseCategoryFromField,
  dashboardRangeSchema,
  INCOME_LIFECYCLE_ACTIVE,
  resolveDateRange,
} from './dashboard/helpers';

const ANALYTICS_AI_PROMPT_VERSION = 'sales-intelligence-v1';

const ANALYTICS_AI_INSTRUCTIONS = `You are Dashboarduz Sales Intelligence Assistant.

Role:
You are a senior sales operations analyst for an education/course sales company. You analyze CRM, income, course-sales, call, follow-up, lead-source, and Meta Ads performance data.

Purpose:
Help managers improve sales, lead quality, agent performance, and marketing efficiency. Your job is to find practical problems and recommend concrete actions.

Rules:
- Use only the metrics provided in the input. Do not invent missing numbers.
- If attribution is weak or missing, clearly say that the conclusion is uncertain.
- Separate facts from assumptions.
- Prioritize actions that can be done this week.
- Focus on revenue, lead quality, conversion, response speed, follow-up discipline, debt collection, and campaign efficiency.
- Do not expose private customer data.
- If data is insufficient, say exactly what data is missing.
- Output must be concise, operational, and written for a sales manager.

What to analyze:
- Total leads, qualified leads, sales, agreement amount, income, debt
- Lead source and campaign quality
- Meta Ads metrics: spend, clicks, CTR, CPC, CPL, CPQL, sales, income
- Agent performance: calls, talk time, follow-ups, stage changes, conversion
- Course/category performance
- Changes compared with previous period when provided

Output format:
Return JSON with:
{
  "summary": "short overall diagnosis",
  "top_findings": [
    {
      "title": "problem or opportunity",
      "severity": "high | medium | low",
      "evidence": ["metric-based evidence"],
      "likely_cause": "short explanation",
      "recommended_action": "specific action",
      "expected_impact": "what should improve",
      "confidence": "high | medium | low"
    }
  ],
  "campaign_actions": [],
  "agent_actions": [],
  "data_gaps": []
}`;

const aiFocusSchema = z.enum(['sales', 'lead_quality', 'meta_targeting', 'agents', 'courses']);

const analyticsAiInputSchema = z.object({
  range: dashboardRangeSchema,
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  focus: aiFocusSchema.default('sales'),
});

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, digits = 2): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return round((numerator / denominator) * 100, 2);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function safeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractAttributionTokens(metadata: unknown): string[] {
  const data = safeJsonObject(metadata);
  const tokens = new Set<string>();
  const candidates = [
    data.utm_campaign,
    data.utmCampaign,
    data.campaign,
    data.campaign_name,
    data.source,
    data.fbclid,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim().toLowerCase();
    if (value) tokens.add(value);
  }
  return Array.from(tokens);
}

async function collectAnalyticsInput(tenantId: string, rangeStart: Date, rangeEnd: Date, focus: z.infer<typeof aiFocusSchema>) {
  const [
    leads,
    incomes,
    calls,
    metaRows,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: {
        tenantId,
        OR: [
          { externalCreatedAt: { gte: rangeStart, lte: rangeEnd } },
          { externalCreatedAt: null, createdAt: { gte: rangeStart, lte: rangeEnd } },
        ],
      },
      select: {
        id: true,
        source: true,
        status: true,
        metadata: true,
        responsibleUserId: true,
      },
    }),
    prisma.income.findMany({
      where: {
        tenantId,
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        entryDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        id: true,
        type: true,
        paymentAmount: true,
        coursePriceAmount: true,
        remainingDebtAmount: true,
        managerUserId: true,
        course: {
          select: {
            name: true,
            category: true,
          },
        },
      },
    }),
    prisma.call.findMany({
      where: {
        tenantId,
        startedAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: {
        id: true,
        duration: true,
        status: true,
        direction: true,
      },
    }),
    prisma.metaAdInsight.findMany({
      where: {
        tenantId,
        date: { gte: new Date(`${toDateOnly(rangeStart)}T00:00:00.000Z`), lte: new Date(`${toDateOnly(rangeEnd)}T00:00:00.000Z`) },
      },
      orderBy: [{ date: 'asc' }, { spend: 'desc' }],
    }),
  ]);

  const sourceCounts = new Map<string, number>();
  const attributionTokens = new Set<string>();
  let qualifiedLeads = 0;
  for (const lead of leads) {
    const source = String(lead.source || 'unknown').trim() || 'unknown';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    const status = String(lead.status || '').toLowerCase();
    if (status.includes('qualified') || status.includes('sifatli') || status.includes('kelishuv') || status.includes('sale')) {
      qualifiedLeads += 1;
    }
    for (const token of extractAttributionTokens(lead.metadata)) {
      attributionTokens.add(token);
    }
  }

  const incomeTotal = sum(incomes.map((income) => income.paymentAmount || 0));
  const agreementTotal = sum(incomes.filter((income) => income.type === 'new_sale').map((income) => income.coursePriceAmount || 0));
  const newSales = incomes.filter((income) => income.type === 'new_sale').length;
  const repayments = incomes.filter((income) => income.type !== 'new_sale').length;
  const currentDebtFromRows = sum(incomes.map((income) => Math.max(income.remainingDebtAmount || 0, 0)));

  const categoryMap = new Map<string, { sales: number; income: number; agreement: number }>();
  for (const income of incomes) {
    const category = classifyCourseCategoryFromField(income.course?.category || income.course?.name || 'other');
    const row = categoryMap.get(category) || { sales: 0, income: 0, agreement: 0 };
    row.income += income.paymentAmount || 0;
    if (income.type === 'new_sale') {
      row.sales += 1;
      row.agreement += income.coursePriceAmount || 0;
    }
    categoryMap.set(category, row);
  }

  const campaignMap = new Map<string, {
    campaignId: string | null;
    campaignName: string;
    spend: number;
    clicks: number;
    impressions: number;
    leads: number;
    matchedLeadSignals: number;
  }>();

  for (const row of metaRows) {
    const key = row.campaignId || row.campaignName || 'unmatched_campaign';
    const campaign = campaignMap.get(key) || {
      campaignId: row.campaignId,
      campaignName: row.campaignName || row.campaignId || 'Unmatched campaign',
      spend: 0,
      clicks: 0,
      impressions: 0,
      leads: 0,
      matchedLeadSignals: 0,
    };
    campaign.spend += row.spend || 0;
    campaign.clicks += row.clicks || 0;
    campaign.impressions += row.impressions || 0;
    campaign.leads += row.leads || 0;
    const nameToken = String(row.campaignName || '').toLowerCase();
    const idToken = String(row.campaignId || '').toLowerCase();
    campaign.matchedLeadSignals += Array.from(attributionTokens).some((token) => token && (token === idToken || token === nameToken || nameToken.includes(token)))
      ? 1
      : 0;
    campaignMap.set(key, campaign);
  }

  const campaigns = Array.from(campaignMap.values())
    .map((campaign) => ({
      ...campaign,
      ctr: safeRate(campaign.clicks, campaign.impressions),
      cpl: campaign.leads > 0 ? round(campaign.spend / campaign.leads, 2) : null,
      cpql: qualifiedLeads > 0 ? round(campaign.spend / qualifiedLeads, 2) : null,
      sales: null,
      income: null,
      attribution: campaign.matchedLeadSignals > 0 ? 'weak_match' : 'unmatched',
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 20);

  return {
    dateRange: {
      from: rangeStart.toISOString(),
      to: rangeEnd.toISOString(),
    },
    focus,
    totals: {
      leads: leads.length,
      qualifiedLeads,
      newSales,
      repayments,
      agreementTotal,
      incomeTotal,
      currentDebtFromFilteredRows: currentDebtFromRows,
      calls: calls.length,
      completedCalls: calls.filter((call) => String(call.status).toLowerCase() === 'completed').length,
      talkSeconds: sum(calls.map((call) => call.duration || 0)),
      leadToSaleConversion: safeRate(newSales, leads.length),
      qualifiedLeadToSaleConversion: safeRate(newSales, qualifiedLeads),
    },
    leadSources: Array.from(sourceCounts.entries()).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    courseCategories: Array.from(categoryMap.entries()).map(([category, metrics]) => ({ category, ...metrics })),
    meta: {
      connected: metaRows.length > 0,
      spend: round(sum(metaRows.map((row) => row.spend || 0)), 2),
      clicks: sum(metaRows.map((row) => row.clicks || 0)),
      impressions: sum(metaRows.map((row) => row.impressions || 0)),
      leads: sum(metaRows.map((row) => row.leads || 0)),
      campaigns,
      attributionNote: 'Meta rows are matched to CRM only when campaign/source tokens exist. Otherwise campaign sales attribution is uncertain.',
    },
    dataGaps: [
      campaigns.some((campaign) => campaign.attribution === 'unmatched') ? 'Campaign-to-sale attribution is missing or weak for some Meta rows.' : null,
      metaRows.length === 0 ? 'Meta Ads insight rows are not synced for this range.' : null,
      qualifiedLeads === 0 ? 'Qualified lead status mapping is not clearly available in CRM lead statuses.' : null,
    ].filter(Boolean),
  };
}

function fallbackAnalysis(inputSummary: Awaited<ReturnType<typeof collectAnalyticsInput>>, reason: string) {
  const findings = [];
  if (inputSummary.meta.spend > 0 && inputSummary.totals.newSales === 0) {
    findings.push({
      title: 'Meta spend exists but sales attribution is weak',
      severity: 'high',
      evidence: [`Meta spend: ${inputSummary.meta.spend}`, `New sales: ${inputSummary.totals.newSales}`],
      likely_cause: 'CRM leads do not contain reliable campaign/ad attribution or campaigns are not converting.',
      recommended_action: 'Add UTM campaign/ad fields to AmoCRM leads and compare high-spend campaigns with qualified lead count.',
      expected_impact: 'Clearer CPQL/CPS tracking and faster campaign budget decisions.',
      confidence: 'medium',
    });
  }
  if (inputSummary.totals.leads > 0 && inputSummary.totals.leadToSaleConversion < 5) {
    findings.push({
      title: 'Lead-to-sale conversion is low',
      severity: 'medium',
      evidence: [`Leads: ${inputSummary.totals.leads}`, `Sales: ${inputSummary.totals.newSales}`, `Conversion: ${inputSummary.totals.leadToSaleConversion}%`],
      likely_cause: 'Lead quality, response speed, or follow-up discipline may be weak.',
      recommended_action: 'Review the top lead sources and require same-day follow-up for fresh leads this week.',
      expected_impact: 'Higher conversion from existing traffic before increasing ad spend.',
      confidence: 'medium',
    });
  }
  return {
    summary: `AI model was not used: ${reason}. Showing rule-based analysis from available metrics.`,
    top_findings: findings,
    campaign_actions: [],
    agent_actions: [],
    data_gaps: [reason, ...inputSummary.dataGaps],
  };
}

function extractOutputText(response: any): string {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }
  const parts: string[] = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('\n').trim();
}

async function generateWithOpenAI(inputSummary: Awaited<ReturnType<typeof collectAnalyticsInput>>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { result: fallbackAnalysis(inputSummary, 'OPENAI_API_KEY is not configured.'), model: null, usedAi: false };
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.2';
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: { type: 'string' },
      top_findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string' },
            severity: { type: 'string', enum: ['high', 'medium', 'low'] },
            evidence: { type: 'array', items: { type: 'string' } },
            likely_cause: { type: 'string' },
            recommended_action: { type: 'string' },
            expected_impact: { type: 'string' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['title', 'severity', 'evidence', 'likely_cause', 'recommended_action', 'expected_impact', 'confidence'],
        },
      },
      campaign_actions: { type: 'array', items: { type: 'string' } },
      agent_actions: { type: 'array', items: { type: 'string' } },
      data_gaps: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'top_findings', 'campaign_actions', 'agent_actions', 'data_gaps'],
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      instructions: ANALYTICS_AI_INSTRUCTIONS,
      input: JSON.stringify(inputSummary),
      text: {
        format: {
          type: 'json_schema',
          name: 'dashboarduz_sales_analysis',
          schema,
          strict: true,
        },
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: String(body?.error?.message || `OpenAI request failed with status ${response.status}`),
    });
  }

  const text = extractOutputText(body);
  const result = JSON.parse(text);
  return { result, model, usedAi: true };
}

export const analyticsAiRouter = router({
  metaInsights: protectedProcedure
    .input(analyticsAiInputSchema.omit({ focus: true }))
    .query(async ({ input, ctx }) => {
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, new Date(), input.dateFrom, input.dateTo);
      const inputSummary = await collectAnalyticsInput(ctx.tenantId, rangeStart, rangeEnd, 'meta_targeting');
      return inputSummary.meta;
    }),

  generateSuggestions: protectedProcedure
    .input(analyticsAiInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, new Date(), input.dateFrom, input.dateTo);
      const inputSummary = await collectAnalyticsInput(ctx.tenantId, rangeStart, rangeEnd, input.focus);
      const generated = await generateWithOpenAI(inputSummary);

      const report = await prisma.analyticsAiReport.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          range: input.range,
          dateFrom: rangeStart,
          dateTo: rangeEnd,
          focus: input.focus,
          promptVersion: ANALYTICS_AI_PROMPT_VERSION,
          model: generated.model,
          inputSummary: inputSummary as any,
          result: generated.result as any,
        },
      });

      return {
        reportId: report.id,
        usedAi: generated.usedAi,
        model: generated.model,
        promptVersion: ANALYTICS_AI_PROMPT_VERSION,
        inputSummary,
        result: generated.result,
      };
    }),
});
