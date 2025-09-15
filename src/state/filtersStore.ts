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
  // Search state
  searchQuery: string;
  searchVector: number[] | null;
  minSimilarity: number;
  isSearching: boolean;
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
  setSearchQuery: (query: string) => void;
  setSearchVector: (vector: number[] | null) => void;
  setMinSimilarity: (threshold: number) => void;
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
  searchQuery: '',
  searchVector: null,
  minSimilarity: 0.4,  // Balanced threshold for semantic matches
  isSearching: false,
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
    console.log('Applying filters:', pendingFilters);
    console.log('Has search in pending filters?', pendingFilters.search ? 'Yes' : 'No');
    console.log('Period in pending filters:', pendingFilters.period);
    console.log('Date range in pending filters:', pendingFilters.date_range);
    
    set({ 
      filters: pendingFilters, 
      isApplying: true 
    });
    
    // Reset applying flag after a small delay to ensure components see the change
    setTimeout(() => {
      console.log('Resetting isApplying flag');
      set({ isApplying: false });
    }, 50);
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
    console.log('Clearing search from store');
    set(state => ({
      searchQuery: '',
      searchVector: null,
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
  },
  
  setSearchQuery: async (query) => {
    console.log('setSearchQuery called with:', query);
    set({ searchQuery: query, isSearching: true });
    
    if (!query) {
      set({ searchVector: null, isSearching: false });
      set(state => ({
        pendingFilters: { ...state.pendingFilters, search: undefined }
      }));
      return;
    }
    
    try {
      // Generate embedding using Google's API
      const { analyticsClient } = await import('../api/analyticsClient');
      const embedding = await analyticsClient.generateEmbedding(query);
      
      console.log('Generated embedding for query:', query, 'Dimension:', embedding.length);
      
      // Update filters with embedding
      set(state => ({
        searchVector: embedding,
        pendingFilters: { 
          ...state.pendingFilters, 
          search: { 
            query,
            embedding: embedding.length > 0 ? embedding : undefined,
            min_similarity: state.minSimilarity 
          }
        },
        isSearching: false
      }));
    } catch (error) {
      console.error('Error generating embedding:', error);
      // Fall back to text search
      set(state => ({
        pendingFilters: { 
          ...state.pendingFilters, 
          search: { 
            query,
            min_similarity: state.minSimilarity 
          }
        },
        isSearching: false
      }));
    }
  },
  
  setSearchVector: (vector) => {
    set({ searchVector: vector });
  },
  
  setMinSimilarity: (threshold) => {
    set({ minSimilarity: threshold });
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