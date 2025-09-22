import type { VercelRequest, VercelResponse } from '@vercel/node';
import { tools as serverTools } from '../../../mcp-server/dist/http-adapter.js';

const campaignTools = [
  {
    name: 'campaign_search_entities',
    dataset: 'campaign_finance',
    description: 'Search campaign finance entities (committees, candidates, PACs) by name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive search string for candidate or committee names.'
        },
        limit: {
          type: 'integer',
          default: 25,
          minimum: 1,
          maximum: 200
        },
        offset: {
          type: 'integer',
          default: 0,
          minimum: 0
        }
      },
      required: ['query']
    }
  },
  {
    name: 'campaign_get_entity_summary',
    dataset: 'campaign_finance',
    description: 'Retrieve financial overview and recent filings for a campaign finance entity.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'integer',
          description: 'Numeric entity identifier from cf_entities.'
        },
        recent_records: {
          type: 'integer',
          default: 5,
          minimum: 1,
          maximum: 20
        }
      },
      required: ['entity_id']
    }
  },
  {
    name: 'campaign_get_person_sessions',
    dataset: 'campaign_finance',
    description: 'List legislative sessions and committee links for an rs_people person.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: {
          type: 'integer',
          description: 'Person identifier from rs_people.'
        }
      },
      required: ['person_id']
    }
  },
  {
    name: 'campaign_list_bills_for_person',
    dataset: 'campaign_finance',
    description: 'Return bill votes and sponsorships for a legislator mapped from rs_people.',
    inputSchema: {
      type: 'object',
      properties: {
        person_id: {
          type: 'integer',
          description: 'Person identifier from rs_people.'
        },
        session_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Optional filter to specific session IDs.'
        },
        limit: {
          type: 'integer',
          default: 100,
          minimum: 1,
          maximum: 500
        }
      },
      required: ['person_id']
    }
  },
  {
    name: 'campaign_list_transactions',
    dataset: 'campaign_finance',
    description: 'List detailed campaign finance transactions with filters.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'integer',
          description: 'Primary campaign entity ID.'
        },
        disposition: {
          type: 'integer',
          enum: [1, 2],
          description: 'Transaction disposition (1 = contributions, 2 = expenditures).'
        },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        min_amount: { type: 'number' },
        max_amount: { type: 'number' },
        transaction_entity_type_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Filter by donor entity type IDs.'
        },
        limit: {
          type: 'integer',
          default: 100,
          minimum: 1,
          maximum: 500
        },
        offset: {
          type: 'integer',
          default: 0,
          minimum: 0
        }
      },
      required: ['entity_id']
    }
  },
  {
    name: 'campaign_top_donors',
    dataset: 'campaign_finance',
    description: 'Aggregate top donors for a campaign entity over a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'integer',
          description: 'Primary campaign entity ID to analyze.'
        },
        start_date: { type: 'string', format: 'date' },
        end_date: { type: 'string', format: 'date' },
        limit: {
          type: 'integer',
          default: 25,
          minimum: 1,
          maximum: 200
        },
        disposition: {
          type: 'integer',
          enum: [1, 2],
          description: 'Transaction disposition (1 = contributions, 2 = expenditures).'
        }
      },
      required: ['entity_id']
    }
  }
];

const baseTools = Array.isArray(serverTools) ? serverTools : [];
const existingNames = new Set(baseTools.map((tool: any) => tool?.name));
const mergedTools = [...baseTools];

for (const tool of campaignTools) {
  if (!existingNames.has(tool.name)) {
    mergedTools.push(tool);
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ tools: mergedTools });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
