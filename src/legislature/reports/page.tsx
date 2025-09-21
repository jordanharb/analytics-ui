'use client';

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { createClient } from '@/lib/supabase/client';

interface Report {
  filename: string;
  legislatorName: string;
  createdAt: string;
  preview: string;
  size: number;
}

interface Legislator {
  legislator_id: number;
  full_name: string;
  party: string;
  body: string;
}

export default function ReportsPage() {
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [selectedLegislator, setSelectedLegislator] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [consoleOutput, setConsoleOutput] = useState('');
  const [currentReport, setCurrentReport] = useState<string>('');
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Load legislators on mount
  useEffect(() => {
    loadLegislators();
    loadReports();
  }, []);

  // Auto-scroll console output
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleOutput]);

  const loadLegislators = async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('legislators')
      .select('legislator_id, full_name, party, body')
      .order('full_name');
    
    if (!error && data) {
      setLegislators(data);
    }
  };

  const loadReports = async () => {
    try {
      const response = await fetch('/api/reports/list');
      const data = await response.json();
      if (data.reports) {
        setReports(data.reports);
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    }
  };

  const loadReport = async (filename: string) => {
    try {
      const response = await fetch(`/api/reports/${filename}`);
      const data = await response.json();
      if (data.content) {
        setCurrentReport(data.content);
        setSelectedReport(filename);
      }
    } catch (error) {
      console.error('Failed to load report:', error);
    }
  };

  const generateReport = async () => {
    if (!selectedLegislator) {
      alert('Please select a legislator');
      return;
    }

    setIsGenerating(true);
    setConsoleOutput('');
    setCurrentReport('');
    
    try {
      // Start SSE connection for streaming output
      const response = await fetch('/api/reports/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ legislatorName: selectedLegislator })
      });

      if (!response.ok) {
        throw new Error('Failed to start report generation');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'output') {
                setConsoleOutput(prev => prev + data.text);
              } else if (data.type === 'error') {
                setConsoleOutput(prev => prev + `\n[ERROR] ${data.text}`);
              } else if (data.type === 'complete') {
                if (data.success && data.reportPath) {
                  // Load the generated report
                  const filename = data.reportPath.split('/').pop();
                  if (filename) {
                    await loadReport(filename);
                    await loadReports(); // Refresh the list
                  }
                }
                setIsGenerating(false);
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Generation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setConsoleOutput(prev => prev + `\n[ERROR] Failed to generate report: ${errorMessage}`);
      setIsGenerating(false);
    }
  };

  const filteredLegislators = legislators.filter(l => 
    l.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex h-screen">
        {/* Left Sidebar - Report History */}
        <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Report History</h2>
            <p className="text-sm text-gray-600 mt-1">{reports.length} reports</p>
          </div>
          <div className="divide-y">
            {reports.map((report) => (
              <div
                key={report.filename}
                className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                  selectedReport === report.filename ? 'bg-blue-50' : ''
                }`}
                onClick={() => loadReport(report.filename)}
              >
                <div className="font-medium text-sm">{report.legislatorName}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {new Date(report.createdAt).toLocaleDateString()} at{' '}
                  {new Date(report.createdAt).toLocaleTimeString()}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {(report.size / 1024).toFixed(1)} KB
                </div>
              </div>
            ))}
            {reports.length === 0 && (
              <div className="p-4 text-gray-500 text-sm">No reports yet</div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-white border-b border-gray-200 p-4">
            <h1 className="text-2xl font-bold mb-4">Campaign Finance Report Generator</h1>
            
            <div className="flex gap-4">
              {/* Legislator Search/Select */}
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search for a legislator..."
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <div className="absolute z-10 mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredLegislators.map((legislator) => (
                      <div
                        key={legislator.legislator_id}
                        className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                        onClick={() => {
                          setSelectedLegislator(legislator.full_name);
                          setSearchTerm(legislator.full_name);
                        }}
                      >
                        <div className="font-medium">{legislator.full_name}</div>
                        <div className="text-sm text-gray-600">
                          {legislator.party} - {legislator.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Generate Button */}
              <button
                onClick={generateReport}
                disabled={isGenerating || !selectedLegislator}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  isGenerating || !selectedLegislator
                    ? 'bg-gray-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Generating...
                  </span>
                ) : (
                  'Generate Report'
                )}
              </button>
            </div>
          </div>

          {/* Console Output (shown during generation) */}
          {isGenerating && (
            <div className="bg-black text-green-400 p-4 h-64 overflow-y-auto font-mono text-sm">
              <div ref={consoleRef}>
                <pre className="whitespace-pre-wrap">{consoleOutput}</pre>
              </div>
            </div>
          )}

          {/* Report Display */}
          <div className="flex-1 overflow-y-auto p-6 bg-white">
            {currentReport ? (
              <div className="prose prose-lg max-w-none">
                <ReactMarkdown>{currentReport}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-lg">Select a legislator and click Generate to create a report</p>
                <p className="text-sm mt-2">Or select a report from the history on the left</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}