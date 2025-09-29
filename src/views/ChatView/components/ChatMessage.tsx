import React from 'react';
import clsx from 'clsx';
import type { Message, ToolInvocation } from 'ai';
import ReactMarkdown from 'react-markdown';

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
  const { toolName, state, args, result } = invocation;
  const formattedArgs = args ? formatResult(args) : null;
  const formattedResult = formatResult(result);

  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 dark:border-slate-800 dark:bg-slate-900/60 px-3 py-2 shadow-sm text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{toolName}</span>
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold',
            state === 'call' && 'bg-amber-100 text-amber-700',
            state === 'result' && 'bg-emerald-100 text-emerald-700',
            state === 'error' && 'bg-rose-100 text-rose-700'
          )}
        >
          {state}
        </span>
      </div>
      {formattedArgs && (
        <div>
          <p className="text-slate-500 dark:text-slate-400 mb-1 font-medium">Arguments</p>
          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words bg-slate-950/5 dark:bg-slate-950/40 rounded-lg p-2">
            {formattedArgs}
          </pre>
        </div>
      )}
      {formattedResult && (
        <div>
          <p className="text-slate-500 dark:text-slate-400 mb-1 font-medium">Result</p>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words bg-slate-950/5 dark:bg-slate-950/40 rounded-lg p-2">
            {formattedResult}
          </pre>
        </div>
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
      : 'bg-white text-slate-800 dark:bg-slate-950/70 dark:text-slate-100 border-slate-200 dark:border-slate-800'
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
            <div className={clsx('prose prose-sm dark:prose-invert', isUser && 'text-white')}>
              <ReactMarkdown>{content as string}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-slate-500 dark:text-slate-400 italic">
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
