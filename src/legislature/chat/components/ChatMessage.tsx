import React, { useState } from 'react';

interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    tools?: Array<{
      id: string;
      name: string;
      status?: 'running' | 'completed';
      result?: any;
    }>;
  };
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const toggleToolExpanded = (toolId: string) => {
    setExpandedTools(prev => {
      const newSet = new Set(prev);
      if (newSet.has(toolId)) {
        newSet.delete(toolId);
      } else {
        newSet.add(toolId);
      }
      return newSet;
    });
  };

  // Parse markdown-like formatting
  const formatContent = (content: string) => {
    if (!content) return null;

    // Split by lines to handle line breaks
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;
    let listItems: React.ReactNode[] = [];
    let currentIndent = 0;

    const processInlineFormatting = (text: string): React.ReactNode => {
      // Process bold text
      const parts = text.split(/\*\*(.+?)\*\*/g);
      return parts.map((part, i) => {
        if (i % 2 === 1) {
          return <strong key={i}>{part}</strong>;
        }
        return part;
      });
    };

    lines.forEach((line, index) => {
      // Check for list items (both * and numbered)
      const bulletMatch = line.match(/^(\s*)\*\s+(.+)/);
      const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)/);

      if (bulletMatch || numberedMatch) {
        const match = bulletMatch || numberedMatch;
        const indent = match![1].length;
        const content = match![2];

        if (!inList) {
          inList = true;
          listItems = [];
          currentIndent = indent;
        }

        listItems.push(
          <li key={`li-${index}`} style={{ marginLeft: `${(indent - currentIndent) * 20}px` }}>
            {processInlineFormatting(content)}
          </li>
        );
      } else {
        // End of list, render accumulated items
        if (inList && listItems.length > 0) {
          elements.push(
            <ul key={`list-${index}`} className="list-disc ml-5 my-2">
              {listItems}
            </ul>
          );
          listItems = [];
          inList = false;
        }

        // Handle headers
        if (line.startsWith('## ')) {
          elements.push(
            <h3 key={index} className="font-bold text-lg mt-3 mb-2">
              {processInlineFormatting(line.substring(3))}
            </h3>
          );
        } else if (line.startsWith('# ')) {
          elements.push(
            <h2 key={index} className="font-bold text-xl mt-3 mb-2">
              {processInlineFormatting(line.substring(2))}
            </h2>
          );
        } else if (line.trim()) {
          // Regular paragraph
          elements.push(
            <p key={index} className="mb-2">
              {processInlineFormatting(line)}
            </p>
          );
        } else if (elements.length > 0) {
          // Empty line for spacing
          elements.push(<div key={index} className="h-2" />);
        }
      }
    });

    // Handle any remaining list items
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key="list-final" className="list-disc ml-5 my-2">
          {listItems}
        </ul>
      );
    }

    return <div>{elements}</div>;
  };

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-3xl ${isUser ? 'ml-12' : 'mr-12'}`}>
        {/* Message Header */}
        <div className="flex items-center gap-2 mb-1 text-xs text-gray-500">
          <span className="font-medium">
            {isUser ? 'You' : isAssistant ? 'AI Assistant' : 'System'}
          </span>
          <span>{formatTime(message.timestamp)}</span>
        </div>

        {/* Tools */}
        {message.tools && message.tools.length > 0 && (
          <div className="space-y-2 mb-2">
            {message.tools.map((tool) => {
              const isExpanded = expandedTools.has(tool.id);
              return (
                <div
                  key={tool.id}
                  className={`card ${tool.status === 'running' ? 'border-blue-500' : 'border-gray-200'}`}
                >
                  <div
                    className="flex items-center gap-2 p-3 cursor-pointer select-none hover:bg-gray-50 transition-colors"
                    onClick={() => toggleToolExpanded(tool.id)}
                  >
                    <span className="text-sm transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      ▶
                    </span>
                    <span className="text-sm">🔧</span>
                    <span className="font-medium text-sm">{tool.name}</span>
                    {tool.status === 'running' && (
                      <span className="badge badge-info ml-auto">Running...</span>
                    )}
                    {tool.status === 'completed' && (
                      <span className="badge badge-success ml-auto">✓ Complete</span>
                    )}
                  </div>
                  {isExpanded && tool.result && (
                    <div className="border-t border-gray-200">
                      <div className="p-3">
                        <div className="text-xs text-gray-600 mb-2">Function Output:</div>
                        <div className="bg-gray-50 rounded p-3 max-h-96 overflow-auto">
                          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                            {typeof tool.result === 'string'
                              ? tool.result
                              : JSON.stringify(tool.result, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Message Content */}
        <div
          className={`
            inline-block px-4 py-2 rounded-lg
            ${isUser
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-900 border border-gray-200'
            }
          `}
        >
          <div className="break-words">
            {isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              formatContent(message.content)
            )}
          </div>
        </div>
      </div>
    </div>
  );
};