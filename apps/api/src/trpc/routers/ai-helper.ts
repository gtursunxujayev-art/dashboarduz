import { protectedProcedure, router } from '../trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { collectAnalyticsInput } from './analytics-ai';
import { parseCustomDate } from './dashboard/helpers';
import { prisma } from '@dashboarduz/db';
import { INCOME_LIFECYCLE_ACTIVE } from './dashboard/helpers';

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

type CourseHintSummary = {
  requestedToken: string;
  matchedCourseName: string | null;
  similarity: number;
  salesCount: number;
  agreementAmount: number;
  incomeAmount: number;
  debtAmount: number;
  tariffBreakdown: Array<{
    tariff: string;
    salesCount: number;
    agreementAmount: number;
    incomeAmount: number;
    debtAmount: number;
  }>;
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
- Standart holatda butun loyiha ma'lumotlari bilan javob bering (tanlangan sana oralig'ida).
- Agar foydalanuvchi "shu sahifa" yoki "faqat shu filter" desa, current page kontekstini cheklov sifatida qo'llang.
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

  const rangeMode = String(pageContext?.rangeMode || '').trim().toLowerCase();
  if (rangeMode === 'today') {
    const today = toDateOnly(startOfTashkentDay(now));
    return { dateFrom: today, dateTo: today, reason: 'page_context' };
  }
  if (rangeMode === 'week') {
    return { ...getCurrentWeekWindow(now), reason: 'page_context' };
  }
  if (rangeMode === 'month') {
    return { ...getCurrentMonthWindow(now), reason: 'page_context' };
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

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['`"]/g, '')
    .replace(/o‘|o'/g, 'o')
    .replace(/g‘|g'/g, 'g')
    .replace(/sh/g, 's_h')
    .replace(/ch/g, 'c_h')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/s_h/g, 'sh')
    .replace(/c_h/g, 'ch')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const v0 = new Array(b.length + 1).fill(0);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i <= b.length; i += 1) v0[i] = i;
  for (let i = 0; i < a.length; i += 1) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(
        v1[j] + 1,
        v0[j + 1] + 1,
        v0[j] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) v0[j] = v1[j];
  }
  return v1[b.length];
}

function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

function extractLikelyCourseToken(message: string): string | null {
  const text = message.toLowerCase();
  const courseRegex = /(\d+\s*-?\s*[a-zа-яo'g`'‘]+(?:\s*[a-zа-яo'g`'‘]+)?)/i;
  const match = text.match(courseRegex);
  const token = (match?.[1] || '').trim();
  if (token.length >= 3) {
    return token;
  }
  if (text.includes('kurs') || text.includes('tarif') || text.includes('coching') || text.includes('couching')) {
    return text.trim().slice(0, 64);
  }
  return null;
}

function shouldPreferCourseDirectAnswer(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('kurs')
    || text.includes('coching')
    || text.includes('couching')
    || text.includes('sotuv')
    || text.includes('tarif')
  );
}

function formatMoneyUz(value: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(value || 0))} so'm`;
}

function buildCourseDirectAnswer(courseHint: CourseHintSummary): string {
  const tariffParts = courseHint.tariffBreakdown
    .filter((item) => item.salesCount > 0)
    .map((item) => `${item.tariff} - ${item.salesCount} ta`);
  const tariffLine = tariffParts.length > 0
    ? tariffParts.join(', ')
    : "tariflar bo'yicha sotuv topilmadi";

  return [
    `${courseHint.matchedCourseName}ga ${courseHint.salesCount} ta sotuv bo'lgan.`,
    `Tariflar: ${tariffLine}.`,
    `Kelishuv summasi: ${formatMoneyUz(courseHint.agreementAmount)}.`,
    `To'langan summasi: ${formatMoneyUz(courseHint.incomeAmount)}.`,
    `Qarzdorlik summasi: ${formatMoneyUz(courseHint.debtAmount)}.`,
  ].join(' ');
}

function buildCourseSuggestionAnswer(courseHint: CourseHintSummary): string | null {
  if (!courseHint.matchedCourseName || courseHint.similarity < 0.45) {
    return null;
  }
  return `Savolda yozuv xatolik bo'lishi mumkin. Balki "${courseHint.matchedCourseName}" ni nazarda tutdingizmi?`;
}

