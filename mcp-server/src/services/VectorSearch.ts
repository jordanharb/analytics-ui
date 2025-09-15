import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { config } from '../config.js';

export class VectorSearch {
  private openai: OpenAI;

  constructor(private supabase: SupabaseClient) {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  async searchPosts(
    query: string,
    filters: any = {},
    limit: number = 50,
    similarityThreshold: number = 0.7
  ) {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Build the RPC call for vector similarity search
      // Note: This assumes you have a function for vector search in Supabase
      const { data, error } = await this.supabase.rpc('search_posts_by_embedding', {
        query_embedding: queryEmbedding,
        similarity_threshold: similarityThreshold,
        match_limit: limit,
        filter_platform: filters.platform || null,
        filter_start_date: filters.date_range?.start_date || null,
        filter_end_date: filters.date_range?.end_date || null,
        filter_author_handles: filters.author_handles || null,
      });

      if (error) {
        // Fallback to text search if vector search is not available
        return this.fallbackTextSearch(query, filters, limit);
      }

      // Format results
      const results = data?.map((post: any) => ({
        id: post.id,
        platform: post.platform,
        author: {
          handle: post.author_handle,
          name: post.author_name,
        },
        content: post.content_text,
        timestamp: post.post_timestamp,
        similarity_score: post.similarity,
        engagement: {
          likes: post.like_count,
          replies: post.reply_count,
          shares: post.share_count,
        },
        url: post.post_url,
        linked_actor: post.linked_actor_id ? {
          id: post.linked_actor_id,
          type: post.linked_actor_type,
        } : null,
      })) || [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query,
              total_results: results.length,
              similarity_threshold: similarityThreshold,
              filters_applied: filters,
              posts: results,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search posts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: config.openai.embeddingModel,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async fallbackTextSearch(query: string, filters: any, limit: number) {
    // Fallback to text search using ILIKE
    let searchQuery = this.supabase
      .from('v2_social_media_posts')
      .select(`
        *,
        v2_actors!linked_actor_id(
          id,
          name,
          actor_type
        )
      `)
      .ilike('content_text', `%${query}%`);

    // Apply filters
    if (filters.platform) {
      searchQuery = searchQuery.eq('platform', filters.platform);
    }

    if (filters.date_range) {
      if (filters.date_range.start_date) {
        searchQuery = searchQuery.gte('post_timestamp', filters.date_range.start_date);
      }
      if (filters.date_range.end_date) {
        searchQuery = searchQuery.lte('post_timestamp', filters.date_range.end_date);
      }
    }

    if (filters.author_handles?.length) {
      searchQuery = searchQuery.in('author_handle', filters.author_handles);
    }

    searchQuery = searchQuery.order('post_timestamp', { ascending: false }).limit(limit);

    const { data, error } = await searchQuery;

    if (error) throw error;

    const results = data?.map((post: any) => ({
      id: post.id,
      platform: post.platform,
      author: {
        handle: post.author_handle,
        name: post.author_name,
      },
      content: post.content_text,
      timestamp: post.post_timestamp,
      similarity_score: null, // No similarity score for text search
      engagement: {
        likes: post.like_count,
        replies: post.reply_count,
        shares: post.share_count,
      },
      url: post.post_url,
      linked_actor: post.v2_actors ? {
        id: post.v2_actors.id,
        name: post.v2_actors.name,
        type: post.v2_actors.actor_type,
      } : null,
    })) || [];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            search_type: 'text_search',
            total_results: results.length,
            filters_applied: filters,
            posts: results,
          }, null, 2),
        },
      ],
    };
  }

  async searchEvents(
    query: string,
    filters: any = {},
    limit: number = 50,
    similarityThreshold: number = 0.7
  ) {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Search events by embedding
      const { data, error } = await this.supabase.rpc('search_events_by_embedding', {
        query_embedding: queryEmbedding,
        similarity_threshold: similarityThreshold,
        match_limit: limit,
        filter_start_date: filters.date_range?.start_date || null,
        filter_end_date: filters.date_range?.end_date || null,
        filter_states: filters.states || null,
        filter_tags: filters.tags || null,
      });

      if (error) {
        // Fallback to text search
        return this.fallbackEventTextSearch(query, filters, limit);
      }

      const results = data?.map((event: any) => ({
        id: event.id,
        name: event.event_name,
        date: event.event_date,
        location: {
          venue: event.location,
          city: event.city,
          state: event.state,
        },
        description: event.event_description,
        similarity_score: event.similarity,
        tags: event.category_tags || [],
        confidence: event.confidence_score,
      })) || [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query,
              total_results: results.length,
              similarity_threshold: similarityThreshold,
              filters_applied: filters,
              events: results,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search events: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async fallbackEventTextSearch(query: string, filters: any, limit: number) {
    let searchQuery = this.supabase
      .from('v2_events')
      .select('*')
      .or(`event_name.ilike.%${query}%,event_description.ilike.%${query}%`);

    // Apply filters
    if (filters.date_range) {
      if (filters.date_range.start_date) {
        searchQuery = searchQuery.gte('event_date', filters.date_range.start_date);
      }
      if (filters.date_range.end_date) {
        searchQuery = searchQuery.lte('event_date', filters.date_range.end_date);
      }
    }

    if (filters.states?.length) {
      searchQuery = searchQuery.in('state', filters.states);
    }

    if (filters.tags?.length) {
      for (const tag of filters.tags) {
        searchQuery = searchQuery.contains('category_tags', [tag]);
      }
    }

    searchQuery = searchQuery.order('event_date', { ascending: false }).limit(limit);

    const { data, error } = await searchQuery;

    if (error) throw error;

    const results = data?.map((event: any) => ({
      id: event.id,
      name: event.event_name,
      date: event.event_date,
      location: {
        venue: event.location,
        city: event.city,
        state: event.state,
      },
      description: event.event_description,
      tags: event.category_tags || [],
      confidence: event.confidence_score,
    })) || [];

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            search_type: 'text_search',
            total_results: results.length,
            filters_applied: filters,
            events: results,
          }, null, 2),
        },
      ],
    };
  }

  async findSimilarContent(contentId: string, contentType: 'post' | 'event', limit: number = 20) {
    try {
      // Get the content and its embedding
      const table = contentType === 'post' ? 'v2_social_media_posts' : 'v2_events';
      const { data: content, error } = await this.supabase
        .from(table)
        .select('*')
        .eq('id', contentId)
        .single();

      if (error || !content) {
        throw new Error('Content not found');
      }

      // If content has embedding, use it for similarity search
      if (content.embedding) {
        const { data: similar } = await this.supabase.rpc(
          contentType === 'post' ? 'find_similar_posts' : 'find_similar_events',
          {
            target_id: contentId,
            match_limit: limit,
          }
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                source_content: {
                  id: content.id,
                  type: contentType,
                  title: contentType === 'post' ? content.content_text?.substring(0, 100) : content.event_name,
                },
                similar_content: similar || [],
              }, null, 2),
            },
          ],
        };
      }

      // Fallback to keyword-based similarity
      const keywords = contentType === 'post'
        ? this.extractKeywords(content.content_text || '')
        : this.extractKeywords(`${content.event_name} ${content.event_description}`);

      const searchQuery = keywords.join(' ');
      return contentType === 'post'
        ? this.searchPosts(searchQuery, {}, limit, 0.5)
        : this.searchEvents(searchQuery, {}, limit, 0.5);
    } catch (error) {
      throw new Error(`Failed to find similar content: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
      'in', 'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this',
      'it', 'from', 'be', 'are', 'was', 'were', 'been',
    ]);

    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));

    // Count word frequency
    const wordFreq: Record<string, number> = {};
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }

    // Return top keywords
    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }
}