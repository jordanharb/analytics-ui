export interface Actor {
  id: string;
  name: string | null;
  actor_type: string | null;
  city: string | null;
  state: string | null;
  region: string | null;
  about: string | null;
  event_count?: number | null;
  state_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ActorUsername {
  id: string;
  actor_id: string;
  platform: string;
  username: string;
  follower_count: number | null;
  verified: boolean | null;
}

export interface ActorEvent {
  id: string;
  event_id: string;
  event_date: string | null;
  city: string | null;
  state: string | null;
  confidence_score: number | null;
  verified: boolean | null;
  v2_events?: Record<string, any>;
}

export interface ActorRelationship {
  id: string;
  from_actor_id: string;
  to_actor_id: string;
  relationship: string | null;
  role: string | null;
  to_actor?: Actor;
}

export interface ActorMember {
  id: string;
  actor_id: string;
  member_actor_id: string;
  role: string | null;
  member_actor?: Actor;
}

export interface ActorDirectoryFilters {
  type: 'all' | string;
  search: string;
}

export interface DirectoryStats {
  total: number;
  person: number;
  organization: number;
  chapter: number;
}
