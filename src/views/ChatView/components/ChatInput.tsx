import React, { useCallback } from 'react';
import { SendHorizontal, Loader2 } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  isStreaming?: boolean;
  canSend?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Type your question…',
  isStreaming = false,
  canSend = true,
}) => {
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (canSend) {
          onSubmit();
        }
      }
    },
    [onSubmit, canSend]
  );

  return (
    <div className="w-full">
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/70 shadow-lg">
        <div className="flex items-end gap-3 px-4 py-3">
          <textarea
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none bg-transparent text-sm text-slate-800 dark:text-slate-50 placeholder:text-slate-400 focus:outline-none"
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-md transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        Press Enter to send, Shift + Enter for new line.
      </p>
    </div>
  );
};
