import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableLink, formatDate } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { fetchSessionBills, fetchSessions } from '../../lib/legislature-api';
import type { SessionBill, SessionOverview } from '../../lib/legislature-types';

export const BillsListPage: React.FC = () => {
  const [bills, setBills] = useState<SessionBill[]>([]);
  const [sessions, setSessions] = useState<SessionOverview[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSessionId) {
      loadBills(selectedSessionId);
    }
  }, [selectedSessionId]);

  const loadSessions = async () => {
    try {
      const sessionsData = await fetchSessions();
      setSessions(sessionsData);
      if (sessionsData.length > 0) {
        const latestSession = sessionsData.reduce((latest, current) => {
          return new Date(latest.start_date) > new Date(current.start_date) ? latest : current;
        });
        setSelectedSessionId(latestSession.session_id);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const loadBills = async (sessionId: number) => {
    setIsLoading(true);
    try {
      const { data } = await fetchSessionBills(sessionId, { limit: 1000 });
      setBills(data);
    } catch (error) {
      console.error('Failed to load bills:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<SessionBill>[] = [
    {
      key: 'number',
      header: 'Bill Number',
      accessor: (item) => (
        <TableLink to={`/legislature/bill/${item.bill_id}`}>
          {item.bill_number}
        </TableLink>
      )
    },
    {
      key: 'title',
      header: 'Title',
      accessor: (item) => item.short_title || '-'
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (item) => (
        <span className={`px-2 py-1 text-xs rounded-full font-medium ${
          item.final_disposition?.toLowerCase().includes('passed') 
            ? 'bg-green-100 text-green-800'
            : item.final_disposition?.toLowerCase().includes('failed')
            ? 'bg-red-100 text-red-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {item.final_disposition || 'Pending'}
        </span>
      )
    },
    {
      key: 'introduced',
      header: 'Date Introduced',
      accessor: (item) => item.date_introduced ? formatDate(item.date_introduced) : '-',
      sortable: true
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">All Bills</h1>
            <Link 
              to="/legislature"
              className="text-gray-500 hover:text-gray-700 flex items-center gap-2 text-sm"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Legislature Home
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <select
            value={selectedSessionId || ''}
            onChange={(e) => setSelectedSessionId(Number(e.target.value))}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
          >
            {sessions.map((session) => (
              <option key={session.session_id} value={session.session_id}>
                {session.session_name}
              </option>
            ))}
          </select>
        </div>
        <div className="bg-white rounded-lg shadow">
          <Table
            data={bills}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No bills found for this session"
            stickyHeader
          />
        </div>
      </div>
    </div>
  );
};