// Vercel API route that mirrors MCP services as plain JavaScript
// Maps tool names to service-equivalent functions using @supabase/supabase-js

import { createClient } from '@supabase/supabase-js'

// Env: prefer server-side secrets; fall back to VITE_ vars if needed
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase env not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY (or their VITE_ equivalents).')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
}

// ---------------- EventAnalyzer.queryEvents (JS) ----------------
async function queryEvents(supabase, filters = {}) {
  let query = supabase
    .from('v2_events')
    .select(`
      *,
      v2_event_actor_links!inner(
        actor_id,
        actor_handle,
        actor_type,
        platform
      ),
      v2_event_post_links(
        post_id,
        v2_social_media_posts(
          id,
          platform,
          content_text,
          post_timestamp,
          author_handle
        )
      )
    `)

  if (filters.date_range) {
    if (filters.date_range.start_date) query = query.gte('event_date', filters.date_range.start_date)
    if (filters.date_range.end_date) query = query.lte('event_date', filters.date_range.end_date)
  }
  if (filters.states?.length) query = query.in('state', filters.states)
  if (filters.cities?.length) query = query.in('city', filters.cities)
  if (filters.confidence_threshold) query = query.gte('confidence_score', filters.confidence_threshold)

  // OR over tags using PostgREST or logic on JSONB array
  if (filters.tags?.length) {
    const orConditions = filters.tags
      .map((tag) => `category_tags.cs.[${JSON.stringify(tag)}]`)
      .join(',')
    query = query.or(orConditions)
  }

  query = query.limit(filters.limit || 100).order('event_date', { ascending: false })
  const { data, error } = await query
  if (error) throw error

  const events = (data || []).map((event) => ({
    id: event.id,
    name: event.event_name,
    date: event.event_date,
    location: {
      venue: event.location,
      city: event.city,
      state: event.state,
      coordinates: { latitude: event.latitude, longitude: event.longitude },
    },
    description: event.event_description,
    tags: event.category_tags || [],
    confidence_score: event.confidence_score,
    verified: event.verified,
    actors:
      event.v2_event_actor_links?.map((link) => ({
        id: link.actor_id,
        handle: link.actor_handle,
        type: link.actor_type,
        platform: link.platform,
      })) || [],
    posts:
      event.v2_event_post_links?.map((link) => ({
        id: link.v2_social_media_posts?.id,
        platform: link.v2_social_media_posts?.platform,
        content: link.v2_social_media_posts?.content_text,
        timestamp: link.v2_social_media_posts?.post_timestamp,
        author: link.v2_social_media_posts?.author_handle,
      })) || [],
  }))

  return { total_count: events.length, events, filters_applied: filters }
}

// ---------------- VectorSearch.searchPosts (JS) with fallback ----------------
async function searchPosts(supabase, args = {}) {
  const { query, limit = 50, similarity_threshold = 0.7, filters = {} } = args

  // Attempt vector RPC; if it errors, fallback to text search
  try {
    const { data, error } = await supabase.rpc('search_posts_by_embedding', {
      query_embedding: null, // Server-side function may compute embedding or ignore; if not, it will error and we'll fallback
      similarity_threshold,
      match_limit: limit,
      filter_platform: filters.platform || null,
      filter_start_date: filters.date_range?.start_date || null,
      filter_end_date: filters.date_range?.end_date || null,
      filter_author_handles: filters.author_handles || null,
      query_text: query || null,
    })
    if (error) throw error

    const results = (data || []).map((post) => ({
      id: post.id,
      platform: post.platform,
      author: { handle: post.author_handle, name: post.author_name },
      content: post.content_text,
      timestamp: post.post_timestamp,
      similarity_score: post.similarity,
      engagement: { likes: post.like_count, replies: post.reply_count, shares: post.share_count },
      url: post.post_url,
      linked_actor: post.linked_actor_id
        ? { id: post.linked_actor_id, type: post.linked_actor_type }
        : null,
    }))
    return { query, total_results: results.length, similarity_threshold, filters_applied: filters, posts: results }
  } catch (_) {
    // Fallback text search
    let q = supabase
      .from('v2_social_media_posts')
      .select(`*, v2_actors!linked_actor_id(id, name, actor_type)`) // join for linked actor
      .ilike('content_text', `%${query || ''}%`)

    if (filters.platform) q = q.eq('platform', filters.platform)
    if (filters.date_range?.start_date) q = q.gte('post_timestamp', filters.date_range.start_date)
    if (filters.date_range?.end_date) q = q.lte('post_timestamp', filters.date_range.end_date)
    if (filters.author_handles?.length) q = q.in('author_handle', filters.author_handles)

    const { data, error } = await q.order('post_timestamp', { ascending: false }).limit(limit)
    if (error) throw error

    const posts = (data || []).map((post) => ({
      id: post.id,
      platform: post.platform,
      author: post.author_handle,
      content: post.content_text,
      timestamp: post.post_timestamp,
      engagement: { likes: post.like_count, replies: post.reply_count, shares: post.share_count },
      url: post.post_url,
      linked_actor: post.v2_actors ? { id: post.v2_actors.id, name: post.v2_actors.name, type: post.v2_actors.actor_type } : null,
    }))
    return { query, search_type: 'text_search', total_results: posts.length, filters_applied: filters, posts }
  }
}

