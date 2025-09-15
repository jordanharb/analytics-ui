import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { QueryRouter } from './services/QueryRouter.js';
import { EventAnalyzer } from './services/EventAnalyzer.js';
import { ActorResolver } from './services/ActorResolver.js';
import { VectorSearch } from './services/VectorSearch.js';
import { AnalyticsEngine } from './services/AnalyticsEngine.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

// Initialize services
const queryRouter = new QueryRouter();
const eventAnalyzer = new EventAnalyzer(supabase);
const actorResolver = new ActorResolver(supabase);
const vectorSearch = new VectorSearch(supabase);
const analyticsEngine = new AnalyticsEngine(supabase);

// Create Express app
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Tool definitions (matching the MCP server)
const tools = [
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
        query: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        similarity_threshold: { type: 'number', default: 0.7 },
        filters: { type: 'object' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_actor_info',
    description: 'Get detailed information about specific actors',
    inputSchema: {
      type: 'object',
      properties: {
        actor_id: { type: 'string' },
        actor_name: { type: 'string' },
        include_relationships: { type: 'boolean' },
        include_events: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_analytics',
    description: 'Get aggregated statistics and analytics',
    inputSchema: {
      type: 'object',
      properties: {
        metric_type: {
          type: 'string',
          enum: ['event_trends', 'actor_activity', 'geographic_distribution', 'tag_frequency', 'network_analysis'],
        },
        date_range: { type: 'object' },
        grouping: { type: 'string' },
      },
      required: ['metric_type'],
    },
  },
  {
    name: 'run_sql_query',
    description: 'Execute a read-only SQL query (SELECT only)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        params: {
          type: 'array',
          items: { type: 'string' }
        },
      },
      required: ['query'],
    },
  },
];

// Tool execution logic
async function executeTool(toolName: string, args: any) {
  try {
    switch (toolName) {
      case 'query_events':
        return await eventAnalyzer.queryEvents(args.filters || {});

      case 'search_posts':
        return await vectorSearch.searchPosts(
          args.query,
          args.limit,
          args.similarity_threshold,
          args.filters
        );

      case 'get_actor_info':
        return await actorResolver.getActorInfo(args);

      case 'get_analytics':
        return await analyticsEngine.getAnalytics(args);

      case 'run_sql_query':
        // Validate it's a read-only query (allow SELECT or WITH for CTEs)
        const query = String(args.query || '').trim().toUpperCase();
        if (!query.startsWith('SELECT') && !query.startsWith('WITH')) {
          throw new Error('Only SELECT queries are allowed');
        }
        const { data, error } = await supabase.rpc('execute_readonly_query', {
          query_text: args.query,
          query_params: args.params || []
        });
        if (error) throw error;
        return data;

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error: any) {
    console.error(`Error executing tool ${toolName}:`, error);
    throw error;
  }
}

// API Routes

// List available tools
app.get('/api/mcp/tools', (req, res) => {
  res.json({ tools });
});

// Execute a tool
app.post('/api/mcp/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const args = req.body;

  try {
    const result = await executeTool(toolName, args);
    res.json({
      success: true,
      result
    });
  } catch (error: any) {
    console.error(`Tool execution error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get context/instructions
app.get('/api/mcp/context', (req, res) => {
  try {
    // Read the QUERY_CONTEXT.md file
    const contextPath = join(__dirname, '..', 'QUERY_CONTEXT.md');
    const context = readFileSync(contextPath, 'utf-8');

    // Try to append the schema to the context so models see it before crafting SQL
    let schemaText = '';
    try {
      // Schema file lives at web/analytics-ui/woke_palantir_schema.md relative to this file
      const schemaCandidatePaths = [
        join(__dirname, '..', '..', 'woke_palantir_schema.md'),
        join(__dirname, '..', 'woke_palantir_schema.md'),
      ];
      for (const p of schemaCandidatePaths) {
        try {
          schemaText = readFileSync(p, 'utf-8');
          if (schemaText) break;
        } catch {}
      }
    } catch {}

    const combined = `${context}\n\n---\nIMPORTANT: Before writing any SQL, review the database schema below and use only read-only queries (SELECT/CTE).\n\n${schemaText ? `Database Schema (for context only):\n${schemaText}` : ''}`.trim();

    res.json({
      context: combined,
      instructions: 'Use the provided tools. Always consult the schema in context before crafting SQL.'
    });
  } catch (error) {
    res.json({
      context: '',
      instructions: 'MCP tools are available for querying the database.'
    });
  }
});

// Health check
app.get('/api/mcp/health', (req, res) => {
  res.json({ status: 'healthy', server: 'mcp-http-adapter' });
});

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 5175;
  app.listen(PORT, () => {
    console.log(`MCP HTTP Adapter running on port ${PORT}`);
    console.log(`Tools available: ${tools.map(t => t.name).join(', ')}`);
  });
}

export { app, tools, executeTool };
