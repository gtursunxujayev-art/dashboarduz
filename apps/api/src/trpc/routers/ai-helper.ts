import { protectedProcedure, router } from '../trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { collectAnalyticsInput } from './analytics-ai';
import { parseCustomDate } from './dashboard/helpers';

const aiHelperMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4_000),
});

const aiHelperInputSchema = z.object({
  message: z.string().min(1).max(6_000),
  history: z.array(aiHelperMessageSchema).max(20).default([]),
  pageContext: z.object({
    pageKey: z.string().min(1).max(120),
    rangeMode: z.string().max(40).optional().nullable(),
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    filters: z.record(z.unknown()).optional(),
    metrics: z.record(z.unknown()).optional(),
    updatedAt: z.string().optional(),
  }).optional(),
});

type AiProviderConfig =
  | { provider: 'deepseek'; model: string; apiKey: string }
  | { provider: 'openai'; model: string; apiKey: string };

type DateWindow = {
  dateFrom: string;
  dateTo: string;
  reason: 'message_explicit' | 'page_context' | 'default_current_month';
};

let promptCache: { value: string; loadedAt: number } | null = null;
const PROMPT_CACHE_TTL_MS = 60_000;

const FALLBACK_HELPER_PROMPT = `Siz Dashboarduz AI yordamchisiz.

Roli:
- Sotuv va marketing bo'yicha senior analitik yordamchi.

Til:
- Har doim aniq Uzbek Latin tilida yozing.

Qoidalar:
- Faqat berilgan metrika va ma'lumotlardan foydalaning.
- Raqamlarni o'ylab topmang.
- Agar ma'lumot yetarli bo'lmasa, aynan qaysi ma'lumot yo'qligini ayting.
- Javob amaliy bo'lsin: muammo, sabab, 1-3 aniq qadam.
- Siz faqat read-only tahlilchisiz: hech qanday ma'lumotni o'zgartirmaysiz.

Kontekst ishlatish:
- Avval current page date filter va page context ni ustuvor ishlating.
- Agar foydalanuvchi boshqa sana oralig'ini so'rasa, o'sha oralig' bo'yicha tahlil qiling.

Format:
- Qisqa va tushunarli javob.
- Kerak bo'lsa bulletlardan foydalaning.
`;

function startOfTashkentDay(date: Date): Date {
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  return new Date(Date.UTC(y, m, d) - 5 * 60 * 60 * 1000);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getCurrentMonthWindow(now: Date): { dateFrom: string; dateTo: string } {
  const shifted = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1) - 5 * 60 * 60 * 1000);
  return { dateFrom: toDateOnly(monthStart), dateTo: toDateOnly(now) };
}

function getLastMonthWindow(now: Date): { dateFrom: string; dateTo: string } {
  const shifted = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1) - 5 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999) - 5 * 60 * 60 * 1000);
  return { dateFrom: toDateOnly(start), dateTo: toDateOnly(end) };
}

function getCurrentWeekWindow(now: Date): { dateFrom: string; dateTo: string } {
  const localDay = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDay.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(localDay);
  monday.setUTCDate(localDay.getUTCDate() - daysSinceMonday);
  const mondayUtc = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) - 5 * 60 * 60 * 1000);
  return { dateFrom: toDateOnly(mondayUtc), dateTo: toDateOnly(now) };
}

function getLastWeekWindow(now: Date): { dateFrom: string; dateTo: string } {
  const localDay = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const day = localDay.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const currentMonday = new Date(localDay);
  currentMonday.setUTCDate(localDay.getUTCDate() - daysSinceMonday);
  const lastMonday = new Date(currentMonday);
  lastMonday.setUTCDate(currentMonday.getUTCDate() - 7);
  const lastSunday = new Date(currentMonday);
  lastSunday.setUTCDate(currentMonday.getUTCDate() - 1);

  const fromUtc = new Date(Date.UTC(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate()) - 5 * 60 * 60 * 1000);
  const toUtc = new Date(Date.UTC(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth(), lastSunday.getUTCDate(), 23, 59, 59, 999) - 5 * 60 * 60 * 1000);
  return { dateFrom: toDateOnly(fromUtc), dateTo: toDateOnly(toUtc) };
}

