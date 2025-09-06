import React, { useEffect, useState } from 'react';
import { useFiltersStore, filterHelpers } from '../../state/filtersStore';
import { analyticsClient } from '../../api/analyticsClient';
import { MultiSelect } from './MultiSelect';
import { DateRangeFilter } from './DateRangeFilter';

interface FilterPanelProps {
  className?: string;
  onClose?: () => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ className = '', onClose }) => {
  const {
    pendingFilters,
    filterOptions,
    setFilter,
    applyFilters,
    resetFilters,
    setFilterOptions,
    networkExpanded,
    setNetworkExpanded
  } = useFiltersStore();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load filter options on mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    try {
      setLoading(true);
      const options = await analyticsClient.getFilterOptions();
      console.log('Loaded filter options:', options);
      console.log('actors_by_type:', options.actors_by_type);
      setFilterOptions(options);
      setError(null);
    } catch (err: any) {
      setError('Failed to load filter options');
      console.error('Error loading filter options:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    applyFilters();
    // Don't close the panel on apply
  };

  const handleReset = () => {
    resetFilters();
    // Don't close the panel on reset
  };

  const hasActiveFilters = filterHelpers.hasActiveFilters(pendingFilters);

  // Process filter options with the new optimized structure
  const { dynamicSlugsByParent, actorsByType } = React.useMemo(() => {
    if (!filterOptions) return { dynamicSlugsByParent: {}, actorsByType: {} };
    
    const slugsByParent: Record<string, Array<{ value: string; label: string; count: number }>> = {};
    const actorsByTypeMap: Record<string, Array<{ value: string; label: string }>> = {};
    
    // Process slugs_by_parent which now includes "Category" as a parent
    if (filterOptions.slugs_by_parent) {
      Object.entries(filterOptions.slugs_by_parent).forEach(([parent, slugs]) => {
        // Sort by count_global descending, then by label
        const sortedSlugs = [...slugs].sort((a, b) => {
          const countDiff = (b.count_global || 0) - (a.count_global || 0);
          if (countDiff !== 0) return countDiff;
          return a.label.localeCompare(b.label);
        });
        
        slugsByParent[parent] = sortedSlugs.map(slug => ({
          value: slug.slug,
          label: slug.label,
          count: slug.count_global || 0
        }));
      });
    }
    
    // Process actors by type
    if (filterOptions.actors_by_type) {
      Object.entries(filterOptions.actors_by_type).forEach(([type, actors]) => {
        // Sort actors alphabetically
        const sortedActors = [...actors].sort((a, b) => 
          a.name.localeCompare(b.name)
        );
        
        actorsByTypeMap[type] = sortedActors.map(actor => ({
          value: actor.id,
          label: actor.name
        }));
      });
    }
    
    return {
      dynamicSlugsByParent: slugsByParent,
      actorsByType: actorsByTypeMap
    };
  }, [filterOptions]);

  if (loading) {
    return (
      <div className={`bg-white p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white p-6 ${className}`}>
        <div className="text-red-600 text-sm">{error}</div>
        <button onClick={loadFilterOptions} className="mt-2 text-sm text-blue-600 hover:text-blue-800">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`bg-white border-r border-gray-200 overflow-hidden flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Filters</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Collapse filters"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>
      
      {/* Scrollable Content */}
      <div className="flex-1 p-6 space-y-6 overflow-y-auto scrollbar-thin">

        {/* Date Range */}
        <DateRangeFilter
          value={pendingFilters.period || pendingFilters.date_range}
          onChange={(value) => {
            if (typeof value === 'string') {
              setFilter('period', value as any);
              setFilter('date_range', undefined);
            } else {
              setFilter('date_range', value);
              setFilter('period', undefined);
            }
          }}
        />

        {/* Confidence Score */}
        <div className="filter-group">
          <label className="filter-title block mb-3">
            Confidence Score
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={pendingFilters.confidence || 0.5}
              onChange={(e) => setFilter('confidence', parseFloat(e.target.value))}
              className="flex-1"
            />
            <span className="text-sm text-gray-600 font-medium w-12 text-center">
              {((pendingFilters.confidence || 0.5) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* States */}
        <MultiSelect
          label="States"
          options={[
            'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
            'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
            'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
            'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
            'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
          ].map(state => ({ value: state, label: state }))}
          value={pendingFilters.states || []}
          onChange={(states) => setFilter('states', states)}
          placeholder="Select states..."
        />


        {/* Actor Types */}
        <MultiSelect
          label="Actor Types"
          options={[
            { value: 'person', label: 'People' },
            { value: 'organization', label: 'Organizations' },
            { value: 'chapter', label: 'Chapters' }
          ]}
          value={pendingFilters.actor_types || []}
          onChange={(types) => setFilter('actor_types', types as any)}
          placeholder="Select actor types..."
        />

        {/* All filter menus from slugs_by_parent (includes Category and dynamic parents) */}
        {Object.entries(dynamicSlugsByParent).map(([parent, slugs]) => {
          // Determine if this is a category or dynamic parent
          const isCategory = parent === 'Category';
          
          return (
            <MultiSelect
              key={parent}
              label={parent === 'Category' ? 'Tags' : parent.replace(/([A-Z])/g, ' $1').trim()}
              options={slugs.map(s => ({
                value: s.value,
                label: s.count > 0 ? `${s.label} (${s.count.toLocaleString()})` : s.label
              }))}
              value={pendingFilters.tags?.filter(tag => {
                if (isCategory) {
                  // For Category, match tags that don't have colons or match this parent
                  return !tag.includes(':') || slugs.some(s => s.value === tag);
                } else {
                  // For dynamic parents, match tags starting with parent:
                  return tag.startsWith(parent + ':');
                }
              }) || []}
              onChange={(selectedTags) => {
                if (isCategory) {
                  // Keep all dynamic slug tags
                  const dynamicTags = pendingFilters.tags?.filter(tag => 
                    tag.includes(':') && !slugs.some(s => s.value === tag)
                  ) || [];
                  setFilter('tags', [...dynamicTags, ...selectedTags]);
                } else {
                  // Keep tags from other parents
                  const otherTags = pendingFilters.tags?.filter(tag => 
                    !tag.startsWith(parent + ':')
                  ) || [];
                  setFilter('tags', [...otherTags, ...selectedTags]);
                }
              }}
              placeholder={`Select ${parent.toLowerCase()}...`}
              searchable={slugs.length > 10}
            />
          );
        })}


        {/* Actors - by type (new structure) */}
        {actorsByType && Object.keys(actorsByType).length > 0 && 
          Object.entries(actorsByType).map(([type, actors]) => (
            <MultiSelect
              key={`actors-${type}`}
              label={`${type.charAt(0).toUpperCase() + type.slice(1)}s`}
              options={actors}
              value={pendingFilters.actor_ids?.filter(id => 
                actors.some(a => a.value === id)
              ) || []}
              onChange={(selectedIds) => {
                const otherActorIds = pendingFilters.actor_ids?.filter(id => 
                  !actors.some(a => a.value === id)
                ) || [];
                setFilter('actor_ids', [...otherActorIds, ...selectedIds]);
              }}
              placeholder={`Select ${type}s...`}
              searchable
            />
          ))
        }

        {/* Actors - legacy structure */}
        {!actorsByType && filterOptions?.actors && filterOptions.actors.length > 0 && (
          <MultiSelect
            label="Specific Actors"
            options={filterOptions.actors.map(actor => ({
              value: actor.id,
              label: `${actor.name} (${actor.count_global})`
            }))}
            value={pendingFilters.actor_ids || []}
            onChange={(ids) => setFilter('actor_ids', ids)}
            placeholder="Select actors..."
            searchable
          />
        )}

        {/* Network Search - Expand to include actor networks */}
        {((pendingFilters.actor_ids && pendingFilters.actor_ids.length > 0) || 
          (pendingFilters.actor_types && pendingFilters.actor_types.length > 0)) && (
          <div className="filter-group" style={{ 
            padding: '0.75rem', 
            backgroundColor: '#E6F2FF', 
            border: '1px solid #0066CC', 
            borderRadius: '0.5rem' 
          }}>
            <label className="flex items-center cursor-pointer" style={{ gap: '0.5rem' }}>
              <input
                type="checkbox"
                style={{ 
                  borderRadius: '0.25rem',
                  borderColor: '#0066CC',
                  marginRight: '0.5rem'
                }}
                checked={networkExpanded}
                onChange={(e) => setNetworkExpanded(e.target.checked)}
              />
              <div className="flex-1">
                <span className="filter-title" style={{ color: '#0066CC' }}>
                  <svg className="inline w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Include Linked (+1)
                </span>
                <div className="text-xs" style={{ color: '#4B5563', marginTop: '0.25rem' }}>
                  Expand to include primary connections of selected actors
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Action Buttons - Fixed at bottom */}
      <div className="flex p-6 pt-4 border-t border-gray-200" style={{ gap: '0.75rem' }}>
        <button
          onClick={handleApply}
          className="btn-primary flex-1"
        >
          Apply Filters
        </button>
        <button
          onClick={handleReset}
          disabled={!hasActiveFilters}
          className="btn-secondary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>
    </div>
  );
};