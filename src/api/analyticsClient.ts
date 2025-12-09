import { supabaseClient } from './supabaseClient';
import type * as T from './types';
import { embeddingService } from '../services/embeddingService';

class AnalyticsClient {
  private abortControllers = new Map<string, AbortController>();
  
  // Generate embedding vector from text
  // For now, we'll use text search as the backend handles it
  // The backend will convert text to embeddings on the server side
  async generateEmbedding(text: string): Promise<number[]> {
    // Generate embedding using Google's API (same model as backend)
    return embeddingService.generateQueryEmbedding(text);
  }
  
  private convertFiltersForBackend(filters: T.Filters): any {
    const converted: any = { ...filters };

    // ✅ PRESERVE period and date_range in the converted object for debugging
    // These will be converted to min_date/max_date but kept for reference

    // Convert projects to project_ids (UI stores as 'projects', SQL expects 'project_ids')
    if (filters.projects && Array.isArray(filters.projects) && filters.projects.length > 0) {
      converted.project_ids = filters.projects;
    }

    // Convert period to min_date/max_date
    if (filters.period && filters.period !== 'all') {
      const today = new Date();
      let minDate: Date;
      
      switch (filters.period) {
        case 'week':
          minDate = new Date(today);
          minDate.setDate(today.getDate() - 7);
          break;
        case 'month':
          minDate = new Date(today);
          minDate.setMonth(today.getMonth() - 1);
          break;
        case 'year':
          minDate = new Date(today);
          minDate.setFullYear(today.getFullYear() - 1);
          break;
        default:
          // For 'all', don't set date constraints
          return converted;
      }
      
      converted.min_date = minDate.toISOString();
      converted.max_date = today.toISOString();
    }
    
    // Convert date_range to min_date/max_date
    if (filters.date_range) {
      if (filters.date_range.start_date) {
        converted.min_date = new Date(filters.date_range.start_date).toISOString();
      }
      if (filters.date_range.end_date) {
        converted.max_date = new Date(filters.date_range.end_date).toISOString();
      }
    }
    
    // Keep search parameters separate for vector search
    // Don't add to converted filters
    
    return converted;
  }
  
