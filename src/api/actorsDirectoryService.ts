// import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import { PostgrestError } from '@supabase/supabase-js';
import { supabaseClient } from './supabaseClient';
import type {
  Actor,
  ActorDirectoryFilters,
  ActorEvent,
  ActorMember,
  ActorRelationship,
  ActorUsername,
  DirectoryStats,
} from '../types/actorsDirectory';

export interface FetchActorsResult {
  actors: Actor[];
  total: number;
}

export async function fetchActors(
  filters: ActorDirectoryFilters,
  limit: number,
  offset: number,
): Promise<FetchActorsResult> {
  const base = supabaseClient
    .from('v2_actors')
    .select(
      `id,name,actor_type,city,state,region,about,created_at,updated_at`,
      { count: 'exact' },
    )
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  let query = base;

  if (filters.type && filters.type !== 'all') {
    query = query.eq('actor_type', filters.type);
  }

  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(`name.ilike.${term},city.ilike.${term},state.ilike.${term},about.ilike.${term}`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const list = (data ?? []) as Actor[];

  return {
    actors: list,
    total: count ?? list.length,
  };
}

export async function fetchDirectoryStats(): Promise<DirectoryStats> {
  const [total, person, organization, chapter] = await Promise.all([
    supabaseClient.from('v2_actors').select('id', { count: 'exact', head: true }),
    supabaseClient
      .from('v2_actors')
      .select('id', { count: 'exact', head: true })
      .eq('actor_type', 'person'),
    supabaseClient
      .from('v2_actors')
      .select('id', { count: 'exact', head: true })
      .eq('actor_type', 'organization'),
    supabaseClient
      .from('v2_actors')
      .select('id', { count: 'exact', head: true })
      .eq('actor_type', 'chapter'),
  ]);

  const resolveCount = (response: { error: PostgrestError | null; count: number | null }) => {
    if (response.error) {
      console.error('Failed to fetch directory stat', response.error);
      return 0;
    }
    return response.count ?? 0;
  };

  return {
    total: resolveCount(total),
    person: resolveCount(person),
    organization: resolveCount(organization),
    chapter: resolveCount(chapter),
  };
}

export async function fetchActorDetails(actorId: string): Promise<Actor | null> {
  const { data, error } = await supabaseClient
    .from('v2_actors')
    .select('id,name,actor_type,city,state,region,about,created_at,updated_at')
    .eq('id', actorId)
    .maybeSingle();

  if (error) throw error;
  return data as Actor | null;
}

export async function fetchActorUsernames(actorId: string): Promise<ActorUsername[]> {
  const { data, error } = await supabaseClient
    .from('v2_actor_usernames')
    .select('id,actor_id,platform,username,follower_count,verified')
    .eq('actor_id', actorId)
    .order('platform', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ActorUsername[];
}

export async function fetchActorRelationships(actorId: string): Promise<ActorRelationship[]> {
  const { data, error } = await supabaseClient
    .from('v2_actor_links')
    .select(
      'from_actor_id,to_actor_id,relationship,role,role_category,is_primary,metadata,created_at,to_actor:v2_actors!actor_links_to_actor_id_fkey(id,name,actor_type,city,state)',
    )
    .eq('from_actor_id', actorId);

  if (error) throw error;

  const rows = (data ?? []) as RelationshipRow[];
  return rows.map(toActorRelationship);
}

// Fetch inbound relationships where the current actor is the target (to_actor_id).
// For display consistency, we normalize the "other" actor into the to_actor field.
export async function fetchActorInboundRelationships(actorId: string): Promise<ActorRelationship[]> {
  const { data, error } = await supabaseClient
    .from('v2_actor_links')
    .select(
      'from_actor_id,to_actor_id,relationship,role,role_category,is_primary,metadata,created_at,from_actor:v2_actors!actor_links_from_actor_id_fkey(id,name,actor_type,city,state)',
    )
    .eq('to_actor_id', actorId);

  if (error) throw error;

  const rows = (data ?? []) as RelationshipRow[];
  return rows.map(toInboundActorRelationship);
}

export async function fetchActorEvents(actorId: string, limit: number = 200): Promise<ActorEvent[]> {
  const { data, error } = await supabaseClient
    .from('v2_event_actor_links')
    .select('event_id,actor_id,actor_handle,platform,v2_events!v2_event_actor_links_event_id_fkey(*)')
    .eq('actor_id', actorId)
    .limit(limit);

  if (error) throw error;

  const rows = (data ?? []) as unknown as EventLinkRow[];
  return rows.map(row => ({
    id: `${row.event_id}:${row.actor_id ?? row.actor_handle ?? 'linked'}`,
    event_id: row.event_id,
    actor_id: row.actor_id ?? null,
    actor_handle: row.actor_handle ?? null,
    platform: row.platform ?? null,
    event_date: row.v2_events?.event_date ?? null,
    city: row.v2_events?.city ?? null,
    state: row.v2_events?.state ?? null,
    confidence_score: row.v2_events?.confidence_score ?? null,
    verified: row.v2_events?.verified ?? null,
    v2_events: row.v2_events ?? undefined,
  }));
}

export async function fetchActorMembers(actorId: string): Promise<ActorMember[]> {
  const { data, error } = await supabaseClient
    .from('v2_actor_links')
    .select(
      'from_actor_id,to_actor_id,relationship,role,role_category,is_primary,created_at,to_actor:v2_actors!actor_links_to_actor_id_fkey(id,name,actor_type,city,state)',
    )
    .eq('from_actor_id', actorId)
    .eq('relationship', 'member');

  if (error) throw error;

  const rows = (data ?? []) as RelationshipRow[];
  return rows.map(row => ({
    id: fallbackRelationshipId(row),
    actor_id: row.from_actor_id,
    member_actor_id: row.to_actor_id,
    role: row.role,
    relationship: row.relationship,
    role_category: row.role_category,
    is_primary: row.is_primary,
    created_at: row.created_at ?? null,
    member_actor: normalizeRelatedActor(row.to_actor ?? null),
  }));
}

export type ActorEditableFields = Pick<
  Actor,
  'name' | 'actor_type' | 'city' | 'state' | 'region' | 'about'
> & {
  should_scrape?: boolean | null;
};

export async function updateActorDetails(actorId: string, updates: Partial<ActorEditableFields>): Promise<Actor> {
  const payload = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );

  if (Object.keys(payload).length === 0) {
    const actor = await fetchActorDetails(actorId);
    if (!actor) {
      throw new Error('Actor not found');
    }
    return actor;
  }

  const { data, error } = await supabaseClient
    .from('v2_actors')
    .update(payload)
    .eq('id', actorId)
    .select('id,name,actor_type,city,state,region,about,created_at,updated_at,should_scrape')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Failed to update actor');
  return data as Actor;
}

export async function searchActorsForLinking(
  term: string,
  limit: number = 12,
  excludeActorId?: string,
): Promise<Actor[]> {
  let query = supabaseClient
    .from('v2_actors')
    .select('id,name,actor_type,city,state')
    .order('name', { ascending: true })
    .limit(limit);

  const search = term.trim();
  if (search) {
    const like = `%${search}%`;
    query = query.or(`name.ilike.${like},city.ilike.${like},state.ilike.${like}`);
  }

  if (excludeActorId) {
    query = query.neq('id', excludeActorId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Actor[];
}

export interface RelationshipIdentifier {
  from_actor_id: string;
  to_actor_id: string;
  relationship?: string | null;
  original_relationship?: string | null;
  original_role?: string | null;
  created_at?: string | null;
}

export interface RelationshipMutationInput {
  relationship?: string | null;
  role?: string | null;
  role_category?: string | null;
  metadata?: Record<string, unknown> | null;
  is_primary?: boolean | null;
}

interface RelationshipRow {
  from_actor_id: string;
  to_actor_id: string;
  relationship: string | null;
  role: string | null;
  role_category?: string | null;
  is_primary?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  to_actor?: Actor | Actor[] | null;
  from_actor?: Actor | Actor[] | null;
}

interface EventLinkRow {
  event_id: string;
  actor_id: string | null;
  actor_handle?: string | null;
  platform?: string | null;
  v2_events?: {
    event_date?: string | null;
    city?: string | null;
    state?: string | null;
    confidence_score?: number | null;
    verified?: boolean | null;
    event_description?: string | null;
    event_name?: string | null;
    title?: string | null;
    [key: string]: unknown;
  } | null;
}

const fallbackRelationshipId = (row: Pick<RelationshipRow, 'from_actor_id' | 'to_actor_id' | 'relationship' | 'created_at'>) =>
  `${row.from_actor_id}:${row.to_actor_id}:${row.relationship ?? 'linked'}:${row.created_at ?? 'created'}`;

const normalizeRelatedActor = (joined: Actor | Actor[] | null): Actor | undefined => {
  if (Array.isArray(joined)) {
    return joined[0] as Actor | undefined;
  }
  return joined ?? undefined;
};

const toActorRelationship = (row: RelationshipRow): ActorRelationship => ({
  id: fallbackRelationshipId(row),
  from_actor_id: row.from_actor_id,
  to_actor_id: row.to_actor_id,
  relationship: row.relationship,
  role: row.role,
  role_category: row.role_category,
  is_primary: row.is_primary,
  metadata: row.metadata ?? null,
  created_at: row.created_at ?? null,
  to_actor: normalizeRelatedActor(row.to_actor ?? null),
});

// For inbound relationships (where current actor is the target),
// expose the "other" actor via the same to_actor field for UI reuse.
const toInboundActorRelationship = (row: RelationshipRow): ActorRelationship => ({
  id: fallbackRelationshipId(row),
  from_actor_id: row.from_actor_id,
  to_actor_id: row.to_actor_id,
  relationship: row.relationship,
  role: row.role,
  role_category: row.role_category,
  is_primary: row.is_primary,
  metadata: row.metadata ?? null,
  created_at: row.created_at ?? null,
  to_actor: normalizeRelatedActor(row.from_actor ?? null),
});

export async function createActorRelationship(
  input: RelationshipIdentifier & RelationshipMutationInput,
): Promise<ActorRelationship> {
  const { from_actor_id, to_actor_id, ...rest } = input;

  const { data, error } = await supabaseClient
    .from('v2_actor_links')
    .insert({
      from_actor_id,
      to_actor_id,
      relationship: rest.relationship ?? input.relationship ?? null,
      role: rest.role ?? null,
      role_category: rest.role_category ?? null,
      metadata: rest.metadata ?? null,
      is_primary: rest.is_primary ?? false,
    })
    .select(
      'from_actor_id,to_actor_id,relationship,role,role_category,is_primary,metadata,created_at,to_actor:v2_actors!actor_links_to_actor_id_fkey(id,name,actor_type,city,state)'
    )
    .single();

  if (error) throw error;

  return toActorRelationship(data as RelationshipRow);
}

function applyRelationshipIdentifier(
  query: any,
  identifier: RelationshipIdentifier,
): any {
  let next = query.eq('from_actor_id', identifier.from_actor_id).eq('to_actor_id', identifier.to_actor_id);

  if (identifier.created_at) {
    next = next.eq('created_at', identifier.created_at);
  }

  const comparisonRelationship = identifier.original_relationship ?? identifier.relationship;
  if (comparisonRelationship !== undefined) {
    if (comparisonRelationship === null) {
      next = next.is('relationship', null);
    } else {
      next = next.eq('relationship', comparisonRelationship);
    }
  }

  if (identifier.original_role !== undefined) {
    if (identifier.original_role === null) {
      next = next.is('role', null);
    } else {
      next = next.eq('role', identifier.original_role);
    }
  }
  return next;
}

export async function updateActorRelationship(
  identifier: RelationshipIdentifier,
  updates: RelationshipMutationInput,
): Promise<ActorRelationship> {
  const payload = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );

  const query = applyRelationshipIdentifier(supabaseClient.from('v2_actor_links').update(payload), identifier);

  const { data, error } = await query
    .select(
      'from_actor_id,to_actor_id,relationship,role,role_category,is_primary,metadata,created_at,to_actor:v2_actors!actor_links_to_actor_id_fkey(id,name,actor_type,city,state)',
    )
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Relationship not found');

  return toActorRelationship(data as RelationshipRow);
}

export async function deleteActorRelationship(identifier: RelationshipIdentifier): Promise<void> {
  const query = applyRelationshipIdentifier(supabaseClient.from('v2_actor_links').delete(), identifier);
  const { error } = await query;
  if (error) throw error;
}