// ---------------- AnalyticsEngine: analyze_trends wrapper ----------------
async function analyzeTrends(supabase, params = {}) {
  const { date_range, grouping = 'month', filters = {} } = params
  // Pull events and group similar to AnalyticsEngine.getEventTrends
  let q = supabase.from('v2_events').select('id, event_date, state, city, category_tags, confidence_score')
  if (date_range?.start_date) q = q.gte('event_date', date_range.start_date)
  if (date_range?.end_date) q = q.lte('event_date', date_range.end_date)
  if (filters?.states?.length) q = q.in('state', filters.states)
  if (filters?.tags?.length) for (const tag of filters.tags) q = q.contains('category_tags', [tag])

  const { data: events, error } = await q
  if (error) throw error

  const grouped = {}
  for (const ev of events || []) {
    let key = 'all'
    if (grouping === 'day') key = ev.event_date || 'unknown'
    else if (grouping === 'state') key = ev.state || 'unknown'
    else if (grouping === 'tag') {
      const tags = ev.category_tags || []
      for (const t of tags) {
        if (!grouped[t]) grouped[t] = { count: 0, events: [] }
        grouped[t].count++
        grouped[t].events.push(ev.id)
      }
      continue
    } else {
      // week/month coarse grouping (approximate by YYYY-MM)
      key = (ev.event_date || '').slice(0, 7) || 'unknown'
    }
    if (!grouped[key]) grouped[key] = { count: 0, events: [] }
    grouped[key].count++
    grouped[key].events.push(ev.id)
  }
  const dataOut = Object.entries(grouped).map(([key, v]) => ({ key, count: v.count, events: v.events }))
  return { metric_type: 'event_trends', period: date_range, grouping, total_events: (events || []).length, data: dataOut }
}

// ---------------- ActorResolver.getActorInfo (JS) ----------------
async function getActorInfo(supabase, params = {}) {
  const { actor_id, actor_name, actor_type, include_events = false, include_posts = false, include_relationships = true } = params

  let q = supabase.from('v2_actors').select('*')
  if (actor_id) q = q.eq('id', actor_id)
  else if (actor_name) q = q.ilike('name', `%${actor_name}%`)
  if (actor_type) q = q.eq('actor_type', actor_type)

  const { data: actors, error } = await q
  if (error) throw error
  if (!actors || actors.length === 0) return { error: 'No actors found matching the criteria' }

  const out = []
  for (const actor of actors) {
    const result = {
      id: actor.id,
      type: actor.actor_type,
      name: actor.name,
      location: { city: actor.city, state: actor.state, region: actor.region },
      about: actor.about,
      should_scrape: actor.should_scrape,
      profiles: extractProfiles(actor),
    }

    const { data: usernames } = await supabase.from('v2_actor_usernames').select('*').eq('actor_id', actor.id)
    result.usernames = (usernames || []).map((u) => ({ platform: u.platform, username: u.username, url: u.url, is_primary: u.is_primary, follower_count: u.follower_count }))

    if (include_relationships) result.relationships = await getActorRelationships(supabase, actor.id, actor.actor_type)
    if (include_events) result.events = await getActorEvents(supabase, actor.id)
    if (include_posts) result.posts = await getActorPosts(supabase, actor.id)

    if (actor.actor_type === 'person' && actor.data) {
      result.person_details = { role: actor.custom_text_1, organization: actor.custom_text_2, division: actor.custom_text_3, status: actor.custom_text_4 }
    } else if (actor.actor_type === 'organization' && actor.data) {
      result.org_details = { type: actor.data.type, parent_organization: actor.data.parent_organization, focus: actor.data.summary_focus, scope: actor.data.region_scope }
    } else if (actor.actor_type === 'chapter' && actor.data) {
      result.chapter_details = {
        institution_type: actor.custom_text_1,
        status: actor.data?.misc?.status,
        officers: actor.data?.misc?.officers,
        coordinator: { name: actor.data?.misc?.coordinator_name, email: actor.data?.misc?.coordinator_email },
        representative: { name: actor.data?.misc?.representative_name, email: actor.data?.misc?.representative_email },
      }
    }
    out.push(result)
  }
  return { total: out.length, actors: out }
}

