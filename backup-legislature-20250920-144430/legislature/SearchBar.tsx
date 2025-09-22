import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchAll } from '../../lib/legislature-api';
import type { SearchResult } from '../../lib/legislature-types';

export const SearchBar: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{
    entities: SearchResult[];
    legislators: SearchResult[];
    bills: SearchResult[];
  }>({ entities: [], legislators: [], bills: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults({ entities: [], legislators: [], bills: [] });
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await searchAll(searchQuery);
      setResults(data);
      setIsOpen(true);
    } catch (error) {
      console.error('Search failed:', error);
      setResults({ entities: [], legislators: [], bills: [] });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleSearch(query);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, handleSearch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleResultClick = (result: SearchResult) => {
    navigate(result.url);
    setIsOpen(false);
    setQuery('');
  };

  const totalResults = results.entities.length + results.legislators.length + results.bills.length;

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl mx-auto">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search candidates, legislators, bills..."
          className="w-full px-4 py-3 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          </div>
        )}
      </div>

      {isOpen && totalResults > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {results.entities.length > 0 && (
            <div className="p-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1">
                Candidates & Committees
              </h3>
              {results.entities.map((result) => (
                <button
                  key={`entity-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded flex flex-col"
                >
                  <span className="font-medium">{result.title}</span>
                  {result.subtitle && (
                    <span className="text-sm text-gray-500">{result.subtitle}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {results.legislators.length > 0 && (
            <div className="p-2 border-t">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1">
                Legislators
              </h3>
              {results.legislators.map((result) => (
                <button
                  key={`legislator-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded flex flex-col"
                >
                  <span className="font-medium">{result.title}</span>
                  {result.subtitle && (
                    <span className="text-sm text-gray-500">{result.subtitle}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {results.bills.length > 0 && (
            <div className="p-2 border-t">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-1">
                Bills
              </h3>
              {results.bills.map((result) => (
                <button
                  key={`bill-${result.id}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 rounded"
                >
                  <div className="font-medium">{result.title}</div>
                  {result.description && (
                    <div className="text-sm text-gray-500 line-clamp-2">{result.description}</div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};