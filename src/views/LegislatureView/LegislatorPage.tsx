import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchLegislatorOverview, fetchLegislatorVotes, fetchLegislatorSponsorships } from '../../lib/legislature-api';
import { Tabs } from '../../components/legislature/Tabs';
import { Table, TableLink, formatDate } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { StatTiles } from '../../components/legislature/StatTiles';
import type { LegislatorOverview, LegislatorVote, LegislatorSponsorship } from '../../lib/legislature-types';

export const LegislatorPage: React.FC = () => {
  const { legislatorId } = useParams<{ legislatorId: string }>();
  const [legislator, setLegislator] = useState<LegislatorOverview | null>(null);
  const [votes, setVotes] = useState<LegislatorVote[]>([]);
  const [sponsorships, setSponsorships] = useState<LegislatorSponsorship[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (legislatorId) {
      loadData();
    }
  }, [legislatorId]);

  const loadData = async () => {
    if (!legislatorId) return;
    
    setIsLoading(true);
    try {
      const [overviewData, votesData, sponsorshipsData] = await Promise.all([
        fetchLegislatorOverview(Number(legislatorId)),
        fetchLegislatorVotes(Number(legislatorId), undefined, { limit: 50 }),
        fetchLegislatorSponsorships(Number(legislatorId))
      ]);
      
      setLegislator(overviewData);
      setVotes(votesData.data);
      setSponsorships(sponsorshipsData);
    } catch (error) {
      console.error('Failed to load legislator data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!legislator) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Legislator Not Found</h2>
          <Link to="/legislature" className="text-blue-600 hover:text-blue-800">
            Back to Legislature Home
          </Link>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Votes', value: legislator.total_votes || 0 },
    { label: 'Bills Sponsored', value: legislator.total_bills_sponsored || 0 },
    { label: 'Party', value: legislator.party },
    { label: 'Chamber', value: legislator.chamber || 'N/A' }
  ];

  const voteColumns: Column<LegislatorVote>[] = [
    {
      key: 'bill',
      header: 'Bill',
      accessor: (item) => (
        <TableLink to={`/legislature/bill/${item.bill_id}`}>
          {item.bill_number}
        </TableLink>
      )
    },
    {
      key: 'title',
      header: 'Title',
      accessor: (item) => item.bill_title
    },
    {
      key: 'vote',
      header: 'Vote',
      accessor: (item) => (
        <span className={`font-medium ${
          item.vote_value === 'YES' ? 'text-green-600' :
          item.vote_value === 'NO' ? 'text-red-600' :
          'text-gray-600'
        }`}>
          {item.vote_value}
        </span>
      )
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (item) => formatDate(item.vote_date)
    }
  ];

  const sponsorshipColumns: Column<LegislatorSponsorship>[] = [
    {
      key: 'bill',
      header: 'Bill',
      accessor: (item) => (
        <TableLink to={`/legislature/bill/${item.bill_id}`}>
          {item.bill_number}
        </TableLink>
      )
    },
    {
      key: 'title',
      header: 'Title',
      accessor: (item) => item.bill_title
    },
    {
      key: 'type',
      header: 'Sponsorship Type',
      accessor: (item) => item.sponsorship_type
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (item) => (
        <span className="px-2 py-1 text-xs rounded-full bg-gray-100">
          {item.status}
        </span>
      )
    }
  ];

  const tabs = [
    {
      id: 'votes',
      label: 'Voting Record',
      content: <Table data={votes} columns={voteColumns} />
    },
    {
      id: 'sponsorships',
      label: 'Sponsored Bills',
      content: <Table data={sponsorships} columns={sponsorshipColumns} />
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
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

      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">{legislator.full_name}</h1>
          <StatTiles stats={stats} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <Tabs tabs={tabs} defaultTab="votes" />
        </div>
      </div>
    </div>
  );
};