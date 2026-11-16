import { promises as fs } from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';

import type { AiProviderConfig } from '../../lib/ai-provider';
import { logger } from '../../lib/logger';

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

export async function loadHelperPrompt(): Promise<string> {
  const now = Date.now();

  if (promptCache && now - promptCache.loadedAt < PROMPT_CACHE_TTL_MS) {
    return promptCache.value;
  }

  const candidates = [
    path.resolve(process.cwd(), 'docs', 'AI_HELPER_PROMPT.md'),
    path.resolve(process.cwd(), '..', 'docs', 'AI_HELPER_PROMPT.md'),
    path.resolve(process.cwd(), '..', '..', 'docs', 'AI_HELPER_PROMPT.md'),
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

  logger.warn('[aiHelper] AI_HELPER_PROMPT.md not found/readable. Fallback prompt is used.');
  promptCache = { value: FALLBACK_HELPER_PROMPT, loadedAt: now };

  return FALLBACK_HELPER_PROMPT;
}

export function chooseFocus(message: string): 'sales' | 'lead_quality' | 'meta_targeting' | 'agents' | 'courses' {
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

export async function generateAssistantText(
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
