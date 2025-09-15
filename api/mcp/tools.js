export default function handler(req, res) {
  const tools = [
    {
      name: 'query_events',
      description: 'Query far-right extremist events with filters for date, location, actors, tags',
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
                description: 'Category tags like "School", "Election", "Protest"',
              },
              actors: {
                type: 'array',
                items: { type: 'string' },
                description: 'Actor names like "Charlie Kirk", "TPUSA"',
              },
              states: {
                type: 'array',
                items: { type: 'string' },
              },
              cities: {
                type: 'array',
                items: { type: 'string' },
              },
              limit: {
                type: 'integer',
                default: 100,
              },
            },
          },
        },
      },
    },
    {
      name: 'search_posts',
      description: 'Search social media posts about far-right activities',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          platform: {
            type: 'string',
            enum: ['twitter', 'facebook', 'instagram', 'truthsocial', 'all'],
            default: 'all',
          },
          limit: {
            type: 'integer',
            default: 50,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'analyze_trends',
      description: 'Analyze trends in far-right extremist activities',
      inputSchema: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['event_count', 'actor_activity', 'geographic_spread'],
          },
          group_by: {
            type: 'string',
            enum: ['day', 'week', 'month', 'state', 'actor'],
          },
          date_range: {
            type: 'object',
            properties: {
              start_date: { type: 'string', format: 'date' },
              end_date: { type: 'string', format: 'date' },
            },
          },
        },
        required: ['metric'],
      },
    },
  ];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({ tools });
}