import { google } from '@ai-sdk/google';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// Initialize Supabase client
const supabaseUrl = process.env.CAMPAIGN_FINANCE_SUPABASE_URL || process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL;
const supabaseServiceKey = process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY;

const supabase2 = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  }
});

// Initialize OpenAI for embeddings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
});

// Auto-vectorization helper function
const createEmbedding = async (text) => {
  try {
    console.log(`🔍 Creating embedding for: "${text.substring(0, 100)}..."`);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.trim(),
      encoding_format: 'float'
    });

    const embedding = response.data[0].embedding;
    console.log(`✅ Created embedding with ${embedding.length} dimensions`);
    return embedding;
  } catch (error) {
    console.log(`❌ Embedding error: ${error.message}`);
    return null;
  }
};

// Simple in-memory cache
const queryCache = new Map();

const getCacheKey = (func, params) => `${func}_${JSON.stringify(params)}`;
const getCachedResult = (key) => {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }
  return null;
};
const setCachedResult = (key, data, ttlMs = 300000) => {
  queryCache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
  if (queryCache.size > 100) {
    const oldest = Array.from(queryCache.entries())
      .sort(([,a], [,b]) => a.timestamp - b.timestamp)[0];
    queryCache.delete(oldest[0]);
  }
};

// System prompt - Complete MCP Adaptation Guide Context
const systemPrompt = `# Legislator Influence & Bill Search — Agent Context

## Mission
Identify potential influence signals by correlating roll-call voting with campaign-finance patterns; then surface concise, issue-specific talking points. You operate over a Supabase/Postgres database with pgvector embeddings stored on the primary domain tables.

## Ground truth & terminology
* **Donor (giver):** cf_transactions.transaction_entity_id (canonical in cf_transaction_entities).
* **Recipient (receiver/campaign):** cf_transactions.entity_id (committees/candidates).
* **Donation rows only:** cf_transactions.transaction_type_disposition_id = 1.
* **Vectors:**
  * Bills → bills.embedding_summary, bills.embedding_full
  * RTS (stakeholder positions) → rts_positions.embedding
  * Donors (canonical) → cf_transaction_entities.embedding
  * Transactions (propagated from donor) → cf_transactions.embedding
  * All vectors are vector(1536) (OpenAI text-embedding-3-small).
* **Sessions:** sessions(session_id, start_date, end_date).
* **Timezone:** assume America/Los_Angeles for date talkback; SQL filters are in UTC dates unless otherwise noted.

## Available Campaign Finance Tools:
- **searchPeopleWithSessions**: Find legislators with their session information and participation details
- **sessionWindow**: Compute date window around a legislative session
- **findDonorsByName**: Fuzzy resolve canonical donors by name
- **searchDonorTotalsWindow**: Find donors for a person using person_id directly (no need for entity IDs)
- **searchBillsForLegislator**: Bills a person voted on, ranked by bill vectors with auto-vectorization
- **getBillText**: Fetch bill's stored summary/title and full text snapshot
- **getBillVotes**: Detailed roll-call rows for a bill
- **getBillVoteRollup**: Quick tally of vote positions for a bill
- **searchRtsByVector**: Vector search stakeholder positions with optional bill/session filter

## Politically Relevant Preset
A donation is "politically relevant" if any:
* transaction_group_number != 7 (non-individual)
* OR (for individuals/group 7): occupation contains any of: lobbyist, consultant, government, affairs, attorney, lawyer, realtor, developer
* OR employer contains pac or committee
* OR amount ≥ 1000

## Conversation → tool chaining (recipes)

### A) Donor themes around a session for a person
1. Use person_id from searchPeopleWithSessions result directly.
2. Call searchDonorTotalsWindow(p_person_id, p_session_id, p_days_before, p_days_after, p_query_vec, p_min_amount, p_limit).
3. Function automatically gets all entity IDs for the person.
4. Summarize by: top employers/occupations, total amounts, donation counts; optionally cluster by employer/occupation strings.

### B) "Now find bills with that theme they voted on (in session S)"
1. Call searchBillsForLegislator(p_person_id, p_session_id, themes) with comma-separated themes.
2. Function automatically creates embeddings for each theme and searches bills.
3. For selected bills, call getBillText(bill_id) and getBillVotes(bill_id) / getBillVoteRollup(bill_id).

### C) Donor by name → history
1. findDonorsByName(name) → choose entity_id.
2. If targeting a candidate/session: get recipient_ids via recipientEntityIdsForLegislator, then searchDonorTotalsWindow(null, recipient_ids, session_id, 0, 0, null, null, null, 0, 500) and filter the result row where transaction_entity_id == donor entity_id.
3. For general activity by date: call the same function with p_session_id=null, p_from, p_to.

## Filtering rules of thumb
* Always provide date/session filters for transaction analyses:
  * Prefer p_session_id + p_days_before/after when the ask is "±X days around session".
  * Otherwise use explicit p_from/p_to (remember p_to is exclusive).
* Use p_group_numbers to focus on categories (if the user mentions them).
* Use p_min_amount to cut noise when needed.
* Don't hard-filter by vector unless asked; ranking by best_match + totals is usually better.

## Output style
* Prefer concise bullets/tables of: Entity/Donor, Total, Count, Top employer/occupation, Why it's relevant.
* When surfacing correlations, clearly label them as associations, not causation.
* For talking points, pull key phrases from bill summaries/full text + RTS snippets and relate to donor themes.

## Safety & accuracy
* Never claim causation. Use language like "aligned with", "coincides with", "theme affinity".
* Always specify the exact time window used (dates and session #).
* If a legislator name is provided without legislator_id, request the ID or use an upstream resolver.

Remember: Work with the available simplified tools. The searchPeopleWithSessions tool uses mv_legislators_search table. Other advanced tools may need to be implemented based on available database functions.`;

