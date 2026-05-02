'use client';

import { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useDashboardAiContext } from '@/contexts/dashboard-ai-context';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

function isManagerOrAdmin(roles: string[]) {
  return roles.includes('Admin') || roles.includes('Manager');
}

function buildFallbackContext(pathname: string, searchParams: { get: (key: string) => string | null }) {
  const dateFrom = searchParams.get('dateFrom') || searchParams.get('from');
  const dateTo = searchParams.get('dateTo') || searchParams.get('to');
  const rangeMode = searchParams.get('range') || null;
  const query = searchParams.get('q') || searchParams.get('query') || null;
  return {
    pageKey: pathname || '/dashboard',
    rangeMode,
    dateFrom,
    dateTo,
    filters: {
      query,
    },
    metrics: {},
    updatedAt: new Date().toISOString(),
  };
}

export default function DashboardAiHelperWidget() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { pageContext } = useDashboardAiContext();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const roles = user?.roles || [];
  const allowed = isManagerOrAdmin(roles);

  const chatMutation = trpc.aiHelper.chat.useMutation();

  const effectiveContext = useMemo(() => {
    const fallback = buildFallbackContext(pathname || '/dashboard', searchParams);
    if (!pageContext) {
      return fallback;
    }
    return {
      ...fallback,
      ...pageContext,
      pageKey: pageContext.pageKey || fallback.pageKey,
    };
  }, [pageContext, pathname, searchParams]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || chatMutation.isLoading) {
      return;
    }
    const userMessage: ChatMessage = {
      id: `${Date.now()}_u`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const response = await chatMutation.mutateAsync({
        message: text,
        history: messages.slice(-12).map((item) => ({ role: item.role, content: item.text })),
        pageContext: effectiveContext,
      });
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}_a`,
        role: 'assistant',
        text: response.answer,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      const errText = String(error?.message || 'AI yordamchida xatolik yuz berdi.');
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}_e`,
          role: 'assistant',
          text: `Xatolik: ${errText}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  };

  if (!allowed) {
    return null;
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-[60] flex h-[560px] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-600/70 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">AI Yordamchi</p>
              <p className="text-xs text-slate-300">Sotuv va marketing tahlili (read-only)</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              Yopish
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3 text-sm text-slate-300">
                Savol bering. Yordamchi joriy sahifa filteri va metrikasi asosida javob beradi.
              </div>
            ) : (
              messages.map((item) => (
                <div
                  key={item.id}
                  className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                    item.role === 'user'
                      ? 'ml-auto bg-blue-600 text-white'
                      : 'mr-auto border border-slate-700 bg-slate-800 text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.text}</p>
                </div>
              ))
            )}
            {chatMutation.isLoading && (
              <div className="mr-auto rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300">
                Tahlil qilinmoqda...
              </div>
            )}
          </div>

          <div className="border-t border-slate-700 p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              rows={2}
              placeholder="Savolingizni yozing..."
              className="w-full resize-none rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400">
                Kontekst: {effectiveContext.pageKey} {effectiveContext.dateFrom && effectiveContext.dateTo ? `(${effectiveContext.dateFrom} - ${effectiveContext.dateTo})` : ''}
              </p>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={chatMutation.isLoading || input.trim().length === 0}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Yuborish
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-blue-400/60 bg-blue-500 text-white shadow-xl hover:bg-blue-600"
        aria-label="AI Yordamchini ochish"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3a3.8 3.8 0 0 1 3.8 3.8v.4A3.8 3.8 0 0 1 19 11a3.8 3.8 0 0 1-3.2 3.8v.4A3.8 3.8 0 0 1 12 19a3.8 3.8 0 0 1-3.8-3.8v-.4A3.8 3.8 0 0 1 5 11a3.8 3.8 0 0 1 3.2-3.8v-.4A3.8 3.8 0 0 1 12 3Z" />
          <path d="M9 9.5 15 13M15 9.5 9 13M12 7v10" />
        </svg>
      </button>
    </>
  );
}