function extractProfiles(actor) {
  const profiles = []
  if (actor.website_url) profiles.push({ type: 'website', url: actor.website_url })
  if (actor.twitter_url) profiles.push({ type: 'twitter', url: actor.twitter_url })
  if (actor.instagram_url) profiles.push({ type: 'instagram', url: actor.instagram_url })
  if (actor.facebook_url) profiles.push({ type: 'facebook', url: actor.facebook_url })
  if (actor.youtube_url) profiles.push({ type: 'youtube', url: actor.youtube_url })
  return profiles
}

async function getActorRelationships(supabase, actorId, actorType) {
  const relationships = { affiliations: [], associated_with: [] }
  const { data: outgoingLinks } = await supabase
    .from('v2_actor_links')
    .select(`*, to_actor:v2_actors!v2_actor_links_to_actor_id_fkey(id, name, actor_type)`) // outgoing
    .eq('from_actor_id', actorId)
    .limit(50)

  const { data: incomingLinks } = await supabase
    .from('v2_actor_links')
    .select(`*, from_actor:v2_actors!v2_actor_links_from_actor_id_fkey(id, name, actor_type)`) // incoming
    .eq('to_actor_id', actorId)
    .limit(50)

  relationships.affiliations = (outgoingLinks || []).map((link) => ({
    actor: { id: link.to_actor.id, name: link.to_actor.name, type: link.to_actor.actor_type },
    role: link.role,
    relationship: link.relationship,
    is_primary: link.is_primary,
    start_date: link.start_date,
    end_date: link.end_date,
  }))
  relationships.associated_with = (incomingLinks || []).map((link) => ({
    actor: { id: link.from_actor.id, name: link.from_actor.name, type: link.from_actor.actor_type },
    role: link.role,
    relationship: link.relationship,
    start_date: link.start_date,
    end_date: link.end_date,
  }))
  return relationships
}

async function getActorEvents(supabase, actorId) {
  const { data: eventLinks } = await supabase
    .from('v2_event_actor_links')
    .select(`event_id, v2_events(id, event_name, event_date, city, state, category_tags, confidence_score)`) // join events
    .eq('actor_id', actorId)
    .limit(100)
  return (eventLinks || []).map((link) => {
    const ev = link.v2_events || {}
    return { id: ev.id, name: ev.event_name, date: ev.event_date, location: `${ev.city}, ${ev.state}`, tags: ev.category_tags || [], confidence: ev.confidence_score }
  })
}

async function getActorPosts(supabase, actorId) {
  const { data: posts } = await supabase
    .from('v2_social_media_posts')
    .select('*')
    .eq('linked_actor_id', actorId)
    .order('post_timestamp', { ascending: false })
    .limit(50)
  return (posts || []).map((post) => ({
    id: post.id,
    platform: post.platform,
    timestamp: post.post_timestamp,
    content: (post.content_text || '').slice(0, 500),
    engagement: { likes: post.like_count, replies: post.reply_count, shares: post.share_count },
    url: post.post_url,
  }))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method Not Allowed' })
    return
  }
  const toolName = req.query.toolName
  const args = req.body || {}

  try {
    const supabase = getSupabase()

    let result
    switch (toolName) {
      case 'query_events':
        result = await queryEvents(supabase, args.filters || {})
        break
      case 'search_posts':
        result = await searchPosts(supabase, args)
        break
      case 'search_events':
        result = await searchEvents(supabase, args)
        break
      case 'find_similar_content':
        result = await findSimilarContent(supabase, args)
        break
      case 'analyze_trends':
        result = await analyzeTrends(supabase, args)
        break
      case 'get_analytics':
        result = await getAnalytics(supabase, args)
        break
      case 'get_actor_info':
        result = await getActorInfo(supabase, args)
        break
      case 'resolve_unknown_actors':
        result = await resolveUnknownActors(supabase, args)
        break
      default:
        res.status(404).json({ success: false, error: `Unknown tool: ${toolName}` })
        return
    }
    res.status(200).json({ success: true, result })
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || 'Internal error' })
  }
}