function normalizeDatePair(a: string, b: string): { dateFrom: string; dateTo: string } {
  return a <= b ? { dateFrom: a, dateTo: b } : { dateFrom: b, dateTo: a };
}

function detectDateWindowFromMessage(message: string, now: Date): { dateFrom: string; dateTo: string } | null {
  const text = message.toLowerCase();

  const between = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|dan|gacha|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i);
  const betweenStart = between?.[1];
  const betweenEnd = between?.[2];
  if (betweenStart && betweenEnd) {
    return normalizeDatePair(betweenStart, betweenEnd);
  }

  const singleDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const singleDateValue = singleDate?.[1];
  if (singleDateValue) {
    return { dateFrom: singleDateValue, dateTo: singleDateValue };
  }

  if (text.includes("o'tgan oy") || text.includes('otgan oy') || text.includes('last month')) {
    return getLastMonthWindow(now);
  }
  if (text.includes('joriy oy') || text.includes('bu oy') || text.includes('this month')) {
    return getCurrentMonthWindow(now);
  }
  if (text.includes("o'tgan hafta") || text.includes('otgan hafta') || text.includes('last week')) {
    return getLastWeekWindow(now);
  }
  if (text.includes('joriy hafta') || text.includes('bu hafta') || text.includes('this week')) {
    return getCurrentWeekWindow(now);
  }
  if (text.includes('bugun') || text.includes('today')) {
    const today = toDateOnly(startOfTashkentDay(now));
    return { dateFrom: today, dateTo: today };
  }
  return null;
}

function resolveDateWindow(
  message: string,
  pageContext: z.infer<typeof aiHelperInputSchema>['pageContext'] | undefined,
  now: Date,
): DateWindow {
  const fromMessage = detectDateWindowFromMessage(message, now);
  if (fromMessage) {
    return { ...fromMessage, reason: 'message_explicit' };
  }

  if (pageContext?.dateFrom && pageContext?.dateTo) {
    return {
      dateFrom: pageContext.dateFrom,
      dateTo: pageContext.dateTo,
      reason: 'page_context',
    };
  }

  return {
    ...getCurrentMonthWindow(now),
    reason: 'default_current_month',
  };
}

function resolveAiProvider(): AiProviderConfig {
  const explicitProvider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicitProvider === 'deepseek' || (!explicitProvider && process.env.DEEPSEEK_API_KEY)) {
    return {
      provider: 'deepseek',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: process.env.DEEPSEEK_MODEL || process.env.AI_MODEL || 'deepseek-v4-pro',
    };
  }
  return {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-5.2',
  };
}

