import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { EntityHeader } from '../../components/legislature/candidate/EntityHeader';
import { EntityTransactionsTable } from '../../components/legislature/candidate/EntityTransactionsTable';
import { EntityReportsAndDonations } from '../../components/legislature/candidate/EntityReportsAndDonations';
import { Tabs } from '../../components/legislature/Tabs';
import { fetchEntityOverview } from '../../lib/legislature-api';
import type { EntityOverview } from '../../lib/legislature-types';

export const CandidatePage: React.FC = () => {
  const { entityId } = useParams<{ entityId: string }>();
  const [entity, setEntity] = useState<EntityOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (entityId) {
      loadEntity();
    }
  }, [entityId]);

  const loadEntity = async () => {
    if (!entityId) return;
    
    setIsLoading(true);
    try {
      const data = await fetchEntityOverview(Number(entityId));
      setEntity(data);
    } catch (error) {
      console.error('Failed to load entity:', error);
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

  if (!entity) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Entity Not Found</h2>
          <Link to="/legislature" className="text-blue-600 hover:text-blue-800">
            Back to Legislature Home
          </Link>
        </div>
      </div>
    );
  }

  const tabs = [
    {
      id: 'transactions',
      label: 'Transactions',
      content: <EntityTransactionsTable entityId={Number(entityId)} />
    },
    {
      id: 'reports',
      label: 'Reports & Donations',
      content: <EntityReportsAndDonations entityId={Number(entityId)} />
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

      <EntityHeader entity={entity} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <Tabs tabs={tabs} defaultTab="transactions" />
        </div>
      </div>
    </div>
  );
};