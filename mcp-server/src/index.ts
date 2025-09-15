import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { QueryRouter } from './services/QueryRouter.js';
import { EventAnalyzer } from './services/EventAnalyzer.js';
import { ActorResolver } from './services/ActorResolver.js';
import { VectorSearch } from './services/VectorSearch.js';
import { AnalyticsEngine } from './services/AnalyticsEngine.js';

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

// Initialize services
const queryRouter = new QueryRouter();
const eventAnalyzer = new EventAnalyzer(supabase);
const actorResolver = new ActorResolver(supabase);
const vectorSearch = new VectorSearch(supabase);
const analyticsEngine = new AnalyticsEngine(supabase);

// Create MCP server
const server = new Server(
  {
    name: 'woke-palantir-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query_events',
        description: 'Query events with filters for date, location, actors, tags, and more',
        inputSchema: {
          type: 'object',
          properties: {
            filters: {
              type: 'object',
              properties: {
                date_range: {
                  type: 'object',
                  properties: {
                    start_date: { type: 'string', format: 'date' },
                    end_date: { type: 'string', format: 'date' },
                  },
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Category tags to filter by (e.g., "School", "Election")',
                },
                actors: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Actor IDs or names to filter by',
                },
                states: {
                  type: 'array',
                  items: { type: 'string' },
                },
                cities: {
                  type: 'array',
                  items: { type: 'string' },
                },
                confidence_threshold: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1,
                },
                limit: {
                  type: 'integer',
                  default: 100,
                },
              },
            },
          },
          required: [],
        },
      },
      {
        name: 'search_posts',
        description: 'Search social media posts using vector similarity',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for semantic similarity',
            },
            filters: {
              type: 'object',
              properties: {
                platform: {
                  type: 'string',
                  enum: ['twitter', 'instagram', 'facebook', 'truth_social', 'telegram'],
                },
                date_range: {
                  type: 'object',
                  properties: {
                    start_date: { type: 'string', format: 'date' },
                    end_date: { type: 'string', format: 'date' },
                  },
                },
                author_handles: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            limit: {
              type: 'integer',
              default: 50,
            },
            similarity_threshold: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 0.7,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_actor_info',
        description: 'Get detailed information about actors (people, organizations, chapters)',
        inputSchema: {
          type: 'object',
          properties: {
            actor_id: {
              type: 'string',
              description: 'UUID of the actor',
            },
            actor_name: {
              type: 'string',
              description: 'Name of the actor (alternative to ID)',
            },
            actor_type: {
              type: 'string',
              enum: ['person', 'organization', 'chapter'],
            },
            include_events: {
              type: 'boolean',
              default: false,
            },
            include_posts: {
              type: 'boolean',
              default: false,
            },
            include_relationships: {
              type: 'boolean',
              default: true,
            },
          },
          required: [],
        },
      },
      {
        name: 'analyze_rhetoric',
        description: 'Analyze rhetoric patterns in posts related to specific topics or events',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Topic to analyze rhetoric about',
            },
            date_range: {
              type: 'object',
              properties: {
                start_date: { type: 'string', format: 'date' },
                end_date: { type: 'string', format: 'date' },
              },
            },
            actor_filters: {
              type: 'object',
              properties: {
                organizations: {
                  type: 'array',
                  items: { type: 'string' },
                },
                actor_types: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
            analysis_type: {
              type: 'string',
              enum: ['sentiment', 'themes', 'talking_points', 'narrative_evolution'],
              default: 'themes',
            },
          },
          required: ['topic'],
        },
      },
      {
        name: 'run_sql_query',
        description: 'Execute a read-only SQL query on the database',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL query to execute (SELECT only)',
            },
            parameters: {
              type: 'array',
              items: { type: 'any' },
              description: 'Query parameters for prepared statements',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_filter_options',
        description: 'Get available filter options including valid tags, states, cities, and actors',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_schools_involved',
        description: 'Get list of schools/educational institutions involved in events. Returns both events and unique school list.',
        inputSchema: {
          type: 'object',
          properties: {
            date_range: {
              type: 'object',
              properties: {
                start_date: { type: 'string', format: 'date' },
                end_date: { type: 'string', format: 'date' },
              },
            },
            include_events: {
              type: 'boolean',
              default: false,
              description: 'Include the actual events in addition to school list',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_analytics',
        description: 'Get analytics and aggregated statistics',
        inputSchema: {
          type: 'object',
          properties: {
            metric_type: {
              type: 'string',
              enum: [
                'event_trends',
                'actor_activity',
                'geographic_distribution',
                'tag_frequency',
                'network_analysis',
              ],
            },
            date_range: {
              type: 'object',
              properties: {
                start_date: { type: 'string', format: 'date' },
                end_date: { type: 'string', format: 'date' },
              },
            },
            grouping: {
              type: 'string',
              enum: ['day', 'week', 'month', 'state', 'organization', 'tag'],
            },
            filters: {
              type: 'object',
              properties: {
                states: { type: 'array', items: { type: 'string' } },
                tags: { type: 'array', items: { type: 'string' } },
                organizations: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['metric_type'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'query_events':
        return await eventAnalyzer.queryEvents(args?.filters || {});

      case 'search_posts':
        if (!args?.query) {
          throw new Error('Query parameter is required for search_posts');
        }
        return await vectorSearch.searchPosts(
          String(args.query),
          args.filters || {},
          Number(args.limit) || 50,
          Number(args.similarity_threshold) || 0.7
        );

      case 'get_actor_info':
        return await actorResolver.getActorInfo(args || {});

      case 'analyze_rhetoric':
        if (!args?.topic) {
          throw new Error('Topic parameter is required for analyze_rhetoric');
        }
        return await eventAnalyzer.analyzeRhetoric(args);

      case 'run_sql_query':
        if (!args?.query) {
          throw new Error('Query parameter is required for run_sql_query');
        }

        // Validate query is read-only
        const query = String(args.query).trim().toUpperCase();
        if (!query.startsWith('SELECT') && !query.startsWith('WITH')) {
          throw new Error('Only SELECT queries are allowed');
        }

        const { data, error } = await supabase.rpc('execute_readonly_query', {
          query_text: String(args.query),
          query_params: args.parameters || [],
        });

        if (error) throw error;
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };

      case 'get_schools_involved':
        // Get all education-related events
        const educationTags = ['Education', 'College', 'High School', 'Homeschool', 'School Board'];

        let schoolQuery = supabase
          .from('v2_events')
          .select('*');

        // Apply date range if provided
        const dateRange = args?.date_range as any;
        if (dateRange?.start_date) {
          schoolQuery = schoolQuery.gte('event_date', dateRange.start_date);
        }
        if (dateRange?.end_date) {
          schoolQuery = schoolQuery.lte('event_date', dateRange.end_date);
        }

        // Use OR to find events with ANY education-related tag
        const eduOrConditions = educationTags
          .map((tag: string) => `category_tags.cs.[${JSON.stringify(tag)}]`)
          .join(',');

        schoolQuery = schoolQuery.or(eduOrConditions);
        schoolQuery = schoolQuery.order('event_date', { ascending: false });
        schoolQuery = schoolQuery.limit(500); // Get more events to extract schools from

        const { data: schoolEvents, error: eventsError } = await schoolQuery;

        if (eventsError) throw eventsError;

        // Extract all unique School: tags
        const schoolTags = new Set<string>();
        const schoolDetails: Record<string, any> = {};

        schoolEvents?.forEach((event: any) => {
          const tags = event.category_tags || [];
          tags.forEach((tag: string) => {
            if (tag.startsWith('School:')) {
              schoolTags.add(tag);
              if (!schoolDetails[tag]) {
                schoolDetails[tag] = {
                  tag: tag,
                  name: tag.replace('School:', '').replace(/_/g, ' '),
                  events: [],
                  event_count: 0,
                  states: new Set(),
                };
              }
              schoolDetails[tag].events.push({
                id: event.id,
                name: event.event_name,
                date: event.event_date,
              });
              schoolDetails[tag].event_count++;
              if (event.state) schoolDetails[tag].states.add(event.state);
            }
          });
        });

        // Also get all schools from dynamic_slugs table
        const { data: allSchools } = await supabase
          .from('dynamic_slugs')
          .select('full_slug, label, description')
          .eq('parent_tag', 'School');

        // Format response
        const schoolsFromEvents = Array.from(schoolTags).map(tag => ({
          ...schoolDetails[tag],
          states: Array.from(schoolDetails[tag].states),
          events: args?.include_events ? schoolDetails[tag].events : undefined,
        })).sort((a: any, b: any) => b.event_count - a.event_count);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              summary: {
                total_education_events: schoolEvents?.length || 0,
                unique_schools_in_events: schoolTags.size,
                total_schools_in_database: allSchools?.length || 0,
                date_range: args?.date_range || 'all time',
              },
              schools_with_events: schoolsFromEvents,
              events: args?.include_events ? schoolEvents : undefined,
              all_known_schools: allSchools?.map((s: any) => ({
                tag: s.full_slug,
                name: s.label,
                description: s.description,
              })),
              note: 'Some education events may not have specific School: tags. Check events array for details.',
            }, null, 2)
          }]
        };

      case 'get_filter_options':
        // Call the Supabase RPC function to get filter options
        const { data: filterOptions, error: filterError } = await supabase.rpc('get_filter_options_optimized');

        if (filterError) throw filterError;

        // Format the response to make tags more accessible
        const allTags: string[] = [];
        const tagsByCategory: Record<string, string[]> = {};

        if (filterOptions?.slugs_by_parent) {
          Object.entries(filterOptions.slugs_by_parent).forEach(([parent, tags]: [string, any]) => {
            const tagList = tags.map((t: any) => t.slug || t.label);
            tagsByCategory[parent] = tagList;
            allTags.push(...tagList);
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              available_tags: [...new Set(allTags)].sort(),
              tags_by_category: tagsByCategory,
              raw_filter_options: filterOptions
            }, null, 2)
          }]
        };

      case 'get_analytics':
        if (!args?.metric_type) {
          throw new Error('metric_type parameter is required for get_analytics');
        }
        return await analyticsEngine.getAnalytics(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
    };
  }
});

