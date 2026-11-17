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
        <div className="fixed bottom-[5.5rem] right-4 z-[45] flex h-[600px] max-h-[calc(100dvh-7.5rem)] w-[400px] max-w-[calc(100vw-2rem)] animate-rise-in flex-col overflow-hidden rounded-[20px] bg-white shadow-xl sm:right-6">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_6px_16px_-6px_rgb(34_72_226/0.6)]">
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

          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <IconMessageChatbot className="h-4 w-4" stroke={1.8} />
                </span>
                <p className="rounded-[18px] rounded-tl-[6px] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-600 shadow-sm">
                  Savol bering. Yordamchi joriy sahifa filteri va metrikasi asosida javob beradi.
                </p>
              </div>
            ) : (
              messages.map((item) =>
                item.role === 'user' ? (
                  <div key={item.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-br-[6px] bg-blue-600 px-3.5 py-2.5 text-sm leading-relaxed text-white">
                      {item.text}
                    </p>
                  </div>
                ) : (
                  <div key={item.id} className="flex items-start gap-2.5">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <IconSparkles className="h-4 w-4" stroke={1.8} />
                    </span>
                    <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] rounded-tl-[6px] bg-white px-3.5 py-2.5 text-sm leading-relaxed text-gray-800 shadow-sm">
                      {item.text}
                    </p>
                  </div>
                ),
              )
            )}
            {chatMutation.isLoading && (
              <div className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <IconSparkles className="h-4 w-4" stroke={1.8} />
                </span>
                <div className="flex w-fit items-center gap-2 rounded-[18px] rounded-tl-[6px] bg-white px-3.5 py-2.5 text-sm text-gray-500 shadow-sm">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden="true" />
                  Tahlil qilinmoqda...
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 bg-white px-3 pb-3 pt-3">
            <div className="flex items-end gap-2 rounded-full bg-gray-50 p-1.5 pl-4 ring-1 ring-gray-200 transition-shadow focus-within:ring-2 focus-within:ring-blue-500/40">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder="Savolingizni yozing..."
                aria-label="Savolingizni yozing..."
                className="min-h-[32px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-gray-900 focus:outline-none focus-visible:outline-none"
              />
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
            <p className="mt-2 min-w-0 truncate px-2 text-[11px] text-gray-400">
              Kontekst: {effectiveContext.pageKey} {effectiveContext.dateFrom && effectiveContext.dateTo ? `(${effectiveContext.dateFrom} - ${effectiveContext.dateTo})` : ''}
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`fixed bottom-6 right-4 z-[45] flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 text-sm font-medium text-white shadow-[0_10px_28px_-8px_rgb(34_72_226/0.65)] ring-4 ring-blue-600/15 transition-colors hover:bg-blue-700 active:scale-95 sm:right-6 ${
          open ? 'w-12' : 'w-12 sm:w-auto sm:px-5'
        }`}
        aria-label="AI Yordamchini ochish"
        aria-expanded={open}
      >
        {open ? (
          <IconX className="h-5 w-5" stroke={1.8} />
        ) : (
          <>
            <IconSparkles className="h-5 w-5" stroke={1.6} />
            <span className="hidden sm:inline">AI Yordamchi</span>
          </>
        )}
      </button>
    </>
  );
}