  private async rpc<TResponse>(
    functionName: string, 
    params?: any,
    key?: string
  ): Promise<TResponse> {
    // Cancel previous request with same key
    if (key && this.abortControllers.has(key)) {
      this.abortControllers.get(key)!.abort();
    }
    
    const controller = new AbortController();
    if (key) {
      this.abortControllers.set(key, controller);
    }
    
    try {
      const { data, error } = await supabaseClient
        .rpc(functionName, params);
        
      if (error) throw error;
      return data as TResponse;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('Request cancelled');
      }
      
      // Retry logic for network errors
      if (err.message?.includes('network') && !key) {
        await new Promise(r => setTimeout(r, 1000));
        return this.rpc<TResponse>(functionName, params);
      }
      
      throw new Error(`RPC Error: ${err.message || 'Unknown error'}`);
    } finally {
      if (key) {
        this.abortControllers.delete(key);
      }
    }
  }
  
  async getFilterOptions(): Promise<T.FilterOptions> {
    return this.rpc<T.FilterOptions>('get_filter_options_optimized');
  }
  
  async getNetworkActorIds(actorIds: string[]): Promise<string[]> {
    return this.rpc<string[]>(
      'get_network_actor_ids',
      { p_actor_ids: actorIds, p_include_self: true }
    );
  }
  
  async getMapPoints(filters: T.Filters): Promise<T.MapPointsResponse> {
    const convertedFilters = this.convertFiltersForBackend(filters);
    
    console.log('getMapPoints called with filters:', filters);
    console.log('Search in filters:', filters.search);
    
    // Handle vector search if embedding is present
    if (filters.search?.embedding && filters.search.embedding.length > 0) {
      console.log('Vector search detected in getMapPoints');
      console.log('Embedding length:', filters.search.embedding.length);
      console.log('Min similarity:', filters.search.min_similarity);
      
      // ✅ Send embedding as JS array, not pgvector string
      convertedFilters.search_vec = Array.from(filters.search.embedding);
      convertedFilters.min_similarity = filters.search.min_similarity || 0.30;
      
      console.log('Added search_vec to filters as array');
    } else {
      console.log('No embedding in search, using regular filters');
    }
    
    console.log('Final converted filters for map:', {
      ...convertedFilters,
      search_vec: convertedFilters.search_vec ? '[vector data]' : undefined,
      period: filters.period,
      date_range: filters.date_range
    });
    
    return this.rpc<T.MapPointsResponse>(
      'get_map_points', 
      { p_filters: convertedFilters },
      'map-points'
    );
  }
  
  async getCityEvents(
    target: T.CityTarget,
    filters: T.Filters,
    pageSize: number = 100,
    cursor?: T.Cursor
  ): Promise<T.EventsListResponse> {
    return this.rpc<T.EventsListResponse>(
      'analytics_city_events_keyset',
      { target, filters: this.convertFiltersForBackend(filters), page_size: pageSize, cursor },
      'city-events'
    );
  }
  
  async getDirectoryEvents(
    filters: T.Filters,
    pageSize: number = 100,
    cursor?: T.Cursor
  ): Promise<T.EventsListResponse> {
    const convertedFilters = this.convertFiltersForBackend(filters);
    
    // Handle vector search if embedding is present
    if (filters.search?.embedding && filters.search.embedding.length > 0) {
      console.log('Vector search detected in getDirectoryEvents');
      console.log('Embedding length:', filters.search.embedding.length);
      console.log('Min similarity:', filters.search.min_similarity);
      
      // ✅ Send embedding as JS array, not pgvector string
      convertedFilters.search_vec = Array.from(filters.search.embedding);
      convertedFilters.min_similarity = filters.search.min_similarity || 0.30;
      
      console.log('Added search_vec to filters for directory as array');
    } else {
      console.log('No embedding in search, using regular filters');
    }
    
    console.log('Final converted filters for directory:', {
      ...convertedFilters,
      search_vec: convertedFilters.search_vec ? '[vector data]' : undefined,
      period: filters.period,
      date_range: filters.date_range
    });
    
    // Use list_directory_events which now supports vector search
    return this.rpc<T.EventsListResponse>(
      'list_directory_events',
      { 
        filters: convertedFilters, 
        page_size: pageSize, 
        cursor 
      },
      'directory-events'
    );
  }
  
  async getEventDetails(eventId: string): Promise<T.EventDetails> {
    return this.rpc<T.EventDetails>(
      'get_event_details',
      { event_id: eventId }
    );
  }
  
  async getEntityDetails(
    entityType: 'actor' | 'tag' | 'dyn_tag',
    entityId: string
  ): Promise<T.EntityDetails> {
    return this.rpc<T.EntityDetails>(
      'get_entity_details',
      { entity_type: entityType, entity_id: entityId }
    );
  }
  
  async getEntityStats(
    entityType: 'actor' | 'tag' | 'dyn_tag',
    entityId: string,
    filters: T.Filters
  ): Promise<T.EntityStats> {
    // Call the appropriate RPC based on entity type
    const rpcName = 
      entityType === 'actor' ? 'actor_entity_stats' :
      entityType === 'tag' ? 'tag_entity_stats' :
      'dyn_tag_entity_stats';
      
    const paramName = 
      entityType === 'actor' ? 'p_actor_id' :
      entityType === 'tag' ? 'p_tag_id' :
      'p_dyn_id';
    
    return this.rpc<T.EntityStats>(
      rpcName,
      { [paramName]: entityId, filters: this.convertFiltersForBackend(filters) }
    );
  }
  
  async getEntityEvents(
    entityType: 'actor' | 'tag' | 'dyn_tag',
    entityId: string,
    filters: T.Filters,
    pageSize: number = 100,
    cursor?: T.Cursor
  ): Promise<T.EventsListResponse> {
    return this.rpc<T.EventsListResponse>(
      'list_entity_events',
      { entity_type: entityType, entity_id: entityId, filters: this.convertFiltersForBackend(filters), page_size: pageSize, cursor }
    );
  }
  
  async exportEvents(params: T.ExportParams): Promise<string[][]> {
    // Convert filters if present in params
    const convertedParams = {
      ...params,
      filters: params.filters ? this.convertFiltersForBackend(params.filters) : undefined
    };
    return this.rpc<string[][]>(
      'export_events_rows',
      convertedParams
    );
  }
  
  async getEntityTimeseries(
    entityType: 'actor' | 'tag' | 'dyn_tag',
    entityId: string,
    filters: T.Filters,
    period: 'week' | 'month' | 'year' | 'all' = 'month',
    granularity: 'day' | 'week' | 'month' | 'year' | 'auto' = 'auto'
  ): Promise<T.TimeseriesResponse> {
    return this.rpc<T.TimeseriesResponse>(
      'get_entity_timeseries',
      { 
        entity_type: entityType,
        entity_id: entityId,
        filters: this.convertFiltersForBackend(filters),
        period,
        granularity
      }
    );
  }
  
  cancelAll(): void {
    this.abortControllers.forEach(c => c.abort());
    this.abortControllers.clear();
  }
}

export const analyticsClient = new AnalyticsClient();