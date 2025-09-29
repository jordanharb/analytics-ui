import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw, Wrench, StopCircle } from 'lucide-react';
import { useChat } from 'ai/react';
import type { Message } from 'ai';

import { ChatInput } from './ChatInput';
import { ChatMessageBubble } from './ChatMessage';
import { Overview } from './Overview';

interface RemoteToolInfo {
  name: string;
  description?: string;
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

interface ChatProps {
  id: string;
  initialMessages?: Message[];
  title?: string;
  description?: string;
  overview?: React.ReactNode;
}

const DEFAULT_TITLE = 'Gemini + MCP Assistant';
const DEFAULT_DESCRIPTION =
  'Powered by Google Gemini and the Woke Palantir MCP server. Ask natural questions and the agent will call tools as needed.';

export const Chat: React.FC<ChatProps> = ({
  id,
  initialMessages = [],
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  overview,
}) => {
  const backendBase = (import.meta.env.VITE_BACKEND_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
  const chatEndpoint = backendBase ? `${backendBase}/api/mcp/chat` : '/api/mcp/chat';
  const toolsEndpoint = backendBase ? `${backendBase}/api/mcp/tools` : '/api/mcp/tools';
  const [tools, setTools] = useState<RemoteToolInfo[]>([]);
  const [chatId, setChatId] = useState<string>(id);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    input,
    handleSubmit,
    isLoading,
    stop,
    setInput,
  } = useChat({
    id: chatId,
    body: { id: chatId },
    api: chatEndpoint,
    initialMessages,
    maxSteps: 8,
    sendExtraMessageFields: true,
  });

  useEffect(() => {
    const loadTools = async () => {
      try {
        const response = await fetch(toolsEndpoint);
        if (!response.ok) return;
        const data = await response.json();
        setTools(data.tools ?? []);
      } catch (error) {
        console.warn('Failed to load MCP tools', error);
      }
    };

    void loadTools();
  }, [toolsEndpoint]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const trimmedInput = input.trim();
  const canSend = useMemo(() => trimmedInput.length > 0 && !isLoading, [trimmedInput, isLoading]);

  const handleReset = () => {
    stop();
    setInput('');
    setChatId(generateId());
  };

  const topTools = tools.slice(0, 8);

  return (
    <div className="flex h-full w-full justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="flex h-full w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8">
        <header className="flex flex-col gap-3 rounded-3xl border border-slate-200/80 bg-white/70 px-6 py-5 shadow-md backdrop-blur dark:border-slate-800 dark:bg-slate-950/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
            </div>
            <div className="flex items-center gap-2">
              {isLoading && (
                <button
                  type="button"
                  onClick={stop}
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-700 shadow-sm transition hover:border-amber-300"
                >
                  <StopCircle className="h-4 w-4" />
                  Stop
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                onClick={handleReset}
              >
                <RefreshCcw className="h-4 w-4" />
                New Chat
              </button>
            </div>
          </div>
          {topTools.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                <Wrench className="h-3.5 w-3.5" />
                Tools Available
              </span>
              {topTools.map((tool) => (
                <span
                  key={tool.name}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </header>

        <main className="flex flex-1 flex-col gap-6 overflow-hidden">
          <div className="flex-1 overflow-y-auto rounded-3xl border border-slate-200/60 bg-white/70 px-4 py-6 shadow-inner backdrop-blur dark:border-slate-800 dark:bg-slate-950/60">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                {overview ?? <Overview />}
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
                {messages.map((message: Message, index: number) => (
                  <ChatMessageBubble
                    key={`${message.id ?? 'message'}-${index}`}
                    message={message}
                    isStreaming={isLoading && index === messages.length - 1}
                  />
                ))}
                {isLoading && (
                  <p className="self-start text-xs text-slate-400">Gemini is thinking…</p>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <footer className="sticky bottom-6 flex flex-col gap-3">
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-3"
            >
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSubmit()}
                canSend={canSend}
                isStreaming={isLoading}
                placeholder="Ask the assistant…"
              />
            </form>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Responses may reference tools such as <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px] uppercase">sql</code> or <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px] uppercase">search_donor_totals_window</code>. Tool traces are shown inline with the assistant replies.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
};
