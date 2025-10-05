import React, { useState } from 'react';
import { useChat } from 'ai/react';
import { ChatMessageBubble } from './components/ChatMessage';
import { ChatInput } from './components/ChatInput';

// Progress indicator component for tool execution
const ToolExecutionProgress: React.FC<{ isVisible: boolean; currentTool?: string }> = ({
  isVisible,
  currentTool
}) => {
  if (!isVisible) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg mx-4 mb-4">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm font-medium text-blue-800">
          {currentTool ? `Executing: ${currentTool}` : 'AI is thinking...'}
        </span>
      </div>
      <div className="text-xs text-blue-600">
        Complex analysis may take several steps
      </div>
    </div>
  );
};

export const AISDKChatView: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [currentTool, setCurrentTool] = useState<string | undefined>();
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    stop
  } = useChat({
    api: '/api/chat'
  });

    // Clear progress indicators when not loading
    React.useEffect(() => {
    if (!isLoading) {
      setCurrentTool(undefined);
      setAnalysisStep('');
    } else if (isLoading && !analysisStep) {
      setAnalysisStep('AI is thinking...');
    }
  }, [isLoading, analysisStep]);

  const handleSendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      setError(null); // Clear any previous errors

      try {
        await handleSubmit(e);
        setRetryCount(0); // Reset retry count on successful submission
      } catch (err) {
        console.error('Chat submission error:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
    }
  };

  const handleRetry = () => {
    if (retryCount < 3) { // Limit retries to prevent infinite loops
      setRetryCount(prev => prev + 1);
      setError(null);

      // Simulate a retry by recreating the form submission
      const event = new Event('submit', { bubbles: true, cancelable: true });
      handleSendMessage(event as any);
    } else {
      setError('Maximum retry attempts reached. Please refresh the page and try again.');
    }
  };

  const clearError = () => {
    setError(null);
    setRetryCount(0);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full h-full overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-200 px-6 py-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium text-gray-700">
                AI SDK Chat (Beta)
              </h2>
              <span className="badge badge-primary text-xs">
                AI SDK v5
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="btn btn-xs btn-ghost"
                title="Settings"
              >
                Settings
              </button>
              {isLoading && (
                <button
                  onClick={stop}
                  className="btn btn-xs btn-outline-danger"
                  title="Stop Generation"
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="text-sm text-gray-600">
              <p>AI SDK Chat is using the new Vercel AI SDK v5 with:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Modern streaming architecture</li>
                <li>Advanced tool calling capabilities</li>
                <li>Better error handling and recovery</li>
                <li>Real-time progress updates</li>
              </ul>
            </div>
            <button
              className="btn btn-sm btn-ghost mt-3"
              onClick={() => setShowSettings(false)}
            >
              Close
            </button>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {messages.length === 0 && !isLoading && (
            <div className="max-w-2xl mx-auto text-center py-12">
              <div className="card card-elevated p-8">
                <h3 className="text-lg font-semibold mb-4">Welcome to AI SDK Chat</h3>
                <p className="text-gray-600 mb-4">Powered by Vercel AI SDK v5 with advanced capabilities:</p>
                <ul className="text-left text-gray-600 mb-6 space-y-2">
                  <li className="flex items-start">
                    <span className="mr-2">🚀</span>
                    Advanced streaming and real-time updates
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🧠</span>
                    Gemini 2.5 thinking and reasoning
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">🔧</span>
                    Multi-step tool calling and analysis
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">💰</span>
                    Campaign finance analysis tools
                  </li>
                </ul>
                <p className="font-medium mb-4">Try asking:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    className="chip"
                    onClick={() => handleInputChange({ target: { value: "What tools are available for campaign finance analysis?" } } as React.ChangeEvent<HTMLTextAreaElement>)}
                  >
                    "What tools are available?"
                  </button>
                  <button
                    className="chip"
                    onClick={() => handleInputChange({ target: { value: "Search for recent legislation" } } as React.ChangeEvent<HTMLTextAreaElement>)}
                  >
                    "Search for recent legislation"
                  </button>
                  <button
                    className="chip"
                    onClick={() => handleInputChange({ target: { value: "Analyze campaign donations" } } as React.ChangeEvent<HTMLTextAreaElement>)}
                  >
                    "Analyze campaign donations"
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} isStreaming={isLoading && message === messages[messages.length - 1]} />
            ))}
          </div>

          {/* Enhanced progress display with tool execution tracking */}
          <ToolExecutionProgress
            isVisible={isLoading}
            currentTool={analysisStep}
          />

          {/* Multi-step analysis indicator */}
          {isLoading && currentTool && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-400 p-4 mx-4 mb-4">
              <div className="flex items-start">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-blue-800">
                    Campaign Finance Analysis in Progress
                  </h3>
                  <div className="mt-2 text-sm text-blue-700">
                    <p>Step: {analysisStep}</p>
                    <p className="text-xs mt-1 text-blue-600">
                      The AI may execute multiple tools and think through complex connections.
                      This enables deeper analysis of political patterns and conflicts of interest.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-4 mb-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3 flex-1">
                  <h3 className="text-sm font-medium text-red-800">
                    Analysis Error
                  </h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                  <div className="mt-3 flex gap-2">
                    {retryCount < 3 && (
                      <button
                        onClick={handleRetry}
                        className="bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded text-sm font-medium transition-colors"
                      >
                        Retry ({3 - retryCount} attempts left)
                      </button>
                    )}
                    <button
                      onClick={clearError}
                      className="bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded text-sm font-medium transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4">
          <form onSubmit={handleSendMessage}>
            <ChatInput
              value={input}
              onChange={(value: string) => handleInputChange({ target: { value } } as React.ChangeEvent<HTMLTextAreaElement>)}
              onSubmit={() => {
                if (input.trim() && !isLoading) {
                  const event = new Event('submit', { bubbles: true, cancelable: true });
                  handleSubmit(event as any);
                }
              }}
              placeholder="Ask me anything about campaign finance..."
              isStreaming={isLoading}
              canSend={!isLoading && input.trim().length > 0}
            />
          </form>
        </div>
      </div>
    </div>
  );
};