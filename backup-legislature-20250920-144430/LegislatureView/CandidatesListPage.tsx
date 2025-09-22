import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableLink, formatCurrency } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { fetchCandidates } from '../../lib/legislature-api';
import type { EntityOverview } from '../../lib/legislature-types';

export const CandidatesListPage: React.FC = () => {
  const [candidates, setCandidates] = useState<EntityOverview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCandidates();
  }, []);

  const loadCandidates = async () => {
    setIsLoading(true);
    try {
      const { data } = await fetchCandidates();
      setCandidates(data || []);
    } catch (error) {
      console.error('Failed to load candidates:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<EntityOverview>[] = [
    {
      key: 'name',
      header: 'Name',
      accessor: (item) => (
        <TableLink to={`/legislature/candidate/${item.entity_id}`}>
          {item.display_name}
        </TableLink>
      )
    },
    {
      key: 'party',
      header: 'Party',
      accessor: (item) => item.party || '-'
    },
    {
      key: 'office',
      header: 'Office',
      accessor: (item) => item.office || '-'
    },
    {
      key: 'raised',
      header: 'Total Raised',
      accessor: (item) => formatCurrency(item.total_raised || 0, false),
      sortable: true
    },
    {
      key: 'spent',
      header: 'Total Spent',
      accessor: (item) => formatCurrency(item.total_spent || 0, false),
      sortable: true
    },
    {
      key: 'transactions',
      header: 'Transactions',
      accessor: (item) => item.activity_count?.toLocaleString() || '0'
    },
    {
      key: 'period',
      header: 'Active Period',
      accessor: (item) => {
        if (!item.first_activity_date || !item.last_activity_date) return '-';
        const start = new Date(item.first_activity_date).getFullYear();
        const end = new Date(item.last_activity_date).getFullYear();
        return start === end ? `${start}` : `${start}-${end}`;
      }
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Candidates & Committees</h1>
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
            data={candidates}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No candidates found"
            stickyHeader
          />
        </div>
      </div>
    </div>
  );
};