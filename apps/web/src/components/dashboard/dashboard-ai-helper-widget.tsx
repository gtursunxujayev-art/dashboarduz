'use client';

import { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { IconMessageChatbot, IconSend, IconSparkles, IconX } from '@tabler/icons-react';
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
        <div className="fixed bottom-24 right-4 z-[60] flex h-[560px] max-h-[calc(100dvh-8rem)] w-[380px] max-w-[calc(100vw-2rem)] animate-rise-in flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl ring-1 ring-gray-200 sm:right-6">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                <IconSparkles className="h-5 w-5" stroke={1.6} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">AI Yordamchi</p>
                <p className="truncate text-xs text-gray-500">Sotuv va marketing tahlili (read-only)</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-ghost btn-sm"
            >
              <IconX className="h-4 w-4" stroke={1.8} />
              Yopish
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50/60 px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex items-start gap-2.5 rounded-[12px] bg-white p-3 text-sm text-gray-600 shadow-sm ring-1 ring-gray-100">
                <IconMessageChatbot className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" stroke={1.8} />
                <span>Savol bering. Yordamchi joriy sahifa filteri va metrikasi asosida javob beradi.</span>
              </div>
            ) : (
              messages.map((item) => (
                <div
                  key={item.id}
                  className={`max-w-[92%] rounded-[14px] px-3 py-2 text-sm ${
                    item.role === 'user'
                      ? 'ml-auto rounded-br-[4px] bg-blue-600 text-white'
                      : 'mr-auto rounded-bl-[4px] bg-white text-gray-800 shadow-sm ring-1 ring-gray-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{item.text}</p>
                </div>
              ))
            )}
            {chatMutation.isLoading && (
              <div className="mr-auto flex w-fit items-center gap-2 rounded-[14px] rounded-bl-[4px] bg-white px-3 py-2 text-sm text-gray-500 shadow-sm ring-1 ring-gray-100">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden="true" />
                Tahlil qilinmoqda...
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 bg-white p-3">
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
              className="field resize-none"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[11px] text-gray-400">
                Kontekst: {effectiveContext.pageKey} {effectiveContext.dateFrom && effectiveContext.dateTo ? `(${effectiveContext.dateFrom} - ${effectiveContext.dateTo})` : ''}
              </p>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={chatMutation.isLoading || input.trim().length === 0}
                className="btn btn-primary btn-sm flex-shrink-0"
              >
                <IconSend className="h-3.5 w-3.5" stroke={1.8} />
                Yuborish
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-xl ring-4 ring-blue-600/15 transition-colors hover:bg-blue-700 active:scale-95 sm:right-6"
        aria-label="AI Yordamchini ochish"
        aria-expanded={open}
      >
        {open ? <IconX className="h-6 w-6" stroke={1.8} /> : <IconSparkles className="h-7 w-7" stroke={1.6} />}
      </button>
    </>
  );
}
