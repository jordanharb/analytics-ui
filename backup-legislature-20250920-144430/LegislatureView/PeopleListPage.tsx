import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableLink, formatCurrency } from '../../components/legislature/Table';
import type { Column } from '../../components/legislature/Table';
import { fetchPeopleIndex } from '../../lib/legislature-people-api';
import type { PersonIndex } from '../../lib/legislature-people-types';

export const PeopleListPage: React.FC = () => {
  const [people, setPeople] = useState<PersonIndex[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredPeople, setFilteredPeople] = useState<PersonIndex[]>([]);

  useEffect(() => {
    loadPeople();
  }, []);

  useEffect(() => {
    // Client-side filtering for quick response
    if (searchQuery) {
      const filtered = people.filter(person =>
        person.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        person.positions_held?.some(pos => 
          pos.toLowerCase().includes(searchQuery.toLowerCase())
        )
      );
      setFilteredPeople(filtered);
    } else {
      setFilteredPeople(people);
    }
  }, [searchQuery, people]);

  const loadPeople = async () => {
    setIsLoading(true);
    try {
      const { data } = await fetchPeopleIndex('', 500, 0);
      setPeople(data);
      setFilteredPeople(data);
    } catch (error) {
      console.error('Failed to load people:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<PersonIndex>[] = [
    {
      key: 'name',
      header: 'Name',
      accessor: (item) => (
        <TableLink to={`/legislature/person/${item.person_id}`}>
          {item.display_name}
        </TableLink>
      )
    },
    {
      key: 'positions',
      header: 'Chamber/District',
      accessor: (item) => {
        if (!item.positions_held || item.positions_held.length === 0) {
          return <span className="text-gray-400">-</span>;
        }
        
        return (
          <div className="flex flex-wrap gap-1">
            {item.positions_held.map((pos, idx) => (
              <span key={idx} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                {pos}
              </span>
            ))}
          </div>
        );
      }
    },
    {
      key: 'sponsored',
      header: 'Bills Sponsored',
      accessor: (item) => (
        <span className="font-medium">
          {item.sponsored_count?.toLocaleString() || '0'}
        </span>
      ),
      sortable: true
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">People Directory</h1>
              <p className="text-sm text-gray-600 mt-1">
                Unified view of legislators and campaign finance entities
              </p>
            </div>
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by name or position..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-gray-900">
              {filteredPeople.length}
            </div>
            <div className="text-sm text-gray-600">Total People</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-blue-600">
              {filteredPeople.filter(p => p.sponsored_count > 0).length}
            </div>
            <div className="text-sm text-gray-600">Active Legislators</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-green-600">
              {filteredPeople.reduce((sum, p) => sum + (p.sponsored_count || 0), 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Bills Sponsored</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-purple-600">
              {filteredPeople.filter(p => p.last_active_date && new Date(p.last_active_date).getFullYear() >= 2023).length}
            </div>
            <div className="text-sm text-gray-600">Recently Active</div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow">
          <Table
            data={filteredPeople}
            columns={columns}
            isLoading={isLoading}
            emptyMessage="No people found"
            stickyHeader
          />
        </div>
      </div>
    </div>
  );
};