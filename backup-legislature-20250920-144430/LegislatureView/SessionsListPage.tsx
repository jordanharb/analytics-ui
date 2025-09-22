import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableLink, formatDate } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { supabase2 } from '../../lib/supabase2';

interface Session {
  session_id: number;
  session_name: string;
  year: number;
  start_date: string;
  end_date: string;
}

export const SessionsListPage: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase2
        .from('sessions')
        .select('session_id, session_name, year, start_date, end_date')
        .order('year', { ascending: false });
      
      if (error) throw error;
      setSessions(data || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<Session>[] = [
    {
      key: 'name',
      header: 'Session Name',
      accessor: (item) => (
        <TableLink to={`/legislature/session/${item.session_id}`}>
          {item.session_name}
        </TableLink>
      )
    },
    {
      key: 'year',
      header: 'Year',
      accessor: (item) => item.year,
      sortable: true
    },
    {
      key: 'start',
      header: 'Start Date',
      accessor: (item) => item.start_date ? formatDate(item.start_date) : '-'
    },
    {
      key: 'end',
      header: 'End Date',
      accessor: (item) => item.end_date ? formatDate(item.end_date) : 'Ongoing'
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (item) => {
        const now = new Date();
        const end = item.end_date ? new Date(item.end_date) : null;
        const isActive = !end || end > now;
        
        return (
          <span className={`px-2 py-1 text-xs rounded-full font-medium ${
            isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
          }`}>
            {isActive ? 'Active' : 'Completed'}
          </span>
        );
      }
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Legislative Sessions</h1>
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
        <div className="bg-white rounded-lg shadow">
          <Table
            data={sessions}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No sessions found"
            stickyHeader
          />
        </div>
      </div>
    </div>
  );
};