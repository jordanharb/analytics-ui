// Minimal type declarations to allow local compilation when the ai package is unavailable.
declare module 'ai' {
  export type Role = 'user' | 'assistant' | 'system' | 'tool';

  export interface ToolInvocation {
    toolCallId: string;
    toolName: string;
    state: 'call' | 'result' | 'error';
    args?: Record<string, unknown>;
    result?: unknown;
  }

  export type MessageContent =
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; id: string; toolName: string; args: Record<string, unknown> }
        | { type: string; [key: string]: unknown }
      >;

  export interface Message {
    id: string;
    role: Role;
    content: MessageContent;
    createdAt?: Date | string;
    toolInvocations?: ToolInvocation[];
    experimental_attachments?: Array<unknown>;
  }
}

declare module 'ai/react' {
  import type { Message } from 'ai';
  import type { ChangeEvent, FormEvent } from 'react';

  export interface UseChatOptions {
    id?: string;
    body?: Record<string, unknown>;
    api?: string;
    initialMessages?: Message[];
    maxSteps?: number;
    sendExtraMessageFields?: boolean;
  }

  export interface UseChatReturn {
    messages: Message[];
    input: string;
    handleInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
    handleSubmit: (event?: FormEvent<HTMLFormElement> | undefined) => void;
    isLoading: boolean;
    stop: () => void;
    setInput: (value: string) => void;
  }

  export function useChat(options?: UseChatOptions): UseChatReturn;
}
