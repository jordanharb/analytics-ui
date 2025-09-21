'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';

interface Legislator {
  legislator_id: number;
  full_name: string;
  party: string;
  body: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ReportsChatPage() {
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [selectedLegislator, setSelectedLegislator] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [sessionId, setSessionId] = useState<string>('');
  const [showDropdown, setShowDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadLegislators();
    setSessionId(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadLegislators = async () => {
    try {
      const response = await fetch('/api/legislators');
      if (response.ok) {
        const data = await response.json();
        setLegislators(data);
      }
    } catch (error) {
      console.error('Failed to load legislators:', error);
    }
  };

  const generateInitialReport = async () => {
    if (!selectedLegislator) {
      alert('Please select a legislator');
      return;
    }

    setIsGenerating(true);
    setMessages([]);
    setStats(null);
    
    setMessages([{
      role: 'assistant',
      content: `🔍 Analyzing campaign finance data for ${selectedLegislator}...\n\nThis comprehensive analysis will examine:\n- Campaign donations across all years\n- Voting patterns and party outliers\n- Connections between donors and legislative actions\n- Bill sponsorships and potential conflicts of interest`,
      timestamp: new Date()
    }]);

    try {
      const response = await fetch('/api/reports/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          legislatorName: selectedLegislator,
          message: '',
          isInitial: true
        })
      });

      const data = await response.json();
      
      if (data.error) {
        setMessages([{
          role: 'assistant',
          content: `❌ Error: ${data.error}`,
          timestamp: new Date()
        }]);
      } else {
        setMessages([{
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        }]);
        setStats(data.stats);
      }
    } catch (error) {
      setMessages([{
        role: 'assistant',
        content: '❌ Failed to generate report. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isGenerating) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setIsGenerating(true);

    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    try {
      const response = await fetch('/api/reports/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          legislatorName: selectedLegislator,
          message: userMessage,
          isInitial: false
        })
      });

      const data = await response.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || 'No response generated',
        timestamp: new Date()
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Failed to get response. Please try again.',
        timestamp: new Date()
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredLegislators = legislators.filter(l => 
    l.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const downloadReport = () => {
    const content = messages.map(m => 
      `${m.role === 'user' ? '### Question' : '### Analysis'}\n${m.content}\n\n`
    ).join('');
    
    const blob = new Blob([`# Campaign Finance Report: ${selectedLegislator}\n\nGenerated: ${new Date().toISOString()}\n\n${content}`], 
      { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLegislator.replace(/\s+/g, '_')}_report.md`;
    a.click();
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '0.5rem',
          color: '#1f2937',
        }}>
          AI Campaign Finance Analysis
        </h1>
        <p style={{
          fontSize: '1rem',
          color: '#6b7280',
          marginBottom: '1.5rem',
        }}>
          Generate comprehensive reports analyzing connections between campaign donations and legislative actions using AI.
        </p>
      </div>

      {/* Controls */}
      <div style={{
        backgroundColor: '#f9fafb',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        marginBottom: '1.5rem',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ marginBottom: '1rem', position: 'relative' }}>
          <label style={{
            display: 'block',
            fontSize: '0.875rem',
            fontWeight: '500',
            color: '#374151',
            marginBottom: '0.5rem',
          }}>
            Select Legislator
          </label>
          <input
            type="text"
            placeholder="Type to search legislators..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '2px solid #d1d5db',
              borderRadius: '0.5rem',
              outline: 'none',
              backgroundColor: 'white',
            }}
          />
          
          {showDropdown && searchTerm && filteredLegislators.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              marginTop: '0.25rem',
              maxHeight: '300px',
              overflowY: 'auto',
              zIndex: 10,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}>
              {filteredLegislators.map((legislator) => (
                <div
                  key={legislator.legislator_id}
                  onClick={() => {
                    setSelectedLegislator(legislator.full_name);
                    setSearchTerm(legislator.full_name);
                    setShowDropdown(false);
                    setSessionId(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
                    setMessages([]);
                    setStats(null);
                  }}
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  <div style={{ fontWeight: '500' }}>{legislator.full_name}</div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    {legislator.party} - {legislator.body === 'H' ? 'House' : 'Senate'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={generateInitialReport}
            disabled={isGenerating || !selectedLegislator}
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              fontWeight: '500',
              color: isGenerating || !selectedLegislator ? '#9ca3af' : 'white',
              backgroundColor: isGenerating || !selectedLegislator ? '#e5e7eb' : '#3b82f6',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: isGenerating || !selectedLegislator ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {isGenerating ? '⏳ Generating...' : '📊 Generate Report'}
          </button>

          {messages.length > 0 && (
            <button
              onClick={downloadReport}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '1rem',
                fontWeight: '500',
                color: 'white',
                backgroundColor: '#10b981',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: 'pointer',
              }}
            >
              📥 Download
            </button>
          )}

          {stats && (
            <div style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: '1.5rem',
              fontSize: '0.875rem',
              color: '#6b7280',
            }}>
              <span>💰 {stats.donations} donations</span>
              <span>🗳️ {stats.votes} votes</span>
              <span>📝 {stats.sponsorships} sponsorships</span>
            </div>
          )}
        </div>
      </div>

      {/* Chat Interface */}
      <div style={{
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '0.5rem',
        height: '600px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Messages */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
        }}>
          {messages.length === 0 ? (
            <div style={{
              textAlign: 'center',
              color: '#9ca3af',
              paddingTop: '4rem',
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
              <p style={{ fontSize: '1.125rem', fontWeight: '500' }}>
                Select a legislator and generate a report to begin
              </p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                The AI will analyze campaign donations, voting patterns, and potential conflicts of interest
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {messages.map((message, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '1rem',
                    backgroundColor: message.role === 'user' ? '#eff6ff' : '#f9fafb',
                    borderRadius: '0.5rem',
                    border: `1px solid ${message.role === 'user' ? '#dbeafe' : '#e5e7eb'}`,
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '0.5rem',
                  }}>
                    <span style={{
                      fontWeight: '500',
                      fontSize: '0.875rem',
                      color: message.role === 'user' ? '#2563eb' : '#059669',
                    }}>
                      {message.role === 'user' ? '👤 You' : '🤖 AI Analysis'}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      color: '#9ca3af',
                    }}>
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '0.9375rem',
                    lineHeight: '1.6',
                    color: '#374151',
                  }}>
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {messages.length > 0 && (
          <div style={{
            borderTop: '1px solid #e5e7eb',
            padding: '1rem',
            backgroundColor: '#f9fafb',
          }}>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Ask a follow-up question..."
                disabled={isGenerating}
                style={{
                  flex: 1,
                  padding: '0.75rem 1rem',
                  fontSize: '0.9375rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  outline: 'none',
                  backgroundColor: 'white',
                }}
              />
              <button
                onClick={sendMessage}
                disabled={isGenerating || !inputMessage.trim()}
                style={{
                  padding: '0.75rem 1.5rem',
                  fontSize: '0.9375rem',
                  fontWeight: '500',
                  color: isGenerating || !inputMessage.trim() ? '#9ca3af' : 'white',
                  backgroundColor: isGenerating || !inputMessage.trim() ? '#e5e7eb' : '#3b82f6',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: isGenerating || !inputMessage.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isGenerating ? '...' : 'Send'}
              </button>
            </div>
            <div style={{
              marginTop: '0.5rem',
              fontSize: '0.75rem',
              color: '#9ca3af',
            }}>
              Example: "Which energy companies donated?" • "Show votes on insurance bills" • "What bills did they sponsor?"
            </div>
          </div>
        )}
      </div>
    </div>
  );
}