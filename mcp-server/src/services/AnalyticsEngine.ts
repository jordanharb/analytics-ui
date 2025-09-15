import { SupabaseClient } from '@supabase/supabase-js';
import { format, startOfDay, endOfDay, startOfWeek, startOfMonth } from 'date-fns';

export class AnalyticsEngine {
  constructor(private supabase: SupabaseClient) {}

  async getAnalytics(params: any) {
    try {
      const { metric_type, date_range, grouping, filters } = params;

      switch (metric_type) {
        case 'event_trends':
          return this.getEventTrends(date_range, grouping, filters);

        case 'actor_activity':
          return this.getActorActivity(date_range, grouping, filters);

        case 'geographic_distribution':
          return this.getGeographicDistribution(date_range, filters);

        case 'tag_frequency':
          return this.getTagFrequency(date_range, filters);

        case 'network_analysis':
          return this.getNetworkAnalysis(date_range, filters);

        default:
          throw new Error(`Unknown metric type: ${metric_type}`);
      }
    } catch (error) {
      throw new Error(`Failed to get analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getEventTrends(dateRange: any, grouping: string, filters: any) {
    // Build query for event trends
    let query = this.supabase
      .from('v2_events')
      .select('id, event_date, state, city, category_tags, confidence_score');

    // Apply date range
    if (dateRange?.start_date) {
      query = query.gte('event_date', dateRange.start_date);
    }
    if (dateRange?.end_date) {
      query = query.lte('event_date', dateRange.end_date);
    }

    // Apply filters
    if (filters?.states?.length) {
      query = query.in('state', filters.states);
    }
    if (filters?.tags?.length) {
      for (const tag of filters.tags) {
        query = query.contains('category_tags', [tag]);
      }
    }

    const { data: events, error } = await query;

    if (error) throw error;

    // Group data based on grouping parameter
    const grouped = this.groupEventData(events || [], grouping);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            metric_type: 'event_trends',
            period: dateRange,
            grouping,
            total_events: events?.length || 0,
            data: grouped,
          }, null, 2),
        },
      ],
    };
  }

  private groupEventData(events: any[], grouping: string) {
    const grouped: Record<string, any> = {};

    for (const event of events) {
      let key: string;

      switch (grouping) {
        case 'day':
          key = event.event_date || 'unknown';
          break;
        case 'week':
          key = event.event_date
            ? format(startOfWeek(new Date(event.event_date)), 'yyyy-MM-dd')
            : 'unknown';
          break;
        case 'month':
          key = event.event_date
            ? format(startOfMonth(new Date(event.event_date)), 'yyyy-MM')
            : 'unknown';
          break;
        case 'state':
          key = event.state || 'unknown';
          break;
        case 'tag':
          // Handle multiple tags per event
          const tags = event.category_tags || [];
          for (const tag of tags) {
            if (!grouped[tag]) {
              grouped[tag] = { count: 0, events: [] };
            }
            grouped[tag].count++;
            grouped[tag].events.push(event.id);
          }
          continue;
        default:
          key = 'all';
      }

      if (!grouped[key]) {
        grouped[key] = { count: 0, events: [] };
      }
      grouped[key].count++;
      grouped[key].events.push(event.id);
    }

    // Convert to array and sort
    return Object.entries(grouped)
      .map(([key, value]) => ({
        key,
        count: value.count,
        percentage: ((value.count / events.length) * 100).toFixed(1) + '%',
      }))
      .sort((a, b) => b.count - a.count);
  }

  private async getActorActivity(dateRange: any, grouping: string, filters: any) {
    // Get actor activity from events
    let query = this.supabase
      .from('v2_event_actor_links')
      .select(`
        actor_id,
        event_id,
        actor_type,
        v2_events!inner(
          event_date,
          state,
          category_tags
        ),
        v2_actors!inner(
          name,
          actor_type
        )
      `);

    // Apply date range via joined events
    if (dateRange?.start_date || dateRange?.end_date) {
      // Note: Filtering on joined tables requires different syntax in Supabase
      const { data: eventIds } = await this.supabase
        .from('v2_events')
        .select('id')
        .gte('event_date', dateRange.start_date || '1900-01-01')
        .lte('event_date', dateRange.end_date || '2100-12-31');

      if (eventIds?.length) {
        query = query.in('event_id', eventIds.map(e => e.id));
      }
    }

    const { data: actorLinks, error } = await query;

    if (error) throw error;

    // Aggregate by actor
    const actorActivity: Record<string, any> = {};

    for (const link of actorLinks || []) {
      const actor = link.v2_actors as any;
      const event = link.v2_events as any;
      const actorKey = `${actor?.name} (${actor?.actor_type})`;

      if (!actorActivity[actorKey]) {
        actorActivity[actorKey] = {
          actor_id: link.actor_id,
          name: actor?.name,
          type: actor?.actor_type,
          event_count: 0,
          events: [],
          states: new Set(),
        };
      }

      actorActivity[actorKey].event_count++;
      actorActivity[actorKey].events.push(link.event_id);
      if (event?.state) {
        actorActivity[actorKey].states.add(event.state);
      }
    }

    // Convert to array and format
    const topActors = Object.values(actorActivity)
      .map(actor => ({
        actor_id: actor.actor_id,
        name: actor.name,
        type: actor.type,
        event_count: actor.event_count,
        states_active: Array.from(actor.states),
        state_count: actor.states.size,
      }))
      .sort((a, b) => b.event_count - a.event_count)
      .slice(0, 50);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            metric_type: 'actor_activity',
            period: dateRange,
            total_actors: Object.keys(actorActivity).length,
            top_actors: topActors,
          }, null, 2),
        },
      ],
    };
  }

  private async getGeographicDistribution(dateRange: any, filters: any) {
    // Use the existing get_map_points function
    const { data, error } = await this.supabase.rpc('get_map_points', {
      p_filters: {
        start_date: dateRange?.start_date,
        end_date: dateRange?.end_date,
        tags: filters?.tags || [],
        states: filters?.states || [],
      },
    });

    if (error) throw error;

    // Process map points for analytics
    const stateDistribution: Record<string, number> = {};
    const cityDistribution: Record<string, number> = {};

    for (const point of data?.map_points || []) {
      const stateKey = point.state || 'unknown';
      const cityKey = `${point.city}, ${point.state}`;

      stateDistribution[stateKey] = (stateDistribution[stateKey] || 0) + point.count;
      cityDistribution[cityKey] = point.count;
    }

    // Get top cities
    const topCities = Object.entries(cityDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([city, count]) => ({ city, count }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            metric_type: 'geographic_distribution',
            period: dateRange,
            total_events: data?.total_events || 0,
            virtual_events: data?.virtual_bucket?.count || 0,
            state_distribution: stateDistribution,
            top_cities: topCities,
            map_points: data?.map_points?.slice(0, 100) || [],
          }, null, 2),
        },
      ],
    };
  }

  private async getTagFrequency(dateRange: any, filters: any) {
    // Get all events with tags
    let query = this.supabase
      .from('v2_events')
      .select('category_tags, event_date');

    // Apply date range
    if (dateRange?.start_date) {
      query = query.gte('event_date', dateRange.start_date);
    }
    if (dateRange?.end_date) {
      query = query.lte('event_date', dateRange.end_date);
    }

    // Apply state filter
    if (filters?.states?.length) {
      query = query.in('state', filters.states);
    }

    const { data: events, error } = await query;

    if (error) throw error;

    // Count tag frequencies
    const tagCounts: Record<string, number> = {};
    const tagCooccurrence: Record<string, Record<string, number>> = {};

    for (const event of events || []) {
      const tags = event.category_tags || [];

      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;

        // Track co-occurrence
        for (const otherTag of tags) {
          if (tag !== otherTag) {
            if (!tagCooccurrence[tag]) {
              tagCooccurrence[tag] = {};
            }
            tagCooccurrence[tag][otherTag] = (tagCooccurrence[tag][otherTag] || 0) + 1;
          }
        }
      }
    }

    // Format results
    const tagStats = Object.entries(tagCounts)
      .map(([tag, count]) => ({
        tag,
        count,
        percentage: ((count / (events?.length || 1)) * 100).toFixed(1) + '%',
        top_cooccurring: Object.entries(tagCooccurrence[tag] || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([coTag, coCount]) => ({
            tag: coTag,
            count: coCount,
          })),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            metric_type: 'tag_frequency',
            period: dateRange,
            total_events: events?.length || 0,
            unique_tags: Object.keys(tagCounts).length,
            tag_statistics: tagStats,
          }, null, 2),
        },
      ],
    };
  }

  private async getNetworkAnalysis(dateRange: any, filters: any) {
    // Get actor relationships and event co-participation
    const { data: actorLinks, error: linksError } = await this.supabase
      .from('v2_actor_links')
      .select(`
        from_actor_id,
        to_actor_id,
        relationship,
        role,
        is_primary,
        from_actor:v2_actors!v2_actor_links_from_actor_id_fkey(
          id,
          name,
          actor_type
        ),
        to_actor:v2_actors!v2_actor_links_to_actor_id_fkey(
          id,
          name,
          actor_type
        )
      `)
      .limit(500);

    if (linksError) throw linksError;

    // Get event co-participation
    const { data: eventLinks, error: eventError } = await this.supabase
      .from('v2_event_actor_links')
      .select('event_id, actor_id')
      .limit(1000);

    if (eventError) throw eventError;

    // Build co-participation network
    const coparticipation: Record<string, Set<string>> = {};
    const eventsByActor: Record<string, Set<string>> = {};

    for (const link of eventLinks || []) {
      if (!eventsByActor[link.actor_id]) {
        eventsByActor[link.actor_id] = new Set();
      }
      eventsByActor[link.actor_id].add(link.event_id);
    }

    // Find actors who participated in same events
    const actorIds = Object.keys(eventsByActor);
    const coparticipationCounts: Record<string, number> = {};

    for (let i = 0; i < actorIds.length; i++) {
      for (let j = i + 1; j < actorIds.length; j++) {
        const actor1 = actorIds[i];
        const actor2 = actorIds[j];

        const sharedEvents = Array.from(eventsByActor[actor1])
          .filter(eventId => eventsByActor[actor2].has(eventId));

        if (sharedEvents.length > 0) {
          const key = [actor1, actor2].sort().join('::');
          coparticipationCounts[key] = sharedEvents.length;
        }
      }
    }

    // Get top co-participations
    const topCoparticipations = Object.entries(coparticipationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([key, count]) => {
        const [actor1, actor2] = key.split('::');
        return { actor1, actor2, shared_events: count };
      });

    // Network statistics
    const networkStats = {
      total_actors: actorIds.length,
      total_relationships: actorLinks?.length || 0,
      total_coparticipations: Object.keys(coparticipationCounts).length,
      average_events_per_actor: actorIds.length > 0
        ? (eventLinks?.length || 0) / actorIds.length
        : 0,
    };

    // Key nodes (most connected actors)
    const connectionCounts: Record<string, number> = {};
    for (const link of actorLinks || []) {
      connectionCounts[link.from_actor_id] = (connectionCounts[link.from_actor_id] || 0) + 1;
      connectionCounts[link.to_actor_id] = (connectionCounts[link.to_actor_id] || 0) + 1;
    }

    const keyNodes = Object.entries(connectionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([actorId, connections]) => {
        const link = actorLinks?.find(l =>
          l.from_actor_id === actorId || l.to_actor_id === actorId
        );
        const actorData = link?.from_actor_id === actorId ? link.from_actor : link?.to_actor;
        const actor = actorData as any;

        return {
          actor_id: actorId,
          name: actor?.name || 'Unknown',
          type: actor?.actor_type || 'unknown',
          connection_count: connections,
        };
      });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            metric_type: 'network_analysis',
            period: dateRange,
            network_statistics: networkStats,
            key_nodes: keyNodes,
            top_coparticipations: topCoparticipations,
            relationship_types: this.summarizeRelationshipTypes(actorLinks || []),
          }, null, 2),
        },
      ],
    };
  }

  private summarizeRelationshipTypes(links: any[]) {
    const types: Record<string, number> = {};

    for (const link of links) {
      const type = link.relationship || 'unspecified';
      types[type] = (types[type] || 0) + 1;
    }

    return Object.entries(types)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }
}