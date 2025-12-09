import React, { useState } from 'react';
import clsx from 'clsx';
import type { Message, ToolInvocation } from 'ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
}

const bubbleBase =
  'max-w-[90%] md:max-w-[70%] rounded-2xl px-4 py-3 text-sm shadow-sm border transition-colors';

const formatResult = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const ToolInvocationCard: React.FC<{ invocation: ToolInvocation }> = ({ invocation }) => {
  const { toolName, args } = invocation;
  const invocationState = (invocation.state ?? 'call') as string;
  const result = (invocation as { result?: unknown }).result ?? (invocation as { output?: unknown }).output;
  const [isExpanded, setIsExpanded] = useState(false);
  const formattedArgs = args ? formatResult(args) : null;
  const formattedResult = formatResult(result);

  // Enhanced tool descriptions for campaign finance context
  const getToolDescription = (name: string) => {
    const descriptions: Record<string, string> = {
      searchDonorTotalsWindow: 'Campaign Finance - Donor Search',
      searchBillsForLegislator: 'Legislative Records - Bill Search',
      searchPeopleWithSessions: 'Legislator Directory Search',
      sessionWindow: 'Session Date Window',
      findDonorsByName: 'Donor Name Resolution',
    };
    return descriptions[name] || name;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 shadow-sm text-xs flex flex-col gap-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between gap-2 w-full text-left hover:bg-slate-50 rounded-lg p-1 -m-1 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
          <span className="font-semibold text-slate-700">
            {getToolDescription(toolName)}
          </span>
        </div>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold',
            invocationState === 'call' && 'bg-amber-100 text-amber-700',
            invocationState === 'result' && 'bg-emerald-100 text-emerald-700',
            invocationState === 'partial-call' && 'bg-blue-100 text-blue-700',
            invocationState !== 'call' && invocationState !== 'result' && invocationState !== 'partial-call' && 'bg-rose-100 text-rose-700'
          )}
        >
          {invocationState}
        </span>
      </button>
      {isExpanded && (
        <>
          {formattedArgs && (
            <div>
              <p className="text-slate-500 mb-1 font-medium">Arguments</p>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words bg-slate-950/5 rounded-lg p-2">
                {formattedArgs}
              </pre>
            </div>
          )}
          {formattedResult && (
            <div>
              <p className="text-slate-500 mb-1 font-medium">Result</p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words bg-slate-950/5 rounded-lg p-2">
                {formattedResult}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const ChatMessageBubble: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const bubbleClass = clsx(
    bubbleBase,
    isUser
      ? 'bg-slate-900 text-white border-slate-900/60 self-end'
      : 'bg-white text-slate-800 border-slate-200'
  );

  const content = Array.isArray(message.content)
    ? message.content
        .filter((chunk) => chunk.type === 'text')
        .map((chunk) => ('text' in chunk ? chunk.text : ''))
        .join('')
    : message.content;

  return (
    <div className={clsx('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div className="flex flex-col gap-3 items-stretch">
        <div className={bubbleClass}>
          {content ? (
            <div className={clsx('prose prose-sm max-w-none', isUser && 'text-white prose-invert')}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  table: ({ children }) => (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border border-slate-300">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-slate-300 bg-slate-50 px-4 py-2 text-left font-semibold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-slate-300 px-4 py-2">
                      {children}
                    </td>
                  ),
                }}
              >
                {content as string}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-slate-500 italic">
              {isStreaming ? 'Thinking…' : '…'}
            </p>
          )}
        </div>
        {message.toolInvocations && message.toolInvocations.length > 0 && (
          <div className="flex flex-col gap-2">
            {message.toolInvocations.map((toolInvocation: ToolInvocation) => (
              <ToolInvocationCard key={toolInvocation.toolCallId} invocation={toolInvocation} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
