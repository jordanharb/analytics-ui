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
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-end gap-3 px-4 py-3">
          <textarea
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none"
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSend}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
          >
            {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Press Enter to send, Shift + Enter for new line.
      </p>
    </div>
  );
};