// Define prompts for common queries
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: 'schools_targeted',
        description: 'Find schools targeted by far-right groups',
        arguments: [
          {
            name: 'months_back',
            description: 'Number of months to look back',
            required: false,
          },
        ],
      },
      {
        name: 'actor_network',
        description: 'Analyze the network around a specific actor',
        arguments: [
          {
            name: 'actor_name',
            description: 'Name of the actor to analyze',
            required: true,
          },
        ],
      },
      {
        name: 'rhetoric_analysis',
        description: 'Analyze rhetoric around a specific event or topic',
        arguments: [
          {
            name: 'topic',
            description: 'Topic or event to analyze',
            required: true,
          },
          {
            name: 'date',
            description: 'Date or date range',
            required: false,
          },
        ],
      },
    ],
  };
});

// Handle prompt requests
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'schools_targeted':
      const monthsBack = Number(args?.months_back) || 2;
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Find all events at schools or educational institutions in the last ${monthsBack} months. Include the school names, locations, dates, and what groups were involved.`,
            },
          },
        ],
      };

    case 'actor_network':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze the network and activities of ${args?.actor_name}. Include their organizational affiliations, events they've participated in, social media presence, and connections to other actors.`,
            },
          },
        ],
      };

    case 'rhetoric_analysis':
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze the rhetoric surrounding "${args?.topic}"${args?.date ? ` around ${args.date}` : ''}. Look for patterns in messaging, key talking points, and how the narrative has evolved.`,
            },
          },
        ],
      };

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
});

// Define resources (database schemas and documentation)
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'context://query_guide',
        name: 'Query Context & Tag System Guide',
        description: 'IMPORTANT: Read this first! Comprehensive guide on how to query the database effectively, understand the tag system, and find schools/institutions',
        mimeType: 'text/markdown',
      },
      {
        uri: 'schema://events',
        name: 'Events Schema',
        description: 'Schema for v2_events table tracking far-right activities',
        mimeType: 'application/json',
      },
      {
        uri: 'schema://actors',
        name: 'Actors Schema',
        description: 'Schema for v2_actors table (people, organizations, chapters)',
        mimeType: 'application/json',
      },
      {
        uri: 'schema://posts',
        name: 'Social Media Posts Schema',
        description: 'Schema for v2_social_media_posts table',
        mimeType: 'application/json',
      },
      {
        uri: 'schema://dynamic_slugs',
        name: 'Dynamic Slugs Schema',
        description: 'Schema for dynamic_slugs table containing specific institutions (School:, Church:, etc.)',
        mimeType: 'application/json',
      },
      {
        uri: 'functions://analytics',
        name: 'Available Analytics Functions',
        description: 'List of Supabase RPC functions for analytics',
        mimeType: 'application/json',
      },
    ],
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Handle context document
  if (uri === 'context://query_guide') {
    const fs = await import('fs/promises');
    const path = await import('path');
    try {
      const contextPath = path.join(process.cwd(), 'QUERY_CONTEXT.md');
      const content = await fs.readFile(contextPath, 'utf-8');
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: '# Query Context Guide\n\nContext document not found. Please ensure QUERY_CONTEXT.md exists in the MCP server directory.',
          },
        ],
      };
    }
  }

  const resources: Record<string, any> = {
    'schema://events': {
      table: 'v2_events',
      columns: {
        id: 'UUID primary key',
        event_name: 'Name of the event',
        event_date: 'Date of the event',
        location: 'Venue or location description',
        city: 'City name',
        state: 'State abbreviation',
        category_tags: 'JSONB array of category tags (includes both category tags and dynamic slugs)',
        confidence_score: 'Confidence score 0-1',
        verified: 'Boolean verification status',
        latitude: 'Decimal latitude',
        longitude: 'Decimal longitude',
        event_description: 'Full text description',
      },
      important_notes: [
        'category_tags contains BOTH standard tags (Education, College) AND dynamic slugs (School:AZ_ASU)',
        'Use multiple education tags when searching for school events: Education, College, High School',
        'School: prefixed tags are dynamic slugs for specific institutions',
      ],
    },
    'schema://actors': {
      table: 'v2_actors',
      columns: {
        id: 'UUID primary key',
        actor_type: 'person, organization, or chapter',
        name: 'Actor name',
        city: 'City location',
        state: 'State location',
        about: 'Description text',
        x_profile_data: 'Twitter/X profile JSON',
        instagram_profile_data: 'Instagram profile JSON',
        should_scrape: 'Boolean for scraping status',
      },
    },
    'schema://posts': {
      table: 'v2_social_media_posts',
      columns: {
        id: 'UUID primary key',
        post_id: 'Platform-specific post ID',
        platform: 'Social media platform',
        content_text: 'Post content',
        post_timestamp: 'When posted',
        author_handle: 'Author username',
        linked_actor_id: 'FK to v2_actors',
        embedding: 'Vector embedding for similarity search',
      },
    },
    'schema://dynamic_slugs': {
      table: 'dynamic_slugs',
      columns: {
        id: 'UUID primary key',
        parent_tag: 'Parent category (School, Church, Conference, BallotMeasure, etc.)',
        full_slug: 'Complete slug like School:AZ_Arizona_State_University',
        label: 'Human-readable label',
        description: 'Description of the entity',
        metadata: 'JSONB additional data',
      },
      usage_notes: [
        'Query parent_tag = "School" to get all schools',
        'full_slug appears in event category_tags arrays',
        'Use this table to get comprehensive lists of institutions',
      ],
    },
    'functions://analytics': {
      functions: [
        'get_filter_options_optimized',
        'get_map_points',
        'analytics_city_events_keyset',
      ],
    },
  };

  const resource = resources[uri];
  if (!resource) {
    throw new Error(`Resource not found: ${uri}`);
  }

  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(resource, null, 2),
      },
    ],
  };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Woke Palantir MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});