async function buildCourseHintSummary(
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date,
  message: string,
): Promise<CourseHintSummary | null> {
  const requestedToken = extractLikelyCourseToken(message);
  if (!requestedToken) {
    return null;
  }

  const courses = await prisma.course.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true },
  });
  if (!courses.length) {
    return null;
  }

  const normalizedRequested = normalizeLooseText(requestedToken);
  let best: { id: string; name: string; score: number } | null = null;
  for (const course of courses) {
    const normalizedCourse = normalizeLooseText(course.name || '');
    if (!normalizedCourse) continue;
    const score = similarityScore(normalizedRequested, normalizedCourse);
    if (!best || score > best.score) {
      best = { id: course.id, name: course.name, score };
    }
  }

  if (!best || best.score < 0.55) {
    return {
      requestedToken,
      matchedCourseName: null,
      similarity: best?.score || 0,
      salesCount: 0,
      agreementAmount: 0,
      incomeAmount: 0,
      debtAmount: 0,
      tariffBreakdown: [],
    };
  }

  const sales = await prisma.income.findMany({
    where: {
      tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      type: 'new_sale',
      courseId: best.id,
      entryDate: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true,
      paymentAmount: true,
      coursePriceAmount: true,
      remainingDebtAmount: true,
      tariff: { select: { name: true } },
    },
  });

  const repayments = await prisma.income.findMany({
    where: {
      tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      type: 'repayment',
      courseId: best.id,
      entryDate: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      paymentAmount: true,
      tariff: { select: { name: true } },
    },
  });

  const tariffMap = new Map<string, { salesCount: number; agreementAmount: number; incomeAmount: number; debtAmount: number }>();
  for (const sale of sales) {
    const key = sale.tariff?.name || 'Tarifsiz';
    const row = tariffMap.get(key) || { salesCount: 0, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 };
    row.salesCount += 1;
    row.agreementAmount += Number(sale.coursePriceAmount || 0);
    row.incomeAmount += Number(sale.paymentAmount || 0);
    row.debtAmount += Math.max(0, Number(sale.remainingDebtAmount || 0));
    tariffMap.set(key, row);
  }
  for (const repayment of repayments) {
    const key = repayment.tariff?.name || 'Tarifsiz';
    const row = tariffMap.get(key) || { salesCount: 0, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 };
    row.incomeAmount += Number(repayment.paymentAmount || 0);
    tariffMap.set(key, row);
  }

  const agreementAmount = sales.reduce((sum, row) => sum + Number(row.coursePriceAmount || 0), 0);
  const incomeAmount = sales.reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0)
    + repayments.reduce((sum, row) => sum + Number(row.paymentAmount || 0), 0);
  const debtAmount = sales.reduce((sum, row) => sum + Math.max(0, Number(row.remainingDebtAmount || 0)), 0);

  return {
    requestedToken,
    matchedCourseName: best.name,
    similarity: Number(best.score.toFixed(3)),
    salesCount: sales.length,
    agreementAmount,
    incomeAmount,
    debtAmount,
    tariffBreakdown: Array.from(tariffMap.entries())
      .map(([tariff, metrics]) => ({ tariff, ...metrics }))
      .sort((a, b) => b.salesCount - a.salesCount),
  };
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
      const courseHint = await buildCourseHintSummary(ctx.tenantId, rangeStart, rangeEnd, input.message);
      if (courseHint && shouldPreferCourseDirectAnswer(input.message)) {
        if (courseHint.matchedCourseName && courseHint.similarity >= 0.55) {
          return {
            answer: buildCourseDirectAnswer(courseHint),
            provider: 'rule-based',
            model: 'local-course-resolver',
            resolvedDateWindow: resolved,
            focus,
          };
        }

        const suggestion = buildCourseSuggestionAnswer(courseHint);
        if (suggestion) {
          return {
            answer: suggestion,
            provider: 'rule-based',
            model: 'local-course-resolver',
            resolvedDateWindow: resolved,
            focus,
          };
        }
      }
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
        courseHint,
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