// Define all 9 MCP tools from the adaptation guide
const campaignFinanceTools = {
  searchPeopleWithSessions: tool({
    description: 'Search for legislators with their session information and participation details',
    parameters: z.object({
      searchTerm: z.string().describe('Search term for finding people (name, etc.)'),
      limit: z.number().optional().default(10).describe('Maximum number of results to return')
    }),
    execute: async ({ searchTerm, limit = 10 }) => {
      try {
        console.log(`🔍 Searching for: "${searchTerm}" (limit: ${limit})`);

        let query = supabase2
          .from('mv_legislators_search')
          .select('*');

        if (searchTerm && searchTerm.trim()) {
          // Search using ILIKE for name matching
          query = query.ilike('display_name', `%${searchTerm}%`);
        }

        const { data, error } = await query
          .order('display_name')
          .limit(limit);

        if (error) {
          console.log('❌ Query error:', error);
          throw error;
        }

        console.log('✅ Found results:', data?.length || 0);

        return {
          success: true,
          people: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} legislators matching "${searchTerm}" with session details`
        };
      } catch (error) {
        console.log('💥 Search error:', error);
        return {
          success: false,
          error: error.message,
          people: []
        };
      }
    }
  }),

  sessionWindow: tool({
    description: 'Compute a date window around a legislative session (currently unavailable)',
    parameters: z.object({
      p_session_id: z.number().describe('Session ID'),
      p_days_before: z.number().optional().default(0).describe('Days before session start'),
      p_days_after: z.number().optional().default(0).describe('Days after session end')
    }),
    execute: async ({ p_session_id, p_days_before = 0, p_days_after = 0 }) => {
      console.log(`📅 Session window function not available - returning mock data for session ${p_session_id}`);

      // Return a reasonable mock response instead of calling non-existent function
      const mockFromDate = new Date('2024-01-01');
      const mockToDate = new Date('2024-12-31');

      return {
        success: true,
        window: {
          from_date: mockFromDate.toISOString().split('T')[0],
          to_date: mockToDate.toISOString().split('T')[0]
        },
        summary: `Session ${p_session_id} window (mock): ${mockFromDate.toISOString().split('T')[0]} to ${mockToDate.toISOString().split('T')[0]}`,
        note: "This function is currently unavailable - using mock date range"
      };
    }
  }),

  findDonorsByName: tool({
    description: 'Fuzzy resolve canonical donors by name',
    parameters: z.object({
      p_name: z.string().describe('Donor name to search for'),
      p_limit: z.number().optional().default(25).describe('Maximum number of results')
    }),
    execute: async ({ p_name, p_limit = 25 }) => {
      try {
        console.log(`🔍 Finding donors by name: "${p_name}" (limit: ${p_limit})`);

        const { data, error } = await supabase2
          .rpc('find_donors_by_name', {
            p_name,
            p_limit
          });

        if (error) {
          console.log('❌ Find donors error:', error);
          throw error;
        }

        console.log('✅ Found donors:', data?.length || 0);
        return {
          success: true,
          donors: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} donors matching "${p_name}"`
        };
      } catch (error) {
        console.log('💥 Find donors error:', error);
        return {
          success: false,
          error: error.message,
          donors: []
        };
      }
    }
  }),

  searchDonorTotalsWindow: tool({
    description: 'Find donors who gave to a person during a specified time window. Uses the definitive search_donor_totals_window function.',
    parameters: z.object({
      p_person_id: z.number().describe('Person ID to find donors for'),
      p_recipient_entity_ids: z.array(z.number()).optional().describe('Optional explicit recipient entity IDs'),
      p_session_id: z.number().optional().describe('Session ID for date window'),
      p_days_before: z.number().optional().describe('Days before session start'),
      p_days_after: z.number().optional().describe('Days after session end'),
      p_from: z.string().optional().describe('Start date (YYYY-MM-DD format)'),
      p_to: z.string().optional().describe('End date (YYYY-MM-DD format)'),
      p_group_numbers: z.array(z.number()).optional().describe('Transaction group numbers to filter'),
      p_min_amount: z.number().optional().default(0).describe('Minimum donation amount'),
      p_limit: z.number().optional().default(100).describe('Maximum results')
    }),
    execute: async ({
      p_person_id,
      p_recipient_entity_ids,
      p_session_id,
      p_days_before,
      p_days_after,
      p_from,
      p_to,
      p_group_numbers,
      p_min_amount = 0,
      p_limit = 100
    }) => {
      try {
        console.log(`💰 Searching donors for person ${p_person_id}, session ${p_session_id || 'any'}`);

        const { data, error } = await supabase2
          .rpc('search_donor_totals_window', {
            p_person_id,
            p_recipient_entity_ids,
            p_session_id,
            p_days_before,
            p_days_after,
            p_from,
            p_to,
            p_group_numbers,
            p_min_amount,
            p_limit
          });

        if (error) {
          console.log('❌ Donor totals error:', error);
          throw error;
        }

        console.log('✅ Found donor totals:', data?.length || 0);
        return {
          success: true,
          donors: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} donors for person ${p_person_id}${p_session_id ? ` in session ${p_session_id}` : ''}`
        };
      } catch (error) {
        console.log('💥 Donor totals error:', error);
        return {
          success: false,
          error: error.message,
          donors: []
        };
      }
    }
  }),

  searchBillsForLegislator: tool({
    description: 'Find bills a person voted on, ranked by text and vector similarity. Automatically converts themes to embeddings. Can handle multiple themes separated by commas.',
    parameters: z.object({
      p_person_id: z.number().describe('Person ID (not legislator ID)'),
      p_session_id: z.number().describe('Session ID'),
      themes: z.string().optional().describe('Comma-separated themes to search for (will be auto-vectorized) - e.g. "real estate, healthcare, education"'),
      p_search_terms: z.array(z.string()).optional().describe('Additional text search terms'),
      p_min_text_score: z.number().optional().default(0.6).describe('Minimum vector similarity threshold'),
      p_limit: z.number().optional().default(20).describe('Maximum results'),
      p_offset: z.number().optional().default(0).describe('Results offset')
    }),
    execute: async ({
      p_person_id,
      p_session_id,
      themes,
      p_search_terms,
      p_min_text_score = 0.6,
      p_limit = 20,
      p_offset = 0
    }) => {
      try {
        console.log(`📜 Searching bills for person ${p_person_id} in session ${p_session_id}`);

        // Auto-vectorize themes if provided
        let p_query_vecs = null;
        let themeList = [];

        if (themes && themes.trim()) {
          // Split themes by comma and clean them
          themeList = themes.split(',').map(t => t.trim()).filter(t => t);
          console.log(`🎯 Themes: ${themeList.join(', ')}`);

          if (themeList.length > 0) {
            console.log(`🔄 Creating ${themeList.length} embeddings...`);

            // Create embeddings for each theme
            const embeddings = await Promise.all(
              themeList.map(async (theme) => {
                try {
                  const embedding = await createEmbedding(theme);
                  if (embedding) {
                    // Convert to PostgreSQL vector format
                    const vectorString = `[${embedding.join(',')}]`;
                    console.log(`✅ Vectorized: "${theme}" (${embedding.length} dims)`);
                    return vectorString;
                  }
                  return null;
                } catch (error) {
                  console.log(`❌ Failed to vectorize "${theme}":`, error.message);
                  return null;
                }
              })
            );

            // Filter out failed embeddings
            p_query_vecs = embeddings.filter(v => v !== null);
            console.log(`🚀 Successfully created ${p_query_vecs.length}/${themeList.length} vectors`);
          }
        }

        // Combine themes with search terms
        const finalSearchTerms = [...(p_search_terms || []), ...themeList];

        const { data, error } = await supabase2
          .rpc('search_bills_for_legislator_optimized', {
            p_person_id,
            p_session_id,
            p_search_terms: finalSearchTerms.length > 0 ? finalSearchTerms : null,
            p_query_vecs,
            p_min_text_score,
            p_limit,
            p_offset
          });

        if (error) {
          console.log('❌ Bill search error:', error);
          throw error;
        }

        console.log('✅ Found bills:', data?.length || 0);
        return {
          success: true,
          bills: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} bills related to themes: [${themeList.join(', ')}] voted on by person ${p_person_id}`,
          themes_searched: themeList,
          vectors_created: p_query_vecs?.length || 0,
          search_terms_used: finalSearchTerms
        };
      } catch (error) {
        console.log('💥 Bill search error:', error);
        return {
          success: false,
          error: error.message,
          bills: []
        };
      }
    }
  }),

  getBillText: tool({
    description: 'Fetch bill stored summary/title and full text snapshot',
    parameters: z.object({
      p_bill_id: z.number().describe('Bill ID')
    }),
    execute: async ({ p_bill_id }) => {
      try {
        console.log(`📄 Getting bill text for bill ${p_bill_id}`);

        const { data, error } = await supabase2
          .rpc('get_bill_text', {
            p_bill_id
          });

        if (error) {
          console.log('❌ Bill text error:', error);
          throw error;
        }

        console.log('✅ Retrieved bill text');
        return {
          success: true,
          bill: data,
          summary: `Retrieved text for bill ${data?.bill_number || p_bill_id}`
        };
      } catch (error) {
        console.log('💥 Bill text error:', error);
        return {
          success: false,
          error: error.message,
          bill: null
        };
      }
    }
  }),

  getBillVotes: tool({
    description: 'Detailed roll-call rows for a bill',
    parameters: z.object({
      p_bill_id: z.number().describe('Bill ID')
    }),
    execute: async ({ p_bill_id }) => {
      try {
        console.log(`🗳️ Getting bill votes for bill ${p_bill_id}`);

        const { data, error } = await supabase2
          .rpc('get_bill_votes', {
            p_bill_id
          });

        if (error) {
          console.log('❌ Bill votes error:', error);
          throw error;
        }

        console.log('✅ Found votes:', data?.length || 0);
        return {
          success: true,
          votes: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} votes for bill ${p_bill_id}`
        };
      } catch (error) {
        console.log('💥 Bill votes error:', error);
        return {
          success: false,
          error: error.message,
          votes: []
        };
      }
    }
  }),

  getBillVoteRollup: tool({
    description: 'Quick tally of vote positions for a bill',
    parameters: z.object({
      p_bill_id: z.number().describe('Bill ID')
    }),
    execute: async ({ p_bill_id }) => {
      try {
        console.log(`📊 Getting bill vote rollup for bill ${p_bill_id}`);

        const { data, error } = await supabase2
          .rpc('get_bill_vote_rollup', {
            p_bill_id
          });

        if (error) {
          console.log('❌ Bill vote rollup error:', error);
          throw error;
        }

        console.log('✅ Retrieved vote rollup:', data?.length || 0);
        return {
          success: true,
          rollup: data,
          summary: `Vote rollup for bill ${p_bill_id}: ${data?.map(r => `${r.vote}: ${r.count}`).join(', ')}`
        };
      } catch (error) {
        console.log('💥 Bill vote rollup error:', error);
        return {
          success: false,
          error: error.message,
          rollup: []
        };
      }
    }
  }),

  searchRtsByVector: tool({
    description: 'Vector search stakeholder positions with optional bill/session filter',
    parameters: z.object({
      p_query_vec: z.array(z.number()).describe('Query vector (1536 dimensions)'),
      p_bill_id: z.number().optional().describe('Optional bill ID filter'),
      p_session_id: z.number().optional().describe('Optional session ID filter'),
      p_limit: z.number().optional().default(50).describe('Maximum results')
    }),
    execute: async ({ p_query_vec, p_bill_id, p_session_id, p_limit = 50 }) => {
      try {
        console.log(`🏛️ Searching RTS positions with bill ${p_bill_id || 'any'}, session ${p_session_id || 'any'}`);

        const { data, error } = await supabase2
          .rpc('search_rts_by_vector', {
            p_query_vec,
            p_bill_id,
            p_session_id,
            p_limit
          });

        if (error) {
          console.log('❌ RTS search error:', error);
          throw error;
        }

        console.log('✅ Found RTS positions:', data?.length || 0);
        return {
          success: true,
          positions: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} RTS positions matching the query`
        };
      } catch (error) {
        console.log('💥 RTS search error:', error);
        return {
          success: false,
          error: error.message,
          positions: []
        };
      }
    }
  })
};

