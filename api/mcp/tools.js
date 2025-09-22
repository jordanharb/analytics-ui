export default function handler(req, res) {
  const tools = [
    {
      name: 'query_events',
      description: 'Query far-right extremist events with filters for date, location, actors, tags',
      dataset: 'woke_palantir',
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
                minimum: 1,
                maximum: 500,
              },
            },
          },
        },
      },
    },
    {
      name: 'search_posts',
      description: 'Search social media posts about far-right activities',
      dataset: 'woke_palantir',
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
            minimum: 1,
            maximum: 200,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'analyze_trends',
      description: 'Analyze trends in far-right extremist activities',
      dataset: 'woke_palantir',
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
    {
      name: 'campaign_search_entities',
      description: 'Search campaign finance committees and candidates by name.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive committee or candidate name.' },
          limit: { type: 'integer', default: 25, minimum: 1, maximum: 200 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
        required: ['query'],
      },
    },
    {
      name: 'campaign_get_entity_summary',
      description: 'Retrieve financial overview and recent filings for a campaign entity.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'integer', description: 'Entity ID from cf_entities.' },
          recent_records: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'campaign_get_person_sessions',
      description: 'List legislative sessions and committee links for an rs_people record.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          person_id: { type: 'integer', description: 'Person ID from rs_people.' },
        },
        required: ['person_id'],
      },
    },
    {
      name: 'campaign_list_bills_for_person',
      description: 'Return bill votes and sponsorships for a legislator mapped from rs_people.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          person_id: { type: 'integer', description: 'Person ID from rs_people.' },
          session_ids: { type: 'array', items: { type: 'integer' } },
          limit: { type: 'integer', default: 100, minimum: 1, maximum: 500 },
        },
        required: ['person_id'],
      },
    },
    {
      name: 'campaign_list_transactions',
      description: 'Fetch detailed transactions for a campaign entity with filters.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'integer', description: 'Entity ID from cf_entities.' },
          disposition: { type: 'integer', enum: [1, 2], description: '1 = contributions, 2 = expenditures.' },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          min_amount: { type: 'number' },
          max_amount: { type: 'number' },
          transaction_entity_type_ids: { type: 'array', items: { type: 'integer' } },
          limit: { type: 'integer', default: 100, minimum: 1, maximum: 500 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
        required: ['entity_id'],
      },
    },
    {
      name: 'campaign_top_donors',
      description: 'Aggregate top donors for a campaign entity over a time window.',
      dataset: 'campaign_finance',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'integer', description: 'Entity ID from cf_entities.' },
          start_date: { type: 'string', format: 'date' },
          end_date: { type: 'string', format: 'date' },
          limit: { type: 'integer', default: 25, minimum: 1, maximum: 200 },
          disposition: { type: 'integer', enum: [1, 2], description: '1 = contributions, 2 = expenditures.' },
        },
        required: ['entity_id'],
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
