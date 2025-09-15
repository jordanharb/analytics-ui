# Woke Palantir MCP Server

An MCP (Model Context Protocol) server for intelligent querying and analysis of far-right extremist activity tracking data stored in PostgreSQL/Supabase.

## Overview

This MCP server provides AI assistants with direct access to query and analyze:
- Events and activities tracked in the database
- Actor networks (people, organizations, chapters)
- Social media posts and rhetoric patterns
- Geographic distributions and trends
- Network relationships and co-participation analysis

## Features

### Tools

1. **query_events** - Query events with filters for date, location, actors, tags
2. **search_posts** - Semantic search of social media posts using vector similarity
3. **get_actor_info** - Detailed information about actors and their relationships
4. **analyze_rhetoric** - Analyze rhetoric patterns around topics/events
5. **run_sql_query** - Execute read-only SQL queries
6. **get_analytics** - Aggregated statistics and trend analysis

### Prompts

Pre-configured prompts for common queries:
- `schools_targeted` - Find schools targeted by groups
- `actor_network` - Analyze networks around specific actors
- `rhetoric_analysis` - Analyze rhetoric around events/topics

### Resources

Schema documentation for:
- Events table structure
- Actors table structure
- Social media posts structure
- Available analytics functions

## Installation

1. Install dependencies:
```bash
cd web/analytics-ui/mcp-server
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your Supabase and OpenAI credentials
```

3. Build the server:
```bash
npm run build
```

4. Deploy SQL functions to Supabase:
```bash
# Run the SQL in sql/vector_search_functions.sql in your Supabase SQL editor
```

## Configuration

### For Claude Desktop

1. Open Claude Desktop settings
2. Go to Developer -> Edit Config
3. Add this configuration:

```json
{
  "mcpServers": {
    "woke-palantir": {
      "command": "node",
      "args": [
        "/path/to/tpusa-social-monitoring/web/analytics-ui/mcp-server/dist/index.js"
      ],
      "env": {
        "SUPABASE_URL": "your_supabase_url",
        "SUPABASE_SERVICE_KEY": "your_service_key",
        "OPENAI_API_KEY": "your_openai_key"
      }
    }
  }
}
```

### For Other MCP Clients

Use the provided `claude_mcp_config.json` as a template and adapt to your client's configuration format.

## Usage Examples

### Finding Targeted Schools

```
"What schools have been targeted by far-right groups in the last 2 months?"
```

The server will:
1. Parse the query to extract time range and tags
2. Query events with School/Education tags
3. Return detailed information about each event

### Analyzing Actor Networks

```
"Show me the network around Charlie Kirk and TPUSA"
```

The server will:
1. Find the actor IDs for Charlie Kirk and TPUSA
2. Query their relationships and event participation
3. Return network visualization data

### Rhetoric Analysis

```
"Analyze the rhetoric about 'woke ideology' since September"
```

The server will:
1. Search posts mentioning the topic
2. Extract themes and sentiment
3. Track narrative evolution over time

### Complex Queries

```
"Which TPUSA employees have been most active in Arizona elections, and what's their messaging?"
```

The server will:
1. Identify TPUSA-affiliated actors
2. Find election-related events in Arizona
3. Analyze associated social media posts
4. Synthesize rhetoric patterns

## Database Schema

The server works with the following main tables:

- `v2_events` - Tracked events and activities
- `v2_actors` - People, organizations, and chapters
- `v2_social_media_posts` - Social media content
- `v2_event_actor_links` - Links between events and actors
- `v2_actor_links` - Relationships between actors
- `dynamic_slugs` - Dynamic categorization system
- `category_tags` - Event categorization tags

## Vector Search Setup

For semantic search capabilities, you need to:

1. Enable pgvector extension in Supabase
2. Create embeddings for posts and events
3. Deploy the vector search functions from `sql/vector_search_functions.sql`

### Generating Embeddings

Use the provided Python script to generate embeddings:

```python
# See scripts/generate_embeddings.py
python generate_embeddings.py
```

## Security

- All database queries are read-only
- SQL injection protection via parameterized queries
- Service key should be kept secure and not exposed to clients
- Rate limiting should be configured in production

## Development

Run in development mode with hot reload:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

## Troubleshooting

### Vector Search Not Working

If vector search functions return errors:
1. Ensure pgvector extension is enabled
2. Check that embeddings have been generated
3. Verify the embedding dimension matches your model (1536 for text-embedding-3-small)

### Connection Issues

If the MCP server won't connect:
1. Verify Supabase URL and keys are correct
2. Check network connectivity
3. Ensure the server process has necessary permissions

### Query Errors

For query errors:
1. Check the server logs for detailed error messages
2. Verify table and column names match your schema
3. Ensure required SQL functions are deployed

## Contributing

1. Follow the existing code structure
2. Add tests for new features
3. Update documentation
4. Ensure all queries remain read-only

## License

[Your License Here]