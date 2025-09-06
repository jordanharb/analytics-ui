import React, { useState, useEffect } from 'react';
import { useFiltersStore } from '../../state/filtersStore';

interface SearchBarProps {
  placeholder?: string;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({ 
  placeholder = "Search events by topic, description, or context...",
  className = ""
}) => {
  const { searchQuery, setSearchQuery, applyFilters, isSearching } = useFiltersStore();
  const [localQuery, setLocalQuery] = useState('');
  const [hasActiveSearch, setHasActiveSearch] = useState(false);

  // Update local state when search is cleared externally
  useEffect(() => {
    if (!searchQuery) {
      setHasActiveSearch(false);
      setLocalQuery('');
    }
  }, [searchQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (localQuery.trim()) {
      console.log('Applying search:', localQuery);
      setHasActiveSearch(true);
      
      // Wait for embedding to be generated
      await setSearchQuery(localQuery.trim());
      
      // Small delay to ensure state is updated
      setTimeout(() => {
        console.log('Applying filters after embedding generation');
        applyFilters();
      }, 100);
    }
  };

  const handleClear = async () => {
    console.log('Clearing search');
    setLocalQuery('');
    setHasActiveSearch(false);
    await setSearchQuery('');
    
    // Small delay to ensure state is updated
    setTimeout(() => {
      applyFilters();
    }, 100);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(e.target.value);
  };

  return (
    <div className={`${className}`}>
      {/* Search Form */}
      {!hasActiveSearch ? (
        <form onSubmit={handleSubmit} className="relative">
          <div className="relative">
            {/* Search Icon */}
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg 
                className="h-5 w-5 text-gray-400" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
                />
              </svg>
            </div>

            {/* Input Field */}
            <input
              type="text"
              value={localQuery}
              onChange={handleInputChange}
              placeholder={placeholder}
              className="block w-full pl-10 pr-20 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />

            {/* Enter hint or Loading */}
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              {isSearching ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
              ) : localQuery ? (
                <span className="text-xs text-gray-400">Press Enter</span>
              ) : null}
            </div>
          </div>
        </form>
      ) : (
        /* Active Search Token */
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full">
            <svg 
              className="h-4 w-4 mr-2" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
              />
            </svg>
            <span className="text-sm font-medium">{searchQuery}</span>
            <button
              onClick={handleClear}
              className="ml-2 hover:text-blue-900 focus:outline-none"
              title="Clear search"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </button>
          </div>
          {isSearching && (
            <span className="text-sm text-gray-500">Searching...</span>
          )}
        </div>
      )}
    </div>
  );
};