import React, { useMemo } from 'react';

import { Chat } from '../../views/ChatView/components/Chat';
import CampaignOverview from './CampaignOverview';

const generateChatId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const CampaignFinanceChatView: React.FC = () => {
  const chatId = useMemo(() => generateChatId(), []);

  return (
    <Chat
      id={chatId}
      initialMessages={[]}
      title="Campaign Finance & Legislative Intelligence"
      description="Gemini + MCP tooling for committees, donors, transactions, and legislative history."
      overview={<CampaignOverview />}
    />
  );
};

export default CampaignFinanceChatView;
