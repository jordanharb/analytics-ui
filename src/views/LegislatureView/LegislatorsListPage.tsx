import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableLink } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { supabase2 } from '../../lib/supabase2';

interface Legislator {
  legislator_id: number;
  full_name: string;
  party: string;
  body: string;
  district: number;
  vote_count: number;
  sponsored_count: number;
}

export const LegislatorsListPage: React.FC = () => {
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLegislators();
  }, []);

  const loadLegislators = async () => {
    setIsLoading(true);
    try {
      // Query the materialized view for better performance
      const { data, error } = await supabase2
        .from('rs_mv_legislator_activity')
        .select('*')
        .order('full_name');
      
      if (error) throw error;
      setLegislators(data || []);
    } catch (error) {
      console.error('Failed to load legislators:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<Legislator>[] = [
    {
      key: 'name',
      header: 'Name',
      accessor: (item) => (
        <TableLink to={`/legislature/legislator/${item.legislator_id}`}>
          {item.full_name}
        </TableLink>
      )
    },
    {
      key: 'party',
      header: 'Party',
      accessor: (item) => item.party
    },
    {
      key: 'chamber',
      header: 'Chamber',
      accessor: (item) => item.body
    },
    {
      key: 'district',
      header: 'District',
      accessor: (item) => item.district
    },
    {
      key: 'votes',
      header: 'Total Votes',
      accessor: (item) => item.vote_count?.toLocaleString() || '0'
    },
    {
      key: 'sponsored',
      header: 'Bills Sponsored',
      accessor: (item) => item.sponsored_count?.toLocaleString() || '0'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">All Legislators</h1>
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
            data={legislators}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No legislators found"
            stickyHeader
          />
        </div>
      </div>
    </div>
  );
};