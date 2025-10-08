import { supabaseClient } from './supabaseClient';
import type {
  ClassifierFilterConfig,
  ClassifierView,
  FieldMapping,
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

// Bio-only keyword clause for targeted classifier views (reduced OR fanout)
function buildBioOnlyClause(keyword: string): string {
  const sanitized = keyword.replace(/[,\s]+/g, ' ').trim();
  if (!sanitized) return '';
  const token = `*${sanitized}*`;
  return `profile_bio.ilike.${token}`;
}

const KEYWORD_SCAN_BATCH = 200;
const KEYWORD_SCAN_MULTIPLIER = 8;

function sanitizeUnknownActors(rows: any[]): UnknownActor[] {
  const filtered = (rows ?? []).filter((actor: any) => {
    const placeholder = actor?.x_profile_data && actor.x_profile_data.is_placeholder === true;
    const hasDisplay = Boolean(actor?.profile_displayname);
    return !placeholder && hasDisplay;
  }) as UnknownActor[];

  return filtered.map(actor => ({
    ...actor,
    network_interactions: actor.network_interactions ?? actor.mention_count ?? 0,
  }));
}

function shouldUseClientKeywordFiltering(config?: ClassifierFilterConfig): string[] | null {
  if (!config) return null;
  if (config.filter === 'keyword' && config.keywords && config.keywords.length > 0) {
    return config.keywords;
  }
  return null;
}

async function fetchKeywordFilteredUnknownActors({
  keywords,
  offset,
  limit,
  platform,
  searchTerm,
}: {
  keywords: string[];
  offset: number;
  limit: number;
  platform?: string;
  searchTerm?: string;
}): Promise<UnknownActorResponse> {
  const normalizedKeywords = keywords
    .map(keyword => keyword.trim().toLowerCase())
    .filter(Boolean);

  if (normalizedKeywords.length === 0) {
    return { actors: [], hasMore: false, total: 0 };
  }

  const batchSize = Math.max(limit * KEYWORD_SCAN_MULTIPLIER, KEYWORD_SCAN_BATCH);
  const maxRowsToScan = (offset + limit) * KEYWORD_SCAN_MULTIPLIER;

  const collected: UnknownActor[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let scanned = 0;
  let totalCount: number | null = null;
  let cursor = 0;

  while (scanned < maxRowsToScan && collected.length < limit) {
    let query = supabaseClient
      .from('v2_unknown_actors')
      .select('*', { count: 'exact' })
      .eq('review_status', 'pending')
      .order('mention_count', { ascending: false })
      .range(cursor, cursor + batchSize - 1);

    if (platform) {
      query = query.eq('platform', platform);
    }

    if (searchTerm) {
      const clause = buildKeywordClause(searchTerm);
      if (clause) {
        query = query.or(clause);
      }
    }

    const { data, error, count } = await query;
    if (error) throw error;

    if (totalCount === null) {
      totalCount = count ?? null;
    }

    const rows = data ?? [];
    const sanitized = sanitizeUnknownActors(rows);
    if (rows.length === 0) {
      break;
    }

    for (const actor of sanitized) {
      const bio = (actor.profile_bio ?? '').toLowerCase();
      if (normalizedKeywords.some(keyword => bio.includes(keyword))) {
        if (skipped < offset) {
          skipped += 1;
        } else if (!seen.has(actor.id)) {
          collected.push(actor);
          seen.add(actor.id);
          if (collected.length >= limit) {
            break;
          }
        }
      }
    }

    cursor += rows.length;
    scanned += rows.length;

    if (rows.length < batchSize) {
      break;
    }

    if (totalCount !== null && cursor >= totalCount) {
      break;
    }
  }

  const totalMatchesEstimate = skipped + collected.length;
  const hasMore = collected.length >= limit || (totalCount !== null && cursor < totalCount);

  return {
    actors: collected.slice(0, limit),
    hasMore,
    total: hasMore ? totalMatchesEstimate + 1 : totalMatchesEstimate,
  };
}

function applyFilterConfig(query: any, config?: ClassifierFilterConfig) {
  if (!config) return query;

  let builder = query as any;

  switch (config.filter) {
    case 'all':
      return builder;
    case 'keyword':
      if (config.keywords && config.keywords.length > 0) {
        // Scope classifier keyword filters to bios only to avoid timeouts on JSON field ORs
        const clause = config.keywords
          .map(buildBioOnlyClause)
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
            // Bio-only for combined keyword filters as well
            const clause = f.keywords.map(buildBioOnlyClause).filter(Boolean).join(',');
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
  const keywordFilterKeywords = shouldUseClientKeywordFiltering(config);
  if (keywordFilterKeywords && !searchTerm) {
    return fetchKeywordFilteredUnknownActors({
      keywords: keywordFilterKeywords,
      offset,
      limit,
      platform,
      searchTerm,
    });
  }

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

  const decorated = sanitizeUnknownActors(data ?? []);

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

  // Apply main search term if provided
  const searchTerm = term?.trim();
  if (searchTerm) {
    const encoded = searchTerm.replace(/%/g, '\\%');
    builder = builder.or(
      `name.ilike.*${encoded}*,about.ilike.*${encoded}*,city.ilike.*${encoded}*,state.ilike.*${encoded}*,region.ilike.*${encoded}*`,
    );
  }

  // Apply advanced filters as AND conditions
  if (options.name) {
    const encoded = options.name.replace(/%/g, '\\%');
    builder = builder.ilike('name', `%${encoded}%`);
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

export async function fetchFieldMappings(actorType: string): Promise<FieldMapping[]> {
  const { data: typeRow, error: typeError } = await supabaseClient
    .from('v2_actor_types')
    .select('id')
    .eq('name', actorType)
    .maybeSingle();

  if (typeError) throw typeError;
  if (!typeRow?.id) return [];

  const { data, error } = await supabaseClient
    .from('v2_actor_type_field_mappings')
    .select('id,actor_type_id,field_name,column_name,data_type,is_indexed,is_metadata')
    .eq('actor_type_id', typeRow.id)
    .order('field_name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as FieldMapping[];
}

export async function fetchFieldExistingValues(columnName: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseClient
      .from('v2_actors')
      .select(columnName)
      .not(columnName, 'is', null)
      .order(columnName, { ascending: true })
      .limit(50);

    if (error) throw error;
    const values = ((data ?? []) as any[])
      .map(row => row[columnName])
      .filter((value: any) => value !== null && value !== undefined && String(value).trim() !== '')
      .map((value: any) => String(value).trim());
    return Array.from(new Set(values));
  } catch (error) {
    console.error(`Failed to fetch existing values for column ${columnName}`, error);
    return [];
  }
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
