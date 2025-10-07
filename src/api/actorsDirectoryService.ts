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

function applyFilters(
  query: any,
  filters: ActorDirectoryFilters,
) {
  let next = query;

  if (filters.type && filters.type !== 'all') {
    next = next.eq('actor_type', filters.type);
  }

  if (filters.search) {
    const term = `%${filters.search}%`;
    next = next.or(`name.ilike.${term},city.ilike.${term},state.ilike.${term},about.ilike.${term}`);
  }

  return next;
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

  const query = applyFilters(base, filters);

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
    .select('id,from_actor_id,to_actor_id,relationship,role,to_actor:v2_actors!v2_actor_links_to_actor_id_fkey(id,name,actor_type,city,state)')
    .eq('from_actor_id', actorId);

  if (error) throw error;

  return (data ?? []).map(rel => {
    const raw = (rel as any).to_actor;
    const relatedActor = Array.isArray(raw) ? raw?.[0] : raw;
    return {
      id: rel.id,
      from_actor_id: rel.from_actor_id,
      to_actor_id: rel.to_actor_id,
      relationship: rel.relationship,
      role: rel.role,
      to_actor: relatedActor as Actor,
    };
  });
}

export async function fetchActorEvents(actorId: string, limit: number = 200): Promise<ActorEvent[]> {
  const { data, error } = await supabaseClient
    .from('v2_event_actor_links')
    .select('id,event_id,actor_id,v2_events:event_id(*)')
    .eq('actor_id', actorId)
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    event_id: row.event_id,
    event_date: row.v2_events?.event_date ?? null,
    city: row.v2_events?.city ?? null,
    state: row.v2_events?.state ?? null,
    confidence_score: row.v2_events?.confidence_score ?? null,
    verified: row.v2_events?.verified ?? null,
    v2_events: row.v2_events,
  }));
}

export async function fetchActorMembers(actorId: string): Promise<ActorMember[]> {
  const { data, error } = await supabaseClient
    .from('v2_actor_links')
    .select('id,from_actor_id,to_actor_id,role,to_actor:v2_actors!v2_actor_links_to_actor_id_fkey(id,name,actor_type,city,state)')
    .eq('from_actor_id', actorId)
    .eq('relationship', 'member');

  if (error) throw error;

  return ((data ?? []) as any[]).map(row => ({
    id: row.id,
    actor_id: row.from_actor_id,
    member_actor_id: row.to_actor_id,
    role: row.role,
    member_actor: row.to_actor as Actor,
  }));
}
