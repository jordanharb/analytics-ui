// Core Filters object matching backend exactly
export interface Filters {
  period?: 'week' | 'month' | 'year' | 'all';
  date_range?: {
    start_date?: string; // YYYY-MM-DD
    end_date?: string;
  };
  confidence?: number; // 0.0 to 1.0
  states?: string[];
  tags?: string[]; // Full slugs like "Parent:Value"
  actor_ids?: string[]; // UUIDs
  actor_types?: ('person' | 'organization' | 'chapter')[];
  institutions?: string[]; // Values under 'Institution:<value>'
  linked_actor_of?: string | string[]; // UUID or array of UUIDs for network expansion
  link_depth?: number; // 1-5, default 1
  search?: {
    query: string;
    embedding?: number[];
    min_similarity?: number;
  };
  project_id?: string; // UUID (deprecated, use projects instead)
  projects?: string[]; // UUIDs - events are filtered by actors linked to these projects
}

// Filter options response - Updated structure from backend patch
export interface FilterOptions {
  // Legacy fields (kept for compatibility during migration)
  category_tags?: Array<{
    tag_name: string;
    count_global: number;
  }>;
  actors?: Array<{
    id: string;
    name: string;
    actor_type: 'person' | 'organization' | 'chapter';
    count_global: number;
  }>;
  all_slugs?: Record<string, Array<{
    slug: string;
    label: string;
    count_global: number;
  }>>;
  
  // New structure from backend patch
  slug_parents?: Array<{
    parent: string;
    count: number;
  }>;
  slugs_by_parent?: Record<string, Array<{
    slug: string;
    label: string;
    count_global: number;
  }>>;
  actor_types?: Array<{
    actor_type: string;
  }>;
  actors_by_type?: Record<string, Array<{
    id: string;
    name: string;
  }>>;
}

// Map points response
export interface MapPointsResponse {
  total_events: number;
  map_points: Array<{
    city: string;
    state: string;
    lat: number;
    lon: number;
    count: number;
  }>;
}

// Keyset pagination cursor
export interface Cursor {
  d: string; // ISO date string
  id: string; // UUID
}

// Event list response
export interface EventsListResponse {
  total_count: number;
  events: EventSummary[];
  next_cursor?: Cursor;
  has_more: boolean;
}

// Event summary (list item)
export interface EventSummary {
  id: string;
  name: string;
  date: string;
  city: string;
  state: string;
  tags: string[];
  confidence_score?: number;
}

// Event details (expanded)
export interface EventDetails extends EventSummary {
  description: string;
  ai_justification: string;
  confidence_score?: number;
  location: {
    city: string;
    state: string;
    latitude?: number;
    longitude?: number;
  };
  actors: Array<{
    id: string;
    name: string;
    type: 'person' | 'organization' | 'chapter';
  }>;
  posts: Array<{
    id: string;
    url: string;
    platform: string;
    author_handle: string;
    content?: string;
    offline_image_url?: string;
    screenshot_url?: string;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  }>;
}

// Entity stats response
export interface EntityStats {
  total_count: number;
  by_state: Array<{
    state: string;
    count: number;
  }>;
  by_city: Array<{
    city: string;
    state: string;
    count: number;
  }>;
}

// Actor network link
export interface ActorLink {
  other_actor_id: string;
  other_actor_name: string;
  other_actor_type: 'person' | 'organization' | 'chapter';
  direction: 'incoming' | 'outgoing';
  is_primary: boolean;
  role?: string;
  role_category?: string;
  relationship?: string;
  start_date?: string;
  end_date?: string;
  metadata?: Record<string, any>;
}

// Entity details response - enhanced for actors
export interface EntityDetails {
  id: string;
  type: 'actor' | 'tag' | 'dyn_tag';
  name: string;
  metadata?: {
    actor_type?: string;
    city?: string;
    state?: string;
    region?: string;
    about?: string;
  };
  global_count?: number;
  
  // Actor-specific fields
  usernames?: Array<{
    platform: string;
    handle: string;
    url?: string;
    is_primary?: boolean;
  }>;
  social_profiles?: Array<{
    platform: 'x' | 'instagram' | 'truth_social';
    username: string;
    url?: string;
    bio?: string;
    followers?: number;
    verified?: boolean;
    profile_image?: string;
  }>;
  links_primary?: ActorLink[];
  links_out?: ActorLink[];
  links_in?: ActorLink[];
  
  // Tag-specific fields
  parent?: string;
  value?: string;
}

// Export scope types
export type ExportScope = 'map' | 'virtual' | 'city' | 'cluster' | 'entity';

export interface ExportParams {
  scope: ExportScope;
  scope_params: Record<string, any>;
  filters: Filters;
}

// Timeseries data
export interface TimeseriesDataPoint {
  date: string;
  count: number;
  label: string;
}

export interface TimeseriesSummary {
  average: number;
  peak_date: string;
  peak_count: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface TimeseriesResponse {
  period: 'week' | 'month' | 'year' | 'all';
  granularity: 'day' | 'week' | 'month' | 'year';
  start_date: string;
  end_date: string;
  total_events: number;
  data_points: TimeseriesDataPoint[];
  summary: TimeseriesSummary;
}

// City target for analytics_city_events_keyset
export interface CityTarget {
  city?: string;
  state?: string;
  cities?: Array<{ city: string; state: string }>;
  virtual?: boolean;
}
