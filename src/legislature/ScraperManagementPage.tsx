import React, { useState, useEffect, useRef } from 'react';

interface Worker {
  id: string;
  name: string;
  description: string;
  scriptPath: string;
  status: 'idle' | 'running' | 'error';
  lastRun?: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const workers: Worker[] = [
  {
    id: 'campaign-finance',
    name: 'Campaign Finance Updater',
    description: 'Updates entities, transactions, PDFs, and people records',
    scriptPath: 'scripts/run_campaign_finance_update.sh',
    status: 'idle'
  },
  {
    id: 'legislature',
    name: 'Legislature Updater',
    description: 'Updates sessions, bills, votes, and bill content',
    scriptPath: 'scripts/run_legislature_update.sh',
    status: 'idle'
  }
];

export function ScraperManagementPage() {
  const [workerStates, setWorkerStates] = useState<Map<string, Worker>>(
    new Map(workers.map(w => [w.id, w]))
  );
  const [activeLogs, setActiveLogs] = useState<Map<string, LogEntry[]>>(new Map());
  const [expandedWorker, setExpandedWorker] = useState<string | null>(null);
  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const logContainerRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (expandedWorker) {
      const container = logContainerRefs.current.get(expandedWorker);
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [activeLogs, expandedWorker]);

  // Cleanup event sources on unmount
  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach(es => es.close());
    };
  }, []);

  const startWorker = async (workerId: string) => {
    const worker = workerStates.get(workerId);
    if (!worker) return;

    try {
      // Start the worker
      const response = await fetch(`/api/scrapers/start/${workerId}`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to start worker');
      }

      // Update status
      setWorkerStates(prev => {
        const updated = new Map(prev);
        updated.set(workerId, { ...worker, status: 'running' });
        return updated;
      });

      // Clear old logs
      setActiveLogs(prev => {
        const updated = new Map(prev);
        updated.set(workerId, []);
        return updated;
      });

      // Open console stream
      setExpandedWorker(workerId);

      // Connect to log stream
      const eventSource = new EventSource(`/api/scrapers/logs/${workerId}`);

      eventSource.onmessage = (event) => {
        const logEntry: LogEntry = JSON.parse(event.data);
        setActiveLogs(prev => {
          const updated = new Map(prev);
          const logs = updated.get(workerId) || [];
          updated.set(workerId, [...logs, logEntry]);
          return updated;
        });
      };

      eventSource.onerror = () => {
        console.error('Log stream error for', workerId);
        eventSource.close();
        eventSourcesRef.current.delete(workerId);

        // Update status to idle
        setWorkerStates(prev => {
          const updated = new Map(prev);
          const worker = updated.get(workerId);
          if (worker) {
            updated.set(workerId, { ...worker, status: 'idle', lastRun: new Date().toISOString() });
          }
          return updated;
        });
      };

      eventSourcesRef.current.set(workerId, eventSource);

    } catch (error) {
      console.error('Failed to start worker:', error);
      setWorkerStates(prev => {
        const updated = new Map(prev);
        updated.set(workerId, { ...worker, status: 'error' });
        return updated;
      });
    }
  };

  const stopWorker = async (workerId: string) => {
    const worker = workerStates.get(workerId);
    if (!worker) return;

    try {
      await fetch(`/api/scrapers/stop/${workerId}`, {
        method: 'POST'
      });

      // Close event source
      const eventSource = eventSourcesRef.current.get(workerId);
      if (eventSource) {
        eventSource.close();
        eventSourcesRef.current.delete(workerId);
      }

      // Update status
      setWorkerStates(prev => {
        const updated = new Map(prev);
        updated.set(workerId, { ...worker, status: 'idle', lastRun: new Date().toISOString() });
        return updated;
      });

    } catch (error) {
      console.error('Failed to stop worker:', error);
    }
  };

  const toggleConsole = (workerId: string) => {
    if (expandedWorker === workerId) {
      setExpandedWorker(null);
    } else {
      setExpandedWorker(workerId);
    }
  };

  const getStatusColor = (status: Worker['status']) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  const getLogTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'success': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Scraper Management</h1>
        <p className="text-gray-600">Manage and monitor data collection workers</p>
      </div>

      <div className="space-y-4">
        {Array.from(workerStates.values()).map(worker => (
          <div key={worker.id} className="bg-white rounded-lg shadow-md overflow-hidden">
            {/* Worker Header */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-4">
                  {/* Status Indicator */}
                  <div className="pt-1">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(worker.status)}`}></div>
                  </div>

                  {/* Worker Info */}
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900">{worker.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{worker.description}</p>
                    {worker.lastRun && (
                      <p className="text-xs text-gray-500 mt-2">
                        Last run: {new Date(worker.lastRun).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex space-x-2">
                  {worker.status === 'running' ? (
                    <button
                      onClick={() => stopWorker(worker.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => startWorker(worker.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      Run
                    </button>
                  )}

                  <button
                    onClick={() => toggleConsole(worker.id)}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                  >
                    {expandedWorker === worker.id ? 'Hide Console' : 'Show Console'}
                  </button>
                </div>
              </div>
            </div>

            {/* Console Output */}
            {expandedWorker === worker.id && (
              <div className="bg-gray-900 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-400">Console Output</h4>
                  <button
                    onClick={() => setActiveLogs(prev => {
                      const updated = new Map(prev);
                      updated.set(worker.id, []);
                      return updated;
                    })}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    Clear
                  </button>
                </div>

                <div
                  ref={el => logContainerRefs.current.set(worker.id, el)}
                  className="bg-black rounded p-4 h-96 overflow-y-auto font-mono text-sm"
                >
                  {activeLogs.get(worker.id)?.length === 0 ? (
                    <div className="text-gray-500 italic">
                      {worker.status === 'running' ? 'Waiting for output...' : 'No output. Click "Run" to start worker.'}
                    </div>
                  ) : (
                    activeLogs.get(worker.id)?.map((log, index) => (
                      <div key={index} className="mb-1">
                        <span className="text-gray-500 text-xs">
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </span>
                        {' '}
                        <span className={getLogTypeColor(log.type)}>
                          {log.message}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">How to Use</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-blue-800">
          <li><strong>Campaign Finance Updater:</strong> Runs incremental update (new entities only, first 100 for transactions, first 50 PDFs)</li>
          <li><strong>Legislature Updater:</strong> Updates current session (129) with new bills, votes, and content</li>
          <li>Click "Run" to start a worker and view live console output</li>
          <li>Click "Stop" to interrupt a running worker (progress is saved)</li>
          <li>Click "Show Console" to view output without starting the worker</li>
        </ul>
      </div>
    </div>
  );
}
