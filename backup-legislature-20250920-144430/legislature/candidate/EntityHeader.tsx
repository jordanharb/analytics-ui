import React from 'react';
import { StatTiles } from '../StatTiles';
import type { EntityOverview } from '../../../lib/legislature-types';

interface EntityHeaderProps {
  entity: EntityOverview;
}

export const EntityHeader: React.FC<EntityHeaderProps> = ({ entity }) => {
  const stats = [
    {
      label: 'Total Raised',
      value: entity.total_raised || 0,
      icon: (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      label: 'Total Spent',
      value: entity.total_spent || 0,
      icon: (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    },
    {
      label: 'Total Activities',
      value: entity.activity_count || 0,
      icon: (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      )
    },
    {
      label: 'Activity Period',
      value: entity.first_activity_date && entity.last_activity_date
        ? `${new Date(entity.first_activity_date).getFullYear()} - ${new Date(entity.last_activity_date).getFullYear()}`
        : 'N/A',
      icon: (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    }
  ];

  return (
    <div className="bg-white border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{entity.display_name}</h1>
          <div className="mt-2 flex items-center gap-4 text-sm text-gray-600">
            {entity.party && (
              <span className="flex items-center gap-1">
                <span className="font-medium">Party:</span> {entity.party}
              </span>
            )}
            {entity.office && (
              <span className="flex items-center gap-1">
                <span className="font-medium">Office:</span> {entity.office}
              </span>
            )}
            {entity.status && (
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                entity.status === 'ACTIVE' 
                  ? 'bg-green-100 text-green-800'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {entity.status}
              </span>
            )}
          </div>
        </div>
        
        <StatTiles stats={stats} />
      </div>
    </div>
  );
};