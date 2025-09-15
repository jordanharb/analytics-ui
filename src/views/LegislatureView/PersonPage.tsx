import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Tabs } from '../../components/legislature/Tabs';
import { PersonVoteHistory } from '../../components/legislature/person/PersonVoteHistory';
import { PersonFinance } from '../../components/legislature/person/PersonFinance';
import { fetchPersonOverview } from '../../lib/legislature-api';
import type { PersonProfile } from '../../lib/legislature-types';

export const PersonPage: React.FC = () => {
  const { personId } = useParams<{ personId: string }>();
  const [person, setPerson] = useState<PersonProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (personId) {
      loadPerson();
    }
  }, [personId]);

  const loadPerson = async () => {
    if (!personId) return;
    
    setIsLoading(true);
    try {
      const personData = await fetchPersonOverview(Number(personId));
      setPerson(personData);
    } catch (error) {
      console.error('Failed to load person:', error);
      // Set a minimal person object so the page shows something
      setPerson({
        person_id: Number(personId),
        display_name: 'Person #' + personId,
        legislator_ids: [],
        entity_ids: [],
        total_votes: 0,
        total_sponsored: 0,
        total_raised: 0,
        total_spent: 0
      });
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

  if (!person) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Person Not Found</h2>
          <Link to="/legislature/people" className="text-blue-600 hover:text-blue-800">
            Back to People Directory
          </Link>
        </div>
      </div>
    );
  }

  const hasLegislativeData = person.legislator_ids && person.legislator_ids.length > 0;
  const hasFinanceData = person.entity_ids && person.entity_ids.length > 0;

  const tabs = [];
  
  if (hasLegislativeData) {
    tabs.push({
      id: 'votes',
      label: `Vote History (${person.total_votes || 0})`,
      content: <PersonVoteHistory personId={Number(personId)} />
    });
  }
  
  if (hasFinanceData) {
    tabs.push({
      id: 'finance',
      label: `Campaign Finance`,
      content: <PersonFinance personId={Number(personId)} entityIds={person.entity_ids} />
    });
  }

  if (tabs.length === 0) {
    tabs.push({
      id: 'none',
      label: 'No Data',
      content: (
        <div className="text-center py-12 text-gray-500">
          No legislative or campaign finance data available for this person.
        </div>
      )
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link 
            to="/legislature/people"
            className="text-gray-500 hover:text-gray-700 flex items-center gap-2 text-sm"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to People Directory
          </Link>
        </div>
      </div>

      {/* Person Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{person.display_name}</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {hasLegislativeData && (
              <>
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-900">
                    {person.total_votes?.toLocaleString() || '0'}
                  </div>
                  <div className="text-sm text-blue-700">Total Votes</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-purple-900">
                    {person.total_sponsored?.toLocaleString() || '0'}
                  </div>
                  <div className="text-sm text-purple-700">Bills Sponsored</div>
                </div>
              </>
            )}
            
            {hasFinanceData && (
              <>
                <div className="bg-green-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-900">
                    ${(person.total_raised || 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-green-700">Total Raised</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-900">
                    ${(person.total_spent || 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-red-700">Total Spent</div>
                </div>
              </>
            )}
          </div>

          {/* Linked IDs Info */}
          <div className="mt-4 text-sm text-gray-600">
            {hasLegislativeData && (
              <span className="mr-4">
                {person.legislator_ids.length} Legislator {person.legislator_ids.length === 1 ? 'ID' : 'IDs'}
              </span>
            )}
            {hasFinanceData && (
              <span>
                {person.entity_ids.length} Finance {person.entity_ids.length === 1 ? 'Entity' : 'Entities'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-6">
          <Tabs 
            tabs={tabs} 
            defaultTab={hasLegislativeData ? 'votes' : 'finance'} 
          />
        </div>
      </div>
    </div>
  );
};