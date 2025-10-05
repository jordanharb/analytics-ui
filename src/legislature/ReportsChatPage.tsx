'use client';

import React from 'react';
import { LegislatureChatView } from './chat/LegislatureChatView';

const ReportsChatPage: React.FC = () => {
  return (
    <div className="h-full">
      <LegislatureChatView />
    </div>
  );
};

export default ReportsChatPage;