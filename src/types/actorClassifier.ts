export type ClassifierFilterType =
  | 'all'
  | 'keyword'
  | 'platform'
  | 'date_range'
  | 'mention_count'
  | 'verified'
  | 'combined'
  | 'priority';

export interface ClassifierFilterConfig {
  filter: ClassifierFilterType;
  keywords?: string[];
  platform?: string;
  days?: number;
  min_mentions?: number;
  value?: boolean;
  min_score?: number;
  filters?: Array<{
    type: 'keyword' | 'platform' | 'mention_count';
    keywords?: string[];
    platform?: string;
    min_mentions?: number;
  }>;
}

export interface ClassifierView {
  id: string;
  name: string;
  description?: string | null;
  is_system?: boolean;
  filter_config?: ClassifierFilterConfig;
}

export interface UnknownActor {
  id: string;
  detected_username: string | null;
  profile_displayname: string | null;
  profile_bio: string | null;
  platform: string | null;
  mention_count: number | null;
  author_count: number | null;
  review_status: string | null;
  first_seen_date: string | null;
  created_at?: string | null;
  assigned_actor_id?: string | null;
  network_interactions?: number | null;
  x_profile_data?: Record<string, any> | null;
}

export interface UnknownActorResponse {
  actors: UnknownActor[];
  hasMore: boolean;
  total: number;
}

export interface LinkActorPayload {
  unknownActorId: string;
  actorId: string;
}

export interface PromoteActorPayload {
  unknownActorId: string;
  actorType: string;
  actorName: string;
  city?: string;
  state?: string;
  fields?: Record<string, any>;
  links?: PromoteLinkInput[];
}

export interface PromoteLinkInput {
  toActorId: string;
  relationship?: string;
  role?: string;
  roleCategory?: string;
  isPrimary?: boolean;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, string>;
}

export interface SearchExistingActorsOptions {
  actorType?: 'person' | 'organization' | 'chapter';
  name?: string;
  city?: string;
  state?: string;
  region?: string;
  about?: string;
  limit?: number;
}