// --------- VectorSearch.searchEvents with fallback ---------
async function searchEvents(supabase, args = {}) {
  const { query, limit = 50, similarity_threshold = 0.7, filters = {} } = args
  try {
    const { data, error } = await supabase.rpc('search_events_by_embedding', {
      query_embedding: null,
      similarity_threshold,
      match_limit: limit,
      filter_start_date: filters.date_range?.start_date || null,
      filter_end_date: filters.date_range?.end_date || null,
      filter_states: filters.states || null,
      query_text: query || null,
    })
    if (error) throw error
    const events = (data || []).map((ev) => ({
      id: ev.id,
      name: ev.event_name,
      date: ev.event_date,
      location: { venue: ev.location, city: ev.city, state: ev.state },
      description: ev.event_description,
      similarity_score: ev.similarity,
      tags: ev.category_tags || [],
      confidence: ev.confidence_score,
    }))
    return { query, total_results: events.length, similarity_threshold, filters_applied: filters, events }
  } catch (_) {
    // Fallback text search across name/description
    let q = supabase
      .from('v2_events')
      .select('*')
      .or(`event_name.ilike.%${query || ''}%,event_description.ilike.%${query || ''}%`)
    if (filters.date_range?.start_date) q = q.gte('event_date', filters.date_range.start_date)
    if (filters.date_range?.end_date) q = q.lte('event_date', filters.date_range.end_date)
    if (filters.states?.length) q = q.in('state', filters.states)
    if (filters.tags?.length) for (const tag of filters.tags) q = q.contains('category_tags', [tag])
    const { data, error } = await q.order('event_date', { ascending: false }).limit(limit)
    if (error) throw error
    const events = (data || []).map((ev) => ({
      id: ev.id,
      name: ev.event_name,
      date: ev.event_date,
      location: { venue: ev.location, city: ev.city, state: ev.state },
      description: ev.event_description,
      tags: ev.category_tags || [],
      confidence: ev.confidence_score,
    }))
    return { query, search_type: 'text_search', total_results: events.length, filters_applied: filters, events }
  }
}

// --------- VectorSearch.findSimilarContent ---------
async function findSimilarContent(supabase, args = {}) {
  const { content_id, content_type = 'post', limit = 20 } = args
  const table = content_type === 'event' ? 'v2_events' : 'v2_social_media_posts'
  const { data: content, error: err } = await supabase.from(table).select('*').eq('id', content_id).single()
  if (err || !content) throw new Error('Content not found')
  const rpc = content_type === 'event' ? 'find_similar_events' : 'find_similar_posts'
  const { data, error } = await supabase.rpc(rpc, { target_id: content_id, match_limit: limit })
  if (error) throw error
  return { content_id, content_type, total: (data || []).length, items: data || [] }
}

// --------- AnalyticsEngine.getAnalytics dispatcher ---------
async function getAnalytics(supabase, params = {}) {
  const { metric_type, date_range, grouping, filters } = params
  switch (metric_type) {
    case 'event_trends':
      return analyzeTrends(supabase, { date_range, grouping, filters })
    case 'actor_activity':
      return actorActivity(supabase, { date_range, filters })
    case 'geographic_distribution':
      return geographicDistribution(supabase, { date_range, filters })
    case 'tag_frequency':
      return tagFrequency(supabase, { date_range, filters })
    case 'network_analysis':
      return networkAnalysis(supabase, { date_range, filters })
    default:
      throw new Error(`Unknown metric type: ${metric_type}`)
  }
}