// Vercel serverless function
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('📩 Received chat request');
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      console.log('❌ Invalid messages array');
      return res.status(400).json({ error: 'Messages array is required' });
    }

    console.log('📝 Messages count:', messages.length);
    console.log('📝 Last message:', messages[messages.length - 1]?.content?.substring(0, 100));

    // Filter out any malformed messages to prevent MessageConversionError
    const cleanedMessages = messages.filter(msg => {
      if (msg.role === 'assistant' && msg.toolInvocations) {
        // Ensure all tool invocations have results to prevent state corruption
        return msg.toolInvocations.every(inv => inv.state === 'result' || inv.result);
      }
      return true;
    });

    console.log('🧹 Cleaned messages count:', cleanedMessages.length);

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.log('❌ No API key found');
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    console.log('🔑 Using API key:', apiKey.substring(0, 10) + '...');
    const model = google('gemini-2.5-pro', { apiKey });

    console.log('🚀 Starting streamText...');
    const result = await streamText({
      model,
      system: systemPrompt,
      messages: cleanedMessages,
      tools: campaignFinanceTools,
      toolChoice: 'auto',
      maxToolRoundtrips: 5, // Optimal for complex analysis workflows
      maxSteps: 10, // Allow enough steps for thorough campaign finance analysis
      temperature: 0.1,
      onStepFinish: ({ toolCalls, toolResults, stepType, text }) => {
        console.log('📊 Step finished:', {
          stepType,
          toolCallsCount: toolCalls?.length || 0,
          toolNames: toolCalls?.map(tc => tc.toolName) || [],
          hasResults: toolResults && toolResults.length > 0,
          textLength: text?.length || 0
        });
      }
    });

    console.log('📡 Setting streaming headers...');
    // Set streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log('📤 Starting stream to response...');
    // Stream the response
    result.pipeDataStreamToResponse(res);
    console.log('✅ Stream setup complete');

  } catch (error) {
    console.error('💥 AI SDK Chat error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}

