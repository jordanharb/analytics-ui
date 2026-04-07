import React, { useEffect, useState } from 'react';
import { useFiltersStore, filterHelpers } from '../../state/filtersStore';
import { analyticsClient } from '../../api/analyticsClient';
import { MultiSelect } from './MultiSelect';
import { DateRangeFilter } from './DateRangeFilter';

interface FilterPanelProps {
  className?: string;
  onClose?: () => void;
  hideDateFilter?: boolean;
}

// fieldnotes palette (mirrors EventCard.tsx)
// surface  #fdfaf2   page bg #f6f1e6   ink #1a1a1a   muted #6b6b6b
// accent   #c2410c (burnt orange)      accent text #9a330a
// neutral  #ede5d2

export const FilterPanel: React.FC<FilterPanelProps> = ({
  className = '',
  onClose,
  hideDateFilter = false,
}) => {
  const {
    pendingFilters,
    filterOptions,
    setFilter,
    applyFilters,
    resetFilters,
    setFilterOptions,
    networkExpanded,
    setNetworkExpanded,
  } = useFiltersStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    try {
      setLoading(true);
      const options = await analyticsClient.getFilterOptions();
      setFilterOptions(options);
      setError(null);
    } catch (err: any) {
      setError('Failed to load filter options');
      console.error('Error loading filter options:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => applyFilters();
  const handleReset = () => resetFilters();
  const hasActiveFilters = filterHelpers.hasActiveFilters(pendingFilters);

  const { dynamicSlugsByParent, actorsByType } = React.useMemo(() => {
    if (!filterOptions) return { dynamicSlugsByParent: {}, actorsByType: {} };

    const slugsByParent: Record<string, Array<{ value: string; label: string; count: number }>> = {};
    const actorsByTypeMap: Record<string, Array<{ value: string; label: string }>> = {};

    if (filterOptions.slugs_by_parent) {
      Object.entries(filterOptions.slugs_by_parent).forEach(([parent, slugs]) => {
        const sortedSlugs = [...slugs].sort((a, b) => {
          const countDiff = (b.count_global || 0) - (a.count_global || 0);
          if (countDiff !== 0) return countDiff;
          return a.label.localeCompare(b.label);
        });

        slugsByParent[parent] = sortedSlugs.map((slug) => ({
          value: slug.slug,
          label: slug.label,
          count: slug.count_global || 0,
        }));
      });
    }

    if (filterOptions.actors_by_type) {
      Object.entries(filterOptions.actors_by_type).forEach(([type, actors]) => {
        const sortedActors = [...actors].sort((a, b) => a.name.localeCompare(b.name));
        actorsByTypeMap[type] = sortedActors.map((actor) => ({
          value: actor.id,
          label: actor.name,
        }));
      });
    }

    return { dynamicSlugsByParent: slugsByParent, actorsByType: actorsByTypeMap };
  }, [filterOptions]);

  if (loading) {
    return (
      <div className={`bg-[#fdfaf2] p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-[#ede5d2] rounded"></div>
          <div className="h-32 bg-[#ede5d2] rounded"></div>
          <div className="h-32 bg-[#ede5d2] rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-[#fdfaf2] p-6 ${className}`}>
        <div className="text-[#9a330a] text-sm">{error}</div>
        <button
          onClick={loadFilterOptions}
          className="mt-2 text-sm text-[#c2410c] hover:text-[#9a330a] underline"
        >
          retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={`bg-[#fdfaf2] border-r border-black/[0.1] overflow-hidden flex flex-col ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.08]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b]">filters</div>
          <h2 className="text-[15px] font-medium text-[#1a1a1a] mt-0.5">narrow it down</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[#9a9a9a] hover:text-[#1a1a1a] transition-colors"
            title="collapse filters"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Mobile Apply Button */}
      <div className="md:hidden flex p-4 border-b border-black/[0.08] bg-[#f6f1e6]">
        <button
          onClick={handleApply}
          className="flex-1 font-medium text-sm text-[#fdfaf2] bg-[#c2410c] hover:bg-[#9a330a] transition-colors rounded-md py-2.5"
        >
          apply filters
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 px-5 py-5 space-y-5 overflow-y-auto scrollbar-thin">
        {!hideDateFilter && (
          <div className="filter-group">
            <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
              when
            </label>
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
          </div>
        )}

        {/* Confidence Score */}
        <div className="filter-group">
          <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
            confidence
          </label>
          <div className="flex items-center space-x-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={pendingFilters.confidence || 0.5}
              onChange={(e) => setFilter('confidence', parseFloat(e.target.value))}
              className="flex-1 accent-[#c2410c]"
            />
            <span className="text-xs text-[#2a2a2a] font-medium w-12 text-right tabular-nums">
              ≥ {((pendingFilters.confidence || 0.5) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* States */}
        <div className="filter-group">
          <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
            states
          </label>
          <MultiSelect
            label=""
            options={[
              'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
              'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
              'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
              'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
              'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
            ].map((s) => ({ value: s, label: s }))}
            value={pendingFilters.states || []}
            onChange={(states) => setFilter('states', states)}
            placeholder="select states…"
          />
        </div>

        {/* Actor Types */}
        <div className="filter-group">
          <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
            actor types
          </label>
          <MultiSelect
            label=""
            options={[
              { value: 'person', label: 'people' },
              { value: 'organization', label: 'organizations' },
              { value: 'chapter', label: 'chapters' },
            ]}
            value={pendingFilters.actor_types || []}
            onChange={(types) => setFilter('actor_types', types as any)}
            placeholder="select actor types…"
          />
        </div>

        {/* Slugs by parent */}
        {Object.entries(dynamicSlugsByParent).map(([parent, slugs]) => {
          const isCategory = parent === 'Category';
          const friendlyLabel =
            parent === 'Category' ? 'tags' : parent.replace(/([A-Z])/g, ' $1').trim().toLowerCase();

          return (
            <div key={parent} className="filter-group">
              <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
                {friendlyLabel}
              </label>
              <MultiSelect
                label=""
                options={slugs.map((s) => ({
                  value: s.value,
                  label: s.count > 0 ? `${s.label} (${s.count.toLocaleString()})` : s.label,
                }))}
                value={
                  pendingFilters.tags?.filter((tag) => {
                    if (isCategory) {
                      return !tag.includes(':') || slugs.some((s) => s.value === tag);
                    }
                    return tag.startsWith(parent + ':');
                  }) || []
                }
                onChange={(selectedTags) => {
                  if (isCategory) {
                    const dynamicTags =
                      pendingFilters.tags?.filter(
                        (tag) => tag.includes(':') && !slugs.some((s) => s.value === tag),
                      ) || [];
                    setFilter('tags', [...dynamicTags, ...selectedTags]);
                  } else {
                    const otherTags =
                      pendingFilters.tags?.filter((tag) => !tag.startsWith(parent + ':')) || [];
                    setFilter('tags', [...otherTags, ...selectedTags]);
                  }
                }}
                placeholder={`select ${friendlyLabel}…`}
                searchable={slugs.length > 10}
              />
            </div>
          );
        })}

        {/* Actors by type */}
        {actorsByType &&
          Object.keys(actorsByType).length > 0 &&
          Object.entries(actorsByType).map(([type, actors]) => (
            <div key={`actors-${type}`} className="filter-group">
              <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
                {type}s
              </label>
              <MultiSelect
                label=""
                options={actors}
                value={
                  pendingFilters.actor_ids?.filter((id) => actors.some((a) => a.value === id)) || []
                }
                onChange={(selectedIds) => {
                  const otherActorIds =
                    pendingFilters.actor_ids?.filter((id) => !actors.some((a) => a.value === id)) ||
                    [];
                  setFilter('actor_ids', [...otherActorIds, ...selectedIds]);
                }}
                placeholder={`select ${type}s…`}
                searchable
              />
            </div>
          ))}

        {/* Legacy actors */}
        {!actorsByType && filterOptions?.actors && filterOptions.actors.length > 0 && (
          <div className="filter-group">
            <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
              specific actors
            </label>
            <MultiSelect
              label=""
              options={filterOptions.actors.map((actor) => ({
                value: actor.id,
                label: `${actor.name} (${actor.count_global})`,
              }))}
              value={pendingFilters.actor_ids || []}
              onChange={(ids) => setFilter('actor_ids', ids)}
              placeholder="select actors…"
              searchable
            />
          </div>
        )}

        {/* Network expansion */}
        {((pendingFilters.actor_ids && pendingFilters.actor_ids.length > 0) ||
          (pendingFilters.actor_types && pendingFilters.actor_types.length > 0)) && (
          <div
            className="filter-group"
            style={{
              padding: '12px 14px',
              backgroundColor: '#fdf2ed',
              border: '0.5px solid rgba(194,65,12,0.25)',
              borderRadius: 8,
            }}
          >
            <label className="flex items-start cursor-pointer" style={{ gap: 10 }}>
              <input
                type="checkbox"
                checked={networkExpanded}
                onChange={(e) => setNetworkExpanded(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#c2410c' }}
              />
              <div className="flex-1">
                <span className="text-[12px] font-medium text-[#9a330a] flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  expand to linked actors
                </span>
                <div className="text-[11px] text-[#6b6b6b] mt-0.5 leading-relaxed">
                  pulls in primary connections one hop out from the actors you've selected.
                </div>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Desktop action buttons */}
      <div
        className="hidden md:flex px-5 py-4 border-t border-black/[0.08] bg-[#f6f1e6]"
        style={{ gap: 10 }}
      >
        <button
          onClick={handleApply}
          className="flex-1 text-sm font-medium text-[#fdfaf2] bg-[#c2410c] hover:bg-[#9a330a] transition-colors rounded-md py-2"
        >
          apply
        </button>
        <button
          onClick={handleReset}
          disabled={!hasActiveFilters}
          className="flex-1 text-sm font-medium text-[#2a2a2a] bg-[#fdfaf2] border border-black/[0.12] hover:bg-[#ede5d2] transition-colors rounded-md py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          reset
        </button>
      </div>

      {/* Mobile action buttons */}
      <div
        className="md:hidden flex p-4 border-t border-black/[0.08] bg-[#f6f1e6]"
        style={{ gap: 8 }}
      >
        <button
          onClick={handleReset}
          disabled={!hasActiveFilters}
          className="flex-1 text-sm font-medium text-[#2a2a2a] bg-[#fdfaf2] border border-black/[0.12] hover:bg-[#ede5d2] transition-colors rounded-md py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          reset
        </button>
      </div>
    </div>
  );
};
