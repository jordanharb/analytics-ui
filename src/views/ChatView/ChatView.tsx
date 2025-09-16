import React, { useState, useEffect, useRef } from 'react';
import { MCPClient } from '../../lib/mcp/MCPClient';
import { ChatMessage } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';
import { ChatHistoryManager, type ChatSession } from '../../lib/chat/ChatHistoryManager';
import type { ProviderType, ModelInfo } from '../../lib/mcp/providers/types';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tools?: any[];
}

export const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [currentProvider, setCurrentProvider] = useState<ProviderType | null>(null);
  const [availableProviders, setAvailableProviders] = useState<ProviderType[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [showSessionList, setShowSessionList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);
  const historyManagerRef = useRef<ChatHistoryManager | null>(null);

  useEffect(() => {
    // Initialize history manager
    if (!historyManagerRef.current) {
      historyManagerRef.current = new ChatHistoryManager();

      // Load sessions and current session
      const allSessions = historyManagerRef.current.getAllSessions();
      setSessions(allSessions);

      const current = historyManagerRef.current.getCurrentSession();
      setCurrentSession(current);
      setMessages(current.messages);
    }

    // Initialize MCP client
    const initClient = async () => {
      // Prevent double initialization
      if (mcpClientRef.current) return;

      try {
        mcpClientRef.current = new MCPClient();

        // Check available providers
        const providers = mcpClientRef.current.getAvailableProviders();
        setAvailableProviders(providers);

        // Set current provider
        const current = mcpClientRef.current.getCurrentProvider();
        if (current) {
          setCurrentProvider(current);

          // Get available models for current provider
          const models = mcpClientRef.current.getAvailableModels();
          setAvailableModels(models);

          // Set default model
          if (models.length > 0) {
            setSelectedModel(models[0].id);
            mcpClientRef.current.setModel(models[0].id);
          }
        } else {
          setConnectionError('No AI providers configured. Please add API keys to .env file.');
        }

        // Try to connect to the MCP server via HTTP
        try {
          await mcpClientRef.current.connectToServer();
          setIsConnected(true);
        } catch (error) {
          console.warn('Could not connect to MCP server, running in standalone mode');
          setIsConnected(false);
        }
      } catch (error: any) {
        console.error('Failed to initialize MCP client:', error);
        setConnectionError(error.message);
      }
    };

    initClient();

    return () => {
      // Cleanup on unmount
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    // Scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleProviderChange = (provider: ProviderType) => {
    if (mcpClientRef.current?.setProvider(provider)) {
      setCurrentProvider(provider);

      // Update available models for new provider
      const models = mcpClientRef.current.getAvailableModels();
      setAvailableModels(models);

      // Set default model for new provider
      if (models.length > 0) {
        setSelectedModel(models[0].id);
        mcpClientRef.current.setModel(models[0].id);
      }

      // Clear messages when switching providers (optional)
      // setMessages([]);
    }
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    mcpClientRef.current?.setModel(modelId);
  };

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || isStreaming || !mcpClientRef.current) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);

    // Save to history
    historyManagerRef.current?.addMessage(userMessage);

    setIsStreaming(true);

    // Create assistant message placeholder
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      tools: []
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      // Process query through MCP client
      const stream = await mcpClientRef.current.processQuery(content);

      for await (const chunk of stream) {
        console.log('Received chunk:', chunk);
        if (chunk.type === 'text') {
          setMessages(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              lastMessage.content += chunk.content || '';
            }
            return updated;
          });
        } else if (chunk.type === 'tool_start' && chunk.tool) {
          setMessages(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              if (!lastMessage.tools) {
                lastMessage.tools = [];
              }
              // Prevent duplicate tool entries with the same id
              const existing = lastMessage.tools.find(t => t.id === chunk.tool!.id);
              if (existing) {
                existing.status = 'running';
              } else {
                lastMessage.tools.push({
                  id: chunk.tool!.id,
                  name: chunk.tool!.name,
                  status: 'running'
                });
              }
            }
            return updated;
          });
        } else if (chunk.type === 'tool_result') {
          setMessages(prev => {
            const updated = [...prev];
            const lastMessage = updated[updated.length - 1];
            if (lastMessage && lastMessage.role === 'assistant' && lastMessage.tools) {
              // Get the last tool in the array (most recently added)
              const tool = lastMessage.tools[lastMessage.tools.length - 1];
              if (tool) {
                tool.status = 'completed';
                tool.result = chunk.content;
              }
            }
            return updated;
          });
        }
      }
    } catch (error: any) {
      console.error('Chat error:', error);
      setMessages(prev => {
        const updated = [...prev];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          lastMessage.content = `Error: ${error.message || 'Failed to get response'}`;
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);

      // Save assistant message to history
      setMessages(prev => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === 'assistant') {
          historyManagerRef.current?.addMessage(lastMessage);
        }
        return prev;
      });
    }
  };

  const handleNewChat = () => {
    const session = historyManagerRef.current?.createSession();
    if (session) {
      setCurrentSession(session);
      setMessages([]);
      setSessions(historyManagerRef.current?.getAllSessions() || []);

      // Clear provider history
      mcpClientRef.current?.clearHistory();
    }
  };

  const handleSelectSession = (sessionId: string) => {
    if (historyManagerRef.current?.setCurrentSession(sessionId)) {
      const session = historyManagerRef.current.getSession(sessionId);
      if (session) {
        setCurrentSession(session);
        setMessages(session.messages);
        setShowSessionList(false);

        // Clear provider history and rebuild
        mcpClientRef.current?.clearHistory();
      }
    }
  };

  const handleDeleteSession = (sessionId: string) => {
    if (historyManagerRef.current?.deleteSession(sessionId)) {
      setSessions(historyManagerRef.current.getAllSessions());

      // If we deleted current session, it auto-creates a new one
      const newCurrent = historyManagerRef.current.getCurrentSession();
      setCurrentSession(newCurrent);
      setMessages(newCurrent.messages);
    }
  };

  const handleClearAllSessions = () => {
    if (confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
      historyManagerRef.current?.clearAllSessions();

      const newSession = historyManagerRef.current?.getCurrentSession();
      if (newSession) {
        setCurrentSession(newSession);
        setMessages([]);
        setSessions([newSession]);
      }

      // Clear provider history
      mcpClientRef.current?.clearHistory();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full h-full overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {currentSession?.title || 'AI Assistant'}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Chat with AI about your data using MCP tools
                </p>
              </div>

              {/* Session Management Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleNewChat}
                  className="btn btn-sm btn-ghost"
                  title="New Chat"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Chat
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowSessionList(!showSessionList)}
                    className="btn btn-sm btn-ghost"
                    title="Chat History"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    History ({sessions.length})
                  </button>

                  {/* Session List Dropdown */}
                  {showSessionList && (
                    <div className="absolute top-full mt-1 right-0 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50 max-h-96 overflow-y-auto">
                      <div className="p-2 border-b border-gray-200">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold text-gray-700">Chat History</span>
                          <button
                            onClick={handleClearAllSessions}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {sessions.map((session) => (
                          <div
                            key={session.id}
                            className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                              session.id === currentSession?.id ? 'bg-blue-50' : ''
                            }`}
                          >
                            <div className="flex justify-between items-start">
                              <div
                                className="flex-1 min-w-0"
                                onClick={() => handleSelectSession(session.id)}
                              >
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {session.title}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString()}
                                  {' · '}
                                  {session.messages.length} messages
                                </p>
                              </div>
                              {session.id !== currentSession?.id && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteSession(session.id);
                                  }}
                                  className="ml-2 p-1 text-gray-400 hover:text-red-600"
                                  title="Delete"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {sessions.length === 0 && (
                          <div className="p-4 text-center text-sm text-gray-500">
                            No chat history yet
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Provider Selector */}
              {availableProviders.length > 1 && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Provider:</label>
                  <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                    {availableProviders.map((provider) => (
                      <button
                        key={provider}
                        onClick={() => handleProviderChange(provider)}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
                          currentProvider === provider
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {provider === 'claude' ? 'Claude' : 'Gemini'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Selector */}
              {availableModels.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Model:</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="input input-sm"
                  >
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Status Badges */}
              <div className="flex items-center gap-2">
                {connectionError && (
                  <span className="badge badge-danger text-xs">
                    ⚠️ {connectionError}
                  </span>
                )}
                {isConnected && (
                  <span className="badge badge-success text-xs">
                    ✓ MCP Connected
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {messages.length === 0 && !isStreaming && (
            <div className="max-w-2xl mx-auto text-center py-12">
              <div className="card card-elevated p-8">
                <h3 className="text-lg font-semibold mb-4">Welcome to the MCP-powered AI Assistant</h3>
                <p className="text-gray-600 mb-4">I can help you:</p>
                <ul className="text-left text-gray-600 mb-6 space-y-2">
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    Search and analyze your data
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    Execute tools and commands
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    Generate insights and reports
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    Answer questions about your system
                  </li>
                </ul>
                <p className="font-medium mb-4">Try asking:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    className="chip"
                    onClick={() => handleSendMessage("What tools are available?")}
                  >
                    "What tools are available?"
                  </button>
                  <button
                    className="chip"
                    onClick={() => handleSendMessage("Search for recent events")}
                  >
                    "Search for recent events"
                  </button>
                  <button
                    className="chip"
                    onClick={() => handleSendMessage("Analyze trending topics")}
                  >
                    "Analyze trending topics"
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
          </div>

          {isStreaming && (
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center gap-2 text-gray-500">
                <span className="spinner spinner-sm"></span>
                <span className="text-sm">AI is thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4">
          <ChatInput
            onSend={handleSendMessage}
            disabled={isStreaming || !mcpClientRef.current}
            placeholder="Ask me anything..."
          />
        </div>
      </div>
    </div>
  );
};
