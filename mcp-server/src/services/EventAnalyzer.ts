import { SupabaseClient } from '@supabase/supabase-js';

export class EventAnalyzer {
  constructor(private supabase: SupabaseClient) {}

  async queryEvents(filters: any) {
    try {
      let query = this.supabase
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
        `);

      // Apply filters
      if (filters.date_range) {
        if (filters.date_range.start_date) {
          query = query.gte('event_date', filters.date_range.start_date);
        }
        if (filters.date_range.end_date) {
          query = query.lte('event_date', filters.date_range.end_date);
        }
      }

      if (filters.states?.length) {
        query = query.in('state', filters.states);
      }

      if (filters.cities?.length) {
        query = query.in('city', filters.cities);
      }

      if (filters.confidence_threshold) {
        query = query.gte('confidence_score', filters.confidence_threshold);
      }

      // Handle tag filtering using Supabase's OR operator
      if (filters.tags?.length) {
        // Create OR conditions for each tag using PostgREST syntax
        // cs operator checks if JSONB array contains the value
        // Format: category_tags.cs.["value"] for JSONB arrays
        const orConditions = filters.tags
          .map((tag: string) => `category_tags.cs.[${JSON.stringify(tag)}]`)
          .join(',');

        query = query.or(orConditions);
      }

      // Limit results
      query = query.limit(filters.limit || 100);

      // Order by date
      query = query.order('event_date', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;

      // If no results and tag filtering was used, fetch available tags to suggest
      let suggestions = null;
      if ((!data || data.length === 0) && filters.tags?.length) {
        try {
          const { data: filterOptions } = await this.supabase.rpc('get_filter_options_optimized');

          if (filterOptions?.slugs_by_parent) {
            const availableTags: string[] = [];
            Object.values(filterOptions.slugs_by_parent).forEach((tags: any) => {
              tags.forEach((t: any) => {
                if (t.slug) availableTags.push(t.slug);
              });
            });

            // Find similar tags
            const suggestedTags = filters.tags.map((requestedTag: string) => {
              const similar = availableTags.filter(tag =>
                tag.toLowerCase().includes(requestedTag.toLowerCase()) ||
                requestedTag.toLowerCase().includes(tag.toLowerCase())
              );
              return { requested: requestedTag, similar };
            });

            suggestions = {
              message: `No events found with tags: ${filters.tags.join(', ')}`,
              available_tags_sample: availableTags.slice(0, 20).sort(),
              suggestions: suggestedTags,
              hint: 'Use get_filter_options tool to see all available tags and filter options'
            };
          }
        } catch (err) {
          // Ignore errors in getting suggestions
        }
      }

      // Process and format results
      const events = data?.map(event => ({
        id: event.id,
        name: event.event_name,
        date: event.event_date,
        location: {
          venue: event.location,
          city: event.city,
          state: event.state,
          coordinates: {
            latitude: event.latitude,
            longitude: event.longitude,
          },
        },
        description: event.event_description,
        tags: event.category_tags || [],
        confidence_score: event.confidence_score,
        verified: event.verified,
        actors: event.v2_event_actor_links?.map((link: any) => ({
          id: link.actor_id,
          handle: link.actor_handle,
          type: link.actor_type,
          platform: link.platform,
        })) || [],
        posts: event.v2_event_post_links?.map((link: any) => ({
          id: link.v2_social_media_posts?.id,
          platform: link.v2_social_media_posts?.platform,
          content: link.v2_social_media_posts?.content_text,
          timestamp: link.v2_social_media_posts?.post_timestamp,
          author: link.v2_social_media_posts?.author_handle,
        })) || [],
      })) || [];

      const response: any = {
        total_count: events.length,
        events: events,
        filters_applied: filters,
      };

      // Add suggestions if available
      if (suggestions) {
        response.suggestions = suggestions;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to query events: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async analyzeRhetoric(params: any) {
    try {
      const { topic, date_range, actor_filters, analysis_type } = params;

      // First, get relevant posts
      let postsQuery = this.supabase
        .from('v2_social_media_posts')
        .select(`
          *,
          v2_actors!linked_actor_id(
            id,
            name,
            actor_type,
            data
          )
        `);

      // Apply date range
      if (date_range) {
        if (date_range.start_date) {
          postsQuery = postsQuery.gte('post_timestamp', date_range.start_date);
        }
        if (date_range.end_date) {
          postsQuery = postsQuery.lte('post_timestamp', date_range.end_date);
        }
      }

      // Filter by actors if specified
      if (actor_filters?.organizations?.length) {
        // Get actor IDs for organizations
        const { data: actors } = await this.supabase
          .from('v2_actors')
          .select('id')
          .in('name', actor_filters.organizations)
          .eq('actor_type', 'organization');

        if (actors?.length) {
          const actorIds = actors.map(a => a.id);
          postsQuery = postsQuery.in('linked_actor_id', actorIds);
        }
      }

      // Get posts
      const { data: posts, error } = await postsQuery.limit(500);

      if (error) throw error;

      // Filter posts by topic relevance (simple keyword matching for now)
      const relevantPosts = posts?.filter(post =>
        post.content_text?.toLowerCase().includes(topic.toLowerCase())
      ) || [];

      // Analyze based on type
      let analysis: any = {
        topic,
        period: date_range,
        total_posts: relevantPosts.length,
        posts_analyzed: relevantPosts.length,
      };

      switch (analysis_type) {
        case 'themes':
          analysis.themes = this.extractThemes(relevantPosts);
          break;

        case 'sentiment':
          analysis.sentiment = this.analyzeSentiment(relevantPosts);
          break;

        case 'talking_points':
          analysis.talking_points = this.extractTalkingPoints(relevantPosts);
          break;

        case 'narrative_evolution':
          analysis.narrative_evolution = this.analyzeNarrativeEvolution(relevantPosts);
          break;

        default:
          analysis.themes = this.extractThemes(relevantPosts);
      }

      // Add sample posts
      analysis.sample_posts = relevantPosts.slice(0, 5).map(post => ({
        id: post.id,
        platform: post.platform,
        author: post.author_handle,
        date: post.post_timestamp,
        content: post.content_text?.substring(0, 500),
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to analyze rhetoric: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private extractThemes(posts: any[]): any[] {
    // Simple theme extraction based on keyword frequency
    const themeKeywords: Record<string, string[]> = {
      'Election Integrity': ['election', 'ballot', 'vote', 'fraud', 'integrity'],
      'Education': ['school', 'education', 'teacher', 'student', 'campus'],
      'Immigration': ['border', 'immigration', 'illegal', 'migrant', 'wall'],
      'Free Speech': ['censorship', 'free speech', 'cancel', 'woke', 'silence'],
      'Traditional Values': ['family', 'values', 'traditional', 'christian', 'faith'],
      'Government Overreach': ['freedom', 'tyranny', 'mandate', 'constitution', 'rights'],
    };

    const themeCounts: Record<string, number> = {};

    for (const post of posts) {
      const content = (post.content_text || '').toLowerCase();

      for (const [theme, keywords] of Object.entries(themeKeywords)) {
        for (const keyword of keywords) {
          if (content.includes(keyword)) {
            themeCounts[theme] = (themeCounts[theme] || 0) + 1;
            break;
          }
        }
      }
    }

    return Object.entries(themeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([theme, count]) => ({
        theme,
        post_count: count,
        percentage: ((count / posts.length) * 100).toFixed(1) + '%',
      }));
  }

  private analyzeSentiment(posts: any[]): any {
    // Simple sentiment analysis based on keywords
    const sentimentKeywords = {
      positive: ['great', 'amazing', 'excellent', 'success', 'win', 'victory', 'proud', 'patriot'],
      negative: ['terrible', 'awful', 'disaster', 'fail', 'destroy', 'corrupt', 'evil', 'threat'],
      neutral: ['report', 'announce', 'state', 'say', 'inform', 'update'],
    };

    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };

    for (const post of posts) {
      const content = (post.content_text || '').toLowerCase();
      let sentiment = 'neutral';
      let maxScore = 0;

      for (const [sent, keywords] of Object.entries(sentimentKeywords)) {
        const score = keywords.filter(k => content.includes(k)).length;
        if (score > maxScore) {
          maxScore = score;
          sentiment = sent;
        }
      }

      sentimentCounts[sentiment as keyof typeof sentimentCounts]++;
    }

    return {
      distribution: sentimentCounts,
      percentages: {
        positive: ((sentimentCounts.positive / posts.length) * 100).toFixed(1) + '%',
        negative: ((sentimentCounts.negative / posts.length) * 100).toFixed(1) + '%',
        neutral: ((sentimentCounts.neutral / posts.length) * 100).toFixed(1) + '%',
      },
    };
  }

  private extractTalkingPoints(posts: any[]): string[] {
    // Extract common phrases and talking points
    const phrases: Record<string, number> = {};

    for (const post of posts) {
      const content = post.content_text || '';

      // Extract 3-5 word phrases
      const words = content.toLowerCase().split(/\s+/);
      for (let i = 0; i < words.length - 2; i++) {
        const phrase = words.slice(i, i + 3).join(' ');
        if (phrase.length > 10 && !phrase.includes('http')) {
          phrases[phrase] = (phrases[phrase] || 0) + 1;
        }
      }
    }

    // Return top phrases
    return Object.entries(phrases)
      .filter(([_, count]) => count > 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => `"${phrase}" (mentioned ${count} times)`);
  }

  private analyzeNarrativeEvolution(posts: any[]): any {
    // Sort posts by date
    const sortedPosts = posts.sort((a, b) =>
      new Date(a.post_timestamp).getTime() - new Date(b.post_timestamp).getTime()
    );

    // Divide into time periods
    if (sortedPosts.length === 0) return { periods: [] };

    const firstDate = new Date(sortedPosts[0].post_timestamp);
    const lastDate = new Date(sortedPosts[sortedPosts.length - 1].post_timestamp);
    const totalDays = Math.ceil((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));

    const periods = [];
    const periodLength = Math.max(1, Math.floor(totalDays / 4)); // Divide into 4 periods

    for (let i = 0; i < 4; i++) {
      const periodStart = new Date(firstDate);
      periodStart.setDate(periodStart.getDate() + (i * periodLength));

      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + periodLength);

      const periodPosts = sortedPosts.filter(post => {
        const postDate = new Date(post.post_timestamp);
        return postDate >= periodStart && postDate < periodEnd;
      });

      if (periodPosts.length > 0) {
        periods.push({
          period: `${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`,
          post_count: periodPosts.length,
          themes: this.extractThemes(periodPosts).slice(0, 3),
        });
      }
    }

    return { periods };
  }
}