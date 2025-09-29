import React, { useMemo } from 'react';

import { Chat } from './components/Chat';

const generateChatId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const ChatView: React.FC = () => {
  const chatId = useMemo(() => generateChatId(), []);

  return <Chat id={chatId} initialMessages={[]} />;
};