async function actorActivity(supabase, { date_range, filters = {} }) {
  // Get links with joined actors and events to compute activity
  let q = supabase
    .from('v2_event_actor_links')
    .select('actor_id, actor_handle, actor_type, event_id, v2_events(id, state)')
  if (date_range?.start_date) q = q.gte('created_at', date_range.start_date)
  if (date_range?.end_date) q = q.lte('created_at', date_range.end_date)
  const { data, error } = await q
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const key = `${row.actor_id}`
    if (!map[key]) map[key] = { actor_id: row.actor_id, handle: row.actor_handle, type: row.actor_type, event_count: 0, states: new Set(), events: [] }
    map[key].event_count++
    map[key].events.push(row.event_id)
    const state = row.v2_events?.state
    if (state) map[key].states.add(state)
  }
  const top = Object.values(map).map((a) => ({ ...a, states_active: Array.from(a.states), state_count: a.states.size }))
    .sort((a, b) => b.event_count - a.event_count).slice(0, 50)
  return { metric_type: 'actor_activity', period: date_range, total_actors: Object.keys(map).length, top_actors: top }
}

async function geographicDistribution(supabase, { date_range, filters = {} }) {
  const { data, error } = await supabase.rpc('get_map_points', {
    p_filters: { start_date: date_range?.start_date, end_date: date_range?.end_date, tags: filters.tags || [], states: filters.states || [] }
  })
  if (error) throw error
  const stateDistribution = {}
  const cityDistribution = {}
  for (const p of data?.map_points || []) {
    const s = p.state || 'unknown'
    const c = `${p.city}, ${p.state}`
    stateDistribution[s] = (stateDistribution[s] || 0) + p.count
    cityDistribution[c] = p.count
  }
  const top_cities = Object.entries(cityDistribution).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([city, count]) => ({ city, count }))
  return { metric_type: 'geographic_distribution', period: date_range, total_events: data?.total_events || 0, virtual_events: data?.virtual_bucket?.count || 0, state_distribution: stateDistribution, top_cities, map_points: (data?.map_points || []).slice(0, 100) }
}

async function tagFrequency(supabase, { date_range, filters = {} }) {
  let q = supabase.from('v2_events').select('category_tags, event_date')
  if (date_range?.start_date) q = q.gte('event_date', date_range.start_date)
  if (date_range?.end_date) q = q.lte('event_date', date_range.end_date)
  if (filters?.states?.length) q = q.in('state', filters.states)
  const { data: events, error } = await q
  if (error) throw error
  const counts = {}
  const co = {}
  for (const ev of events || []) {
    const tags = ev.category_tags || []
    for (const t of tags) {
      counts[t] = (counts[t] || 0) + 1
      for (const o of tags) if (o !== t) { if (!co[t]) co[t] = {}; co[t][o] = (co[t][o] || 0) + 1 }
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([tag, count]) => ({ tag, count }))
  return { metric_type: 'tag_frequency', period: date_range, top_tags: top, cooccurrence: co }
}

async function networkAnalysis(supabase, { date_range, filters = {} }) {
  // Basic network derived from actor links
  const { data, error } = await supabase
    .from('v2_actor_links')
    .select('from_actor_id, to_actor_id, role, relationship, start_date, end_date')
  if (error) throw error
  return { metric_type: 'network_analysis', edges: data || [] }
}

// --------- ActorResolver.resolveUnknownActors ---------
async function resolveUnknownActors(supabase, params = {}) {
  const limit = params.limit || 100
  const { data: unknowns, error } = await supabase
    .from('v2_unknown_actors')
    .select('*')
    .eq('review_status', 'pending')
    .order('mention_count', { ascending: false })
    .limit(limit)
  if (error) throw error

  const suggestions = []
  for (const unk of unknowns || []) {
    const name = unk.detected_username || ''
    const { data: matches } = await supabase
      .from('v2_actors')
      .select('id, name, actor_type, city, state')
      .ilike('name', `%${name}%`)
      .limit(10)
    suggestions.push({
      unknown_actor: { id: unk.id, username: unk.detected_username, platform: unk.platform, mention_count: unk.mention_count },
      suggested_matches: matches || []
    })
  }
  return { total: suggestions.length, items: suggestions }
}
