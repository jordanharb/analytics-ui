import { supabaseClient } from './supabaseClient';
import type {
  ClassifierFilterConfig,
  ClassifierView,
  LinkActorPayload,
  PromoteActorPayload,
  PromoteLinkInput,
  SearchExistingActorsOptions,
  UnknownActor,
  UnknownActorResponse,
} from '../types/actorClassifier';
import type { Actor } from '../types/actorsDirectory';

export async function fetchClassifierViews(): Promise<ClassifierView[]> {
  const { data, error } = await supabaseClient
    .from('actor_classifier_views')
    .select('id,name,description,is_system,filter_config')
    .eq('is_active', true)
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

interface FetchUnknownActorsParams {
  config?: ClassifierFilterConfig;
  offset?: number;
  limit?: number;
  searchTerm?: string;
  platform?: string;
}

function buildKeywordClause(keyword: string): string {
  const sanitized = keyword.replace(/[,\s]+/g, ' ').trim();
  if (!sanitized) return '';
  const token = `*${sanitized}*`;
  return [
    `detected_username.ilike.${token}`,
    `profile_bio.ilike.${token}`,
    `profile_displayname.ilike.${token}`,
    `x_profile_data->>username.ilike.${token}`,
    `instagram_profile_data->>username.ilike.${token}`,
    `tiktok_profile_data->>username.ilike.${token}`,
    `youtube_profile_data->>username.ilike.${token}`,
    `truth_social_profile_data->>username.ilike.${token}`,
  ].join(',');
}

function applyFilterConfig(query: any, config?: ClassifierFilterConfig) {
  if (!config) return query;

  let builder = query as any;

  switch (config.filter) {
    case 'all':
      return builder;
    case 'keyword':
      if (config.keywords && config.keywords.length > 0) {
        const clause = config.keywords
          .map(buildKeywordClause)
          .filter(Boolean)
          .join(',');
        if (clause) {
          builder = builder.or(clause);
        }
      }
      return builder;
    case 'platform':
      if (config.platform) {
        builder = builder.eq('platform', config.platform);
      }
      return builder;
    case 'date_range':
      if (config.days) {
        const date = new Date();
        date.setDate(date.getDate() - config.days);
        builder = builder.gte('first_seen_date', date.toISOString());
      }
      return builder;
    case 'mention_count':
      if (typeof config.min_mentions === 'number') {
        builder = builder.gte('mention_count', config.min_mentions);
      }
      return builder;
    case 'verified':
      if (typeof config.value === 'boolean') {
        builder = builder.eq('verified', config.value);
      }
      return builder;
    case 'priority':
      // Priority handled client-side (score calculation) in addition to requiring mention count
      if (typeof config.min_score === 'number') {
        builder = builder.gte('mention_count', Math.max(1, Math.floor(config.min_score / 2)));
      }
      return builder;
    case 'combined':
      if (config.filters) {
        let next = builder;
        config.filters.forEach(f => {
          if (f.type === 'keyword' && f.keywords?.length) {
            const clause = f.keywords.map(buildKeywordClause).filter(Boolean).join(',');
            if (clause) {
              next = next.or(clause);
            }
          } else if (f.type === 'platform' && f.platform) {
            next = next.eq('platform', f.platform);
          } else if (f.type === 'mention_count' && typeof f.min_mentions === 'number') {
            next = next.gte('mention_count', f.min_mentions);
          }
        });
        return next;
      }
      return builder;
    default:
      return builder;
  }
}

export async function fetchUnknownActors({
  config,
  offset = 0,
  limit = 50,
  searchTerm,
  platform,
}: FetchUnknownActorsParams): Promise<UnknownActorResponse> {
  let builder = supabaseClient
    .from('v2_unknown_actors')
    .select('*', { count: 'exact' })
    .eq('review_status', 'pending')
    .order('mention_count', { ascending: false })
    .range(offset, offset + limit - 1);

  builder = applyFilterConfig(builder, config);

  if (platform) {
    builder = builder.eq('platform', platform);
  }

  if (searchTerm) {
    const clause = buildKeywordClause(searchTerm);
    if (clause) {
      builder = builder.or(clause);
    }
  }

  const { data, error, count } = await builder;
  if (error) throw error;

  const sanitized = (data ?? []).filter(actor => {
    const placeholder = actor?.x_profile_data && actor.x_profile_data.is_placeholder === true;
    const hasDisplay = Boolean(actor?.profile_displayname);
    return !placeholder && hasDisplay;
  }) as UnknownActor[];

  const decorated = sanitized.map(actor => ({
    ...actor,
    network_interactions: actor.network_interactions ?? actor.mention_count ?? 0,
  }));

  let filtered = decorated;
  if (config?.filter === 'priority' && typeof config.min_score === 'number') {
    filtered = decorated.filter(actor => {
      const score = (actor.mention_count ?? 0) * 2 + (actor.author_count ?? 0) * 5;
      return score >= config.min_score!;
    });
  }

  const total = count ?? filtered.length;
  const hasMore = count != null ? offset + (data?.length ?? 0) < count : filtered.length === limit;

  return {
    actors: filtered,
    hasMore,
    total,
  };
}

export async function linkUnknownActor(payload: LinkActorPayload) {
  const { error } = await supabaseClient.rpc('link_v2_unknown_to_existing', {
    p_unknown_actor_id: payload.unknownActorId,
    p_actor_id: payload.actorId,
  });

  if (error) throw error;
}

export async function promoteUnknownActor(payload: PromoteActorPayload): Promise<string | null> {
  const { data, error } = await supabaseClient.rpc('promote_v2_unknown_to_actor', {
    p_unknown_actor_id: payload.unknownActorId,
    p_actor_type: payload.actorType,
    p_actor_name: payload.actorName,
    p_city: payload.city ?? null,
    p_state: payload.state ?? null,
    p_fields: payload.fields ?? null,
  });

  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

export async function fetchUnknownActorById(id: string): Promise<UnknownActor | null> {
  const { data, error } = await supabaseClient
    .from('v2_unknown_actors')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data as UnknownActor | null;
}

export async function searchExistingActors(
  term: string,
  options: SearchExistingActorsOptions = {},
): Promise<Actor[]> {
  let builder = supabaseClient
    .from('v2_actors')
    .select('id,name,actor_type,city,state,about,region,custom_text_1,custom_text_2,custom_text_3')
    .order('name', { ascending: true })
    .limit(options.limit ?? 25);

  if (options.actorType) {
    builder = builder.eq('actor_type', options.actorType);
  }

  const searchClauses: string[] = [];
  const searchTerm = term?.trim();
  if (searchTerm) {
    const encoded = searchTerm.replace(/%/g, '\\%');
    searchClauses.push(
      `name.ilike.*${encoded}*,about.ilike.*${encoded}*,city.ilike.*${encoded}*,state.ilike.*${encoded}*,region.ilike.*${encoded}*`,
    );
  }

  if (options.name) {
    const encoded = options.name.replace(/%/g, '\\%');
    searchClauses.push(`name.ilike.*${encoded}*`);
  }

  if (searchClauses.length > 0) {
    builder = builder.or(searchClauses.join(','));
  }

  if (options.city) {
    builder = builder.ilike('city', `%${options.city}%`);
  }
  if (options.state) {
    builder = builder.ilike('state', `%${options.state}%`);
  }
  if (options.region) {
    builder = builder.ilike('region', `%${options.region}%`);
  }
  if (options.about) {
    builder = builder.ilike('about', `%${options.about}%`);
  }

  const { data, error } = await builder;

  if (error) throw error;
  return (data ?? []) as Actor[];
}

export async function fetchOrganizations(): Promise<Array<Pick<Actor, 'id' | 'name'>>> {
  const { data, error } = await supabaseClient
    .from('v2_actors')
    .select('id,name')
    .eq('actor_type', 'organization')
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as Array<Pick<Actor, 'id' | 'name'>>;
}

export async function fetchPersonRoleCategories(): Promise<string[]> {
  const { data, error } = await supabaseClient
    .from('v2_actors')
    .select('custom_text_2')
    .eq('actor_type', 'person')
    .not('custom_text_2', 'is', null)
    .order('custom_text_2', { ascending: true });

  if (error) throw error;
  const categories = (data ?? []).map(row => row.custom_text_2).filter(Boolean) as string[];
  return Array.from(new Set(categories));
}

export async function fetchRelationshipLookups(): Promise<{
  relationships: string[];
  roles: string[];
  roleCategories: string[];
}> {
  const [relationshipsResp, rolesResp, roleCategoriesResp] = await Promise.all([
    supabaseClient
      .from('v2_actor_links')
      .select('relationship')
      .not('relationship', 'is', null)
      .limit(100),
    supabaseClient
      .from('v2_actor_links')
      .select('role')
      .not('role', 'is', null)
      .limit(100),
    supabaseClient
      .from('v2_actor_links')
      .select('role_category')
      .not('role_category', 'is', null)
      .limit(100),
  ]);

  if (relationshipsResp.error) throw relationshipsResp.error;
  if (rolesResp.error) throw rolesResp.error;
  if (roleCategoriesResp.error) throw roleCategoriesResp.error;

  const relationships = Array.from(
    new Set((relationshipsResp.data ?? []).map(item => item.relationship).filter(Boolean)),
  ) as string[];
  const roles = Array.from(new Set((rolesResp.data ?? []).map(item => item.role).filter(Boolean))) as string[];
  const roleCategories = Array.from(
    new Set((roleCategoriesResp.data ?? []).map(item => item.role_category).filter(Boolean)),
  ) as string[];

  return {
    relationships: relationships.sort(),
    roles: roles.sort(),
    roleCategories: roleCategories.sort(),
  };
}

export async function createActorLinks(fromActorId: string, links: PromoteLinkInput[]) {
  if (!links.length) return;

  const payload = links.map(link => ({
    from_actor_id: fromActorId,
    to_actor_id: link.toActorId,
    relationship: link.relationship ?? null,
    role: link.role ?? null,
    role_category: link.roleCategory ?? null,
    is_primary: link.isPrimary ?? null,
    start_date: link.startDate ?? null,
    end_date: link.endDate ?? null,
    metadata: link.metadata ?? null,
  }));

  const { error } = await supabaseClient.from('v2_actor_links').insert(payload);
  if (error) throw error;
}
