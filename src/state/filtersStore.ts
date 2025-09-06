import { create } from 'zustand';
import type { Filters, FilterOptions } from '../api/types';

interface FiltersStore {
  // Current active filters
  filters: Filters;
  // Pending filters (before apply)
  pendingFilters: Filters;
  // Filter options from backend
  filterOptions: FilterOptions | null;
  // Network expansion state
  networkExpanded: boolean;
  expandedActorIds: string[] | null;
  // Loading states
  isApplying: boolean;
  isLoadingOptions: boolean;
  
  // Actions
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setPendingFilters: (filters: Partial<Filters>) => void;
  applyFilters: () => void;
  resetFilters: () => void;
  setFilterOptions: (options: FilterOptions) => void;
  clearSearch: () => void;
  setNetworkExpanded: (expanded: boolean) => void;
  setExpandedActorIds: (ids: string[] | null) => void;
}

const DEFAULT_FILTERS: Filters = {
  period: 'month',
  confidence: 0.5,
  states: [],
  tags: [],
  actor_ids: [],
  actor_types: [],
  institutions: []
};

export const useFiltersStore = create<FiltersStore>((set, get) => ({
  filters: DEFAULT_FILTERS,
  pendingFilters: DEFAULT_FILTERS,
  filterOptions: null,
  networkExpanded: false,
  expandedActorIds: null,
  isApplying: false,
  isLoadingOptions: false,
  
  setFilter: (key, value) => {
    set(state => ({
      pendingFilters: { ...state.pendingFilters, [key]: value }
    }));
  },
  
  setPendingFilters: (filters) => {
    set(state => ({
      pendingFilters: { ...state.pendingFilters, ...filters }
    }));
  },
  
  applyFilters: () => {
    const { pendingFilters } = get();
    set({ 
      filters: pendingFilters, 
      isApplying: true 
    });
    
    // Reset applying flag after a tick
    setTimeout(() => set({ isApplying: false }), 0);
  },
  
  resetFilters: () => {
    set({
      filters: DEFAULT_FILTERS,
      pendingFilters: DEFAULT_FILTERS,
      networkExpanded: false,
      expandedActorIds: null
    });
  },
  
  setFilterOptions: (options) => {
    set({ filterOptions: options });
  },
  
  clearSearch: () => {
    set(state => ({
      pendingFilters: { ...state.pendingFilters, search: undefined },
      filters: { ...state.filters, search: undefined }
    }));
  },
  
  setNetworkExpanded: (expanded) => {
    set({ 
      networkExpanded: expanded,
      // Clear expanded IDs when toggling off
      expandedActorIds: expanded ? get().expandedActorIds : null
    });
  },
  
  setExpandedActorIds: (ids) => {
    set({ expandedActorIds: ids });
  }
}));

// Helper functions
export const filterHelpers = {
  fromPeriod: (period: Filters['period']): Pick<Filters, 'period' | 'date_range'> => ({
    period,
    date_range: undefined
  }),
  
  fromDateRange: (start: string, end: string): Pick<Filters, 'period' | 'date_range'> => ({
    period: undefined,
    date_range: { start_date: start, end_date: end }
  }),
  
  hasActiveFilters: (filters: Filters): boolean => {
    return !!(
      filters.states?.length ||
      filters.tags?.length ||
      filters.actor_ids?.length ||
      filters.actor_types?.length ||
      filters.institutions?.length ||
      filters.search?.query ||
      filters.linked_actor_of ||
      filters.project_id ||
      (filters.confidence && filters.confidence !== 0.5)
    );
  }
};