function extractOpenAiText(body: any): string {
  if (typeof body?.output_text === 'string') {
    return body.output_text;
  }
  const chunks: string[] = [];
  for (const block of body?.output || []) {
    for (const part of block?.content || []) {
      if (typeof part?.text === 'string') {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function extractDeepSeekText(body: any): string {
  return String(body?.choices?.[0]?.message?.content || '').trim();
}

async function loadHelperPrompt(): Promise<string> {
  const now = Date.now();
  if (promptCache && now - promptCache.loadedAt < PROMPT_CACHE_TTL_MS) {
    return promptCache.value;
  }

  const candidates = [
    path.resolve(process.cwd(), 'AI_HELPER_PROMPT.md'),
    path.resolve(process.cwd(), '..', 'AI_HELPER_PROMPT.md'),
    path.resolve(process.cwd(), '..', '..', 'AI_HELPER_PROMPT.md'),
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, 'utf-8');
      const text = raw.trim();
      if (text.length > 0) {
        promptCache = { value: text, loadedAt: now };
        return text;
      }
    } catch {
      // Continue to fallback.
    }
  }

  console.warn('[aiHelper] AI_HELPER_PROMPT.md not found/readable. Fallback prompt is used.');
  promptCache = { value: FALLBACK_HELPER_PROMPT, loadedAt: now };
  return FALLBACK_HELPER_PROMPT;
}

function chooseFocus(message: string): 'sales' | 'lead_quality' | 'meta_targeting' | 'agents' | 'courses' {
  const text = message.toLowerCase();
  if (text.includes('meta') || text.includes('ctr') || text.includes('cpl') || text.includes('cpql') || text.includes('ads')) {
    return 'meta_targeting';
  }
  if (text.includes('lid') || text.includes('lead')) {
    return 'lead_quality';
  }
  if (text.includes('agent') || text.includes('manager') || text.includes("sotuvchi")) {
    return 'agents';
  }
  if (text.includes('kurs') || text.includes('course') || text.includes('tarif') || text.includes('subtarif')) {
    return 'courses';
  }
  return 'sales';
}

async function generateAssistantText(
  provider: AiProviderConfig,
  prompt: string,
  payload: Record<string, unknown>,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  message: string,
): Promise<string> {
  if (!provider.apiKey) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: provider.provider === 'deepseek'
        ? 'DEEPSEEK_API_KEY sozlanmagan.'
        : 'OPENAI_API_KEY sozlanmagan.',
    });
  }

  if (provider.provider === 'deepseek') {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: prompt },
          ...history.map((item) => ({ role: item.role, content: item.content })),
          {
            role: 'user',
            content: [
              `KONTEKST_JSON:\n${JSON.stringify(payload)}`,
              `FOYDALANUVCHI_SAVOLI:\n${message}`,
              'Javobni Uzbek Latin tilida yozing.',
            ].join('\n\n'),
          },
        ],
        stream: false,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: String(body?.error?.message || `DeepSeek so'rovida xatolik: ${response.status}`),
      });
    }
    return extractDeepSeekText(body);
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      instructions: prompt,
      input: [
        ...history.map((item) => ({ role: item.role, content: item.content })),
        {
          role: 'user',
          content: [
            { type: 'input_text', text: `KONTEKST_JSON:\n${JSON.stringify(payload)}` },
            { type: 'input_text', text: `FOYDALANUVCHI_SAVOLI:\n${message}` },
            { type: 'input_text', text: 'Javobni Uzbek Latin tilida yozing.' },
          ],
        },
      ],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: String(body?.error?.message || `OpenAI so'rovida xatolik: ${response.status}`),
    });
  }
  return extractOpenAiText(body);
}

export const aiHelperRouter = router({
  chat: protectedProcedure
    .input(aiHelperInputSchema)
    .mutation(async ({ ctx, input }) => {
      const roles = ctx.user.roles || [];
      const allowed = roles.includes('Admin') || roles.includes('Manager');
      if (!allowed) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'AI yordamchidan faqat Admin va Manager foydalanishi mumkin.' });
      }

      const now = new Date();
      const resolved = resolveDateWindow(input.message, input.pageContext, now);
      const rangeStart = parseCustomDate(resolved.dateFrom, false);
      const rangeEnd = parseCustomDate(resolved.dateTo, true);
      const focus = chooseFocus(input.message);
      const analyticsInput = await collectAnalyticsInput(ctx.tenantId, rangeStart, rangeEnd, focus);
      const prompt = await loadHelperPrompt();
      const provider = resolveAiProvider();

      const payload = {
        tenantId: ctx.tenantId,
        currentUser: {
          userId: ctx.user.userId,
          roles,
        },
        pageContext: input.pageContext || null,
        resolvedDateWindow: resolved,
        analyticsInput,
        readonlyPolicy: {
          dbAccess: 'read-only',
          projectMutationsAllowed: false,
          dataMutationsAllowed: false,
        },
      };

      const answer = await generateAssistantText(provider, prompt, payload, input.history, input.message);
      const trimmed = String(answer || '').trim();

      return {
        answer: trimmed || "Hozircha javob shakllantirib bo'lmadi.",
        provider: provider.provider,
        model: provider.model,
        resolvedDateWindow: resolved,
        focus,
      };
    }),
});
