import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from '@ai-sdk/google';
import { streamText, tool, convertToCoreMessages } from 'ai';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase clients with performance optimizations
const supabaseUrl = process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL!;
const supabaseServiceKey = process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY!;

const supabase2 = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false, // Disable session persistence for API routes
  },
  global: {
    headers: {
      'cache-control': 'max-age=300', // 5 minute cache for database queries
    },
  },
});

// Simple in-memory cache for frequently accessed data
const queryCache = new Map<string, { data: any; timestamp: number; ttl: number }>();

// Cache helper functions
const getCacheKey = (func: string, params: any): string => {
  return `${func}_${JSON.stringify(params)}`;
};

const getCachedResult = (key: string) => {
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }
  return null;
};

const setCachedResult = (key: string, data: any, ttlMs: number = 300000) => { // 5 minute default TTL
  queryCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl: ttlMs
  });

  // Clean up old cache entries (simple LRU)
  if (queryCache.size > 100) {
    const oldest = Array.from(queryCache.entries())
      .sort(([,a], [,b]) => a.timestamp - b.timestamp)[0];
    queryCache.delete(oldest[0]);
  }
};

const DEFAULT_MODEL = process.env.GOOGLE_GEMINI_MODEL ?? 'gemini-2.5-pro';

const systemPrompt = `You are the Woke Palantir AI assistant powered by Vercel AI SDK v5 with Gemini 2.5 Pro thinking capability. You specialize in analyzing Arizona campaign finance data, legislative voting patterns, and political connections using sophisticated database functions and vector embeddings.

## Your Advanced Capabilities:
- **Deep Thinking**: Use your thinking capability to reason through complex political connections
- **Multi-step Analysis**: Break down investigations into logical steps and execute tools in sequence
- **Vector Search**: Leverage text embeddings for semantic search across bills and themes
- **Session-Based Analysis**: Analyze data within specific legislative sessions for temporal context
- **Window Analysis**: Examine donation patterns within flexible time windows around key events
- **Pattern Recognition**: Identify potential conflicts of interest between donations and voting
- **Evidence-based Conclusions**: Draw insights only from verified tool results

## Available Campaign Finance Tools:

### Core Analysis Functions:
- **searchPeopleWithSessions**: Find legislators with their session information
- **sessionWindow**: Get session date ranges and key information for temporal analysis
- **findDonorsByName**: Search campaign donors with fuzzy matching and entity filtering
- **searchDonorTotalsWindow**: Analyze donation patterns within date windows
- **searchBillsForLegislator**: Find bills by legislator with voting and sponsorship data
- **listDonorTransactionsWindow**: Get detailed donation transactions in date ranges
- **getBillVotesAndSummary**: Comprehensive bill analysis with voting patterns and summaries
- **searchBillsByText**: Semantic search across bill content using vector embeddings
- **searchBillsByTheme**: Find bills related to specific themes or topics

### Vector Search Capabilities:
- Bills are embedded using OpenAI text-embedding-3-small (1536 dimensions)
- Supports semantic similarity search for finding related legislation
- Theme-based clustering for policy area analysis
- Full-text search with ranking by relevance

## Analysis Framework:
When conducting campaign finance investigations:

1. **Think First**: Use your thinking capability to reason about investigation approach
2. **Identify Sessions**: Use sessionWindow to understand legislative timeframes
3. **Find Legislators**: Use searchPeopleWithSessions to locate relevant people
4. **Gather Financial Data**: Use donation analysis tools with appropriate time windows
5. **Analyze Voting Patterns**: Use bill analysis tools to examine legislative behavior
6. **Cross-Reference**: Look for patterns between donations and voting within sessions
7. **Semantic Analysis**: Use vector search to find thematically related bills
8. **Build Evidence**: Construct arguments based on concrete data patterns
9. **Present Findings**: Explain your reasoning process and evidence clearly

## Investigation Patterns:

### Temporal Analysis:
- Use session-based windows to examine donation patterns around legislative activity
- Analyze donation timing relative to bill introductions, committee hearings, and votes
- Look for clustering of donations before key legislative decisions

### Industry-Specific Investigations:
- Search bills by theme to identify industry-relevant legislation
- Use donor entity filtering to focus on specific industries (PACs, corporations, etc.)
- Cross-reference industry donations with thematically related voting patterns

### Voting Pattern Analysis:
- Examine outlier votes (against party lines) for potential influence indicators
- Compare voting patterns across sessions for consistency
- Analyze bill sponsorship patterns alongside campaign finance data

### Semantic Bill Analysis:
- Use vector search to find bills with similar content or themes
- Identify legislators who consistently vote on related policy areas
- Discover hidden connections between seemingly unrelated bills

## Database Schema Context:
- **cf_transactions**: Campaign finance transactions with donor names and amounts
- **bill_summaries**: AI-generated bill summaries with vector embeddings
- **votes**: Legislative voting records with session context
- **people**: Legislators and candidates with session participation
- **sessions**: Legislative sessions with date ranges and metadata

## Vector Embedding Guidelines:
- Use searchBillsByText for semantic similarity queries
- Bills are embedded at the summary level for efficient search
- Similarity thresholds: >0.8 (very similar), >0.6 (related), >0.4 (loosely related)
- Combine vector search with traditional filters for precise results

## Legislative Analysis Workflows:

### 1. Comprehensive Legislator Analysis
**Purpose**: Deep dive into a legislator's financial and voting patterns
**Steps**:
1. Use searchPeopleWithSessions to find the legislator and their sessions
2. For each session, use sessionWindow to get exact date ranges
3. Use searchDonorTotalsWindow to analyze campaign finance patterns
4. Use searchBillsForLegislator to examine voting and sponsorship history
5. Cross-reference donation timing with key votes using listDonorTransactionsWindow
6. Use vector search (searchBillsByText/Theme) to find thematically related bills

### 2. Issue-Based Investigation
**Purpose**: Track how legislators vote on specific policy areas
**Steps**:
1. Use searchBillsByTheme to identify bills in a policy area
2. Use getBillVotesAndSummary to understand voting patterns on those bills
3. For key legislators, use searchDonorTotalsWindow to check relevant industry donations
4. Use findDonorsByName to investigate specific donors of interest
5. Correlate donation patterns with voting behavior on thematic issues

### 3. Donor Influence Analysis
**Purpose**: Investigate potential donor influence on legislative behavior
**Steps**:
1. Start with findDonorsByName to identify donor transactions
2. Use listDonorTransactionsWindow to get detailed transaction history
3. Use sessionWindow to understand the temporal context of donations
4. Use searchBillsForLegislator to find votes during donation periods
5. Use searchBillsByText to find bills related to donor industry/interests
6. Look for correlation patterns between donation timing and voting

### 4. Outlier Vote Investigation
**Purpose**: Investigate unusual voting patterns that deviate from party lines
**Steps**:
1. Use searchBillsForLegislator with specific vote filters
2. Identify outlier votes (against party expectations)
3. Use getBillVotesAndSummary to understand the bill's content and voting patterns
4. Use searchDonorTotalsWindow around the time of the outlier vote
5. Use vector search to find similar bills and compare voting patterns
6. Build timeline of donations and votes for pattern analysis

### 5. Temporal Window Analysis
**Purpose**: Examine activity patterns within specific time windows
**Steps**:
1. Define investigation time window using sessionWindow or custom dates
2. Use searchDonorTotalsWindow to map financial activity
3. Use searchBillsForLegislator to map legislative activity
4. Use listDonorTransactionsWindow for detailed financial transactions
5. Cross-reference to identify potential influence events
6. Use vector search to expand analysis to thematically related bills

### 6. Industry Sector Analysis
**Purpose**: Analyze how specific industries interact with the legislative process
**Steps**:
1. Use searchBillsByTheme to identify sector-relevant legislation
2. Use getBillVotesAndSummary to analyze voting patterns on these bills
3. Use findDonorsByName with entity type filtering for industry donors
4. Map industry donation patterns across multiple legislators
5. Identify legislators who consistently vote in favor of industry interests
6. Use vector search to find additional related bills that might have been missed

Remember: Think deeply about each investigation step, leverage the sophisticated database functions for comprehensive analysis, use session-based temporal context, and always ground conclusions in evidence from tool results. The vector search capabilities enable discovery of subtle thematic connections that traditional keyword search might miss. Follow these workflows as structured approaches to different types of investigations, adapting them based on the specific research question.`;

// Define comprehensive campaign finance analysis tools based on MCP functions
const campaignFinanceTools = {
  searchPeopleWithSessions: tool({
    description: 'Search for legislators with their session information and participation details',
    parameters: z.object({
      searchTerm: z.string().describe('Search term for finding people (name, etc.)'),
      limit: z.number().optional().default(10).describe('Maximum number of results to return')
    }),
    execute: async ({ searchTerm, limit = 10 }) => {
      try {
        const cacheKey = getCacheKey('search_people_with_sessions', { searchTerm, limit });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for people search: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('search_people_with_sessions', {
          p_search_term: searchTerm,
          p_result_limit: limit
        });

        if (error) throw error;

        const result = {
          success: true,
          people: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} legislators matching "${searchTerm}" with session details`
        };

        // Cache for 10 minutes (people data changes infrequently)
        setCachedResult(cacheKey, result, 600000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          people: []
        };
      }
    }
  }),

  sessionWindow: tool({
    description: 'Get session information including date ranges for temporal analysis',
    parameters: z.object({
      sessionId: z.number().describe('The session_id to get information for')
    }),
    execute: async ({ sessionId }) => {
      try {
        const cacheKey = getCacheKey('session_window', { sessionId });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for session window: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('session_window', {
          p_session_id: sessionId
        });

        if (error) throw error;

        const result = {
          success: true,
          session: data?.[0] || null,
          summary: data?.[0] ? `Retrieved session ${sessionId} with date range ${data[0].start_date} to ${data[0].end_date}` : `No session found with ID ${sessionId}`
        };

        // Cache for 30 minutes (session data is static)
        setCachedResult(cacheKey, result, 1800000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          session: null
        };
      }
    }
  }),

  findDonorsByName: tool({
    description: 'Search campaign donors with fuzzy matching and entity type filtering',
    parameters: z.object({
      donorName: z.string().describe('Donor name to search for (supports partial matching)'),
      entityTypeIds: z.array(z.number()).optional().describe('Optional array of entity_type_id values to filter by'),
      limit: z.number().optional().default(20).describe('Maximum number of results to return')
    }),
    execute: async ({ donorName, entityTypeIds, limit = 20 }) => {
      try {
        const cacheKey = getCacheKey('find_donors_by_name', { donorName, entityTypeIds, limit });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for donor search: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('find_donors_by_name', {
          donor_name: donorName,
          entity_type_ids: entityTypeIds || null,
          result_limit: limit
        });

        if (error) throw error;

        const result = {
          success: true,
          donors: data,
          count: data?.length || 0,
          summary: `Found ${data?.length || 0} donors matching "${donorName}"${entityTypeIds ? ` with entity types [${entityTypeIds.join(', ')}]` : ''}`
        };

        // Cache for 5 minutes (donor data can change)
        setCachedResult(cacheKey, result, 300000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          donors: []
        };
      }
    }
  }),

  searchDonorTotalsWindow: tool({
    description: 'Analyze donation patterns within flexible date windows',
    parameters: z.object({
      personId: z.number().describe('The person_id of the legislator'),
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().describe('End date in YYYY-MM-DD format'),
      minAmount: z.number().optional().describe('Minimum donation amount to include'),
      entityTypeIds: z.array(z.number()).optional().describe('Entity type IDs to filter by')
    }),
    execute: async ({ personId, startDate, endDate, minAmount, entityTypeIds }) => {
      try {
        const cacheKey = getCacheKey('search_donor_totals_window', { personId, startDate, endDate, minAmount, entityTypeIds });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for donor totals: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('search_donor_totals_window', {
          p_person_id: personId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_min_amount: minAmount || null,
          p_entity_type_ids: entityTypeIds || null
        });

        if (error) throw error;

        const result = {
          success: true,
          donorTotals: data,
          count: data?.length || 0,
          totalAmount: data?.reduce((sum: number, donor: any) => sum + (donor.total_amount || 0), 0) || 0,
          summary: `Found ${data?.length || 0} donors with totals for person ${personId} between ${startDate} and ${endDate}`
        };

        // Cache for 5 minutes
        setCachedResult(cacheKey, result, 300000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          donorTotals: []
        };
      }
    }
  }),

  searchBillsForLegislator: tool({
    description: 'Find bills by legislator with voting and sponsorship data using optimized search',
    parameters: z.object({
      personId: z.number().describe('The person_id of the legislator'),
      sessionIds: z.array(z.number()).optional().describe('Session IDs to search within'),
      voteValue: z.string().optional().describe('Specific vote value to filter by (e.g., "Yes", "No")'),
      includeSponsored: z.boolean().optional().default(true).describe('Include bills sponsored by the legislator')
    }),
    execute: async ({ personId, sessionIds, voteValue, includeSponsored = true }) => {
      try {
        const cacheKey = getCacheKey('search_bills_for_legislator_optimized', { personId, sessionIds, voteValue, includeSponsored });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for bills search: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('search_bills_for_legislator_optimized', {
          p_person_id: personId,
          p_session_ids: sessionIds || null,
          p_vote_value: voteValue || null,
          p_include_sponsored: includeSponsored
        });

        if (error) throw error;

        const result = {
          success: true,
          bills: data,
          count: data?.length || 0,
          votedBills: data?.filter((bill: any) => bill.vote_value) || [],
          sponsoredBills: data?.filter((bill: any) => bill.is_sponsor) || [],
          summary: `Found ${data?.length || 0} bills for person ${personId}${sessionIds ? ` in sessions [${sessionIds.join(', ')}]` : ''}${voteValue ? ` with vote: ${voteValue}` : ''}`
        };

        // Cache for 10 minutes
        setCachedResult(cacheKey, result, 600000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          bills: []
        };
      }
    }
  }),

  listDonorTransactionsWindow: tool({
    description: 'Get detailed donation transactions within date ranges with comprehensive filtering',
    parameters: z.object({
      personId: z.number().describe('The person_id of the legislator'),
      startDate: z.string().describe('Start date in YYYY-MM-DD format'),
      endDate: z.string().describe('End date in YYYY-MM-DD format'),
      donorName: z.string().optional().describe('Partial donor name to filter by'),
      entityTypeIds: z.array(z.number()).optional().describe('Entity type IDs to filter by'),
      minAmount: z.number().optional().describe('Minimum amount to include'),
      limit: z.number().optional().default(50).describe('Maximum number of transactions to return')
    }),
    execute: async ({ personId, startDate, endDate, donorName, entityTypeIds, minAmount, limit = 50 }) => {
      try {
        const cacheKey = getCacheKey('list_donor_transactions_window', { personId, startDate, endDate, donorName, entityTypeIds, minAmount, limit });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for transactions: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('list_donor_transactions_window', {
          p_person_id: personId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_donor_name: donorName || null,
          p_entity_type_ids: entityTypeIds || null,
          p_min_amount: minAmount || null,
          p_limit: limit
        });

        if (error) throw error;

        const result = {
          success: true,
          transactions: data,
          count: data?.length || 0,
          totalAmount: data?.reduce((sum: number, txn: any) => sum + (txn.amount || 0), 0) || 0,
          summary: `Found ${data?.length || 0} transactions for person ${personId} between ${startDate} and ${endDate}${donorName ? ` from donors matching "${donorName}"` : ''}`
        };

        // Cache for 5 minutes
        setCachedResult(cacheKey, result, 300000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          transactions: []
        };
      }
    }
  }),

  getBillVotesAndSummary: tool({
    description: 'Get comprehensive bill information including voting patterns and AI-generated summaries',
    parameters: z.object({
      billId: z.number().describe('The bill_id to analyze'),
      includeVotingPatterns: z.boolean().optional().default(true).describe('Include detailed voting analysis')
    }),
    execute: async ({ billId, includeVotingPatterns = true }) => {
      try {
        const cacheKey = getCacheKey('get_bill_votes_and_summary', { billId, includeVotingPatterns });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for bill analysis: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('get_bill_votes_and_summary', {
          p_bill_id: billId,
          p_include_voting_patterns: includeVotingPatterns
        });

        if (error) throw error;

        const result = {
          success: true,
          bill: data?.[0] || null,
          summary: data?.[0] ? `Retrieved comprehensive analysis for bill ${billId}: ${data[0].bill_number}` : `No bill found with ID ${billId}`
        };

        // Cache for 15 minutes (bill data with summaries)
        setCachedResult(cacheKey, result, 900000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          bill: null
        };
      }
    }
  }),

  searchBillsByText: tool({
    description: 'Semantic search across bill content using vector embeddings for finding thematically related bills',
    parameters: z.object({
      searchText: z.string().describe('Text to search for using semantic similarity'),
      sessionIds: z.array(z.number()).optional().describe('Session IDs to limit search to'),
      similarityThreshold: z.number().optional().default(0.6).describe('Minimum similarity score (0.4-1.0, higher = more similar)'),
      limit: z.number().optional().default(10).describe('Maximum number of results to return')
    }),
    execute: async ({ searchText, sessionIds, similarityThreshold = 0.6, limit = 10 }) => {
      try {
        const cacheKey = getCacheKey('search_bills_by_text', { searchText, sessionIds, similarityThreshold, limit });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for vector search: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('search_bills_by_text', {
          search_text: searchText,
          session_ids: sessionIds || null,
          similarity_threshold: similarityThreshold,
          result_limit: limit
        });

        if (error) throw error;

        const result = {
          success: true,
          bills: data,
          count: data?.length || 0,
          searchText,
          similarityThreshold,
          summary: `Found ${data?.length || 0} bills semantically similar to "${searchText}" (threshold: ${similarityThreshold})`
        };

        // Cache for 20 minutes (vector search results)
        setCachedResult(cacheKey, result, 1200000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          bills: []
        };
      }
    }
  }),

  searchBillsByTheme: tool({
    description: 'Find bills related to specific themes or policy areas using predefined categorizations',
    parameters: z.object({
      theme: z.string().describe('Theme or policy area to search for (e.g., "healthcare", "education", "environment")'),
      sessionIds: z.array(z.number()).optional().describe('Session IDs to limit search to'),
      limit: z.number().optional().default(15).describe('Maximum number of results to return')
    }),
    execute: async ({ theme, sessionIds, limit = 15 }) => {
      try {
        const cacheKey = getCacheKey('search_bills_by_theme', { theme, sessionIds, limit });
        const cachedResult = getCachedResult(cacheKey);

        if (cachedResult) {
          console.log(`Cache hit for theme search: ${cacheKey}`);
          return cachedResult;
        }

        const { data, error } = await supabase2.rpc('search_bills_by_theme', {
          theme_name: theme,
          session_ids: sessionIds || null,
          result_limit: limit
        });

        if (error) throw error;

        const result = {
          success: true,
          bills: data,
          count: data?.length || 0,
          theme,
          summary: `Found ${data?.length || 0} bills related to theme "${theme}"${sessionIds ? ` in sessions [${sessionIds.join(', ')}]` : ''}`
        };

        // Cache for 20 minutes (theme data is relatively stable)
        setCachedResult(cacheKey, result, 1200000);
        return result;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
          bills: []
        };
      }
    }
  })
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Performance optimizations and CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept-Encoding');

  // Add performance headers
  res.setHeader('X-Powered-By', 'AI SDK v5 + Gemini 2.5 Pro');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  // Add compression hint
  if (req.headers['accept-encoding']?.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
  }

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Performance monitoring
  const startTime = Date.now();

  try {
    const { messages, data } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Messages array is required' });
      return;
    }

    // Get API key from environment or headers
    const apiKey = process.env.VITE_GOOGLE_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Google API key not configured' });
      return;
    }

    // Create Gemini model instance with thinking capability
    const model = google(DEFAULT_MODEL, {
      apiKey,
      // Enable thinking for complex campaign finance analysis
      structuredOutputs: true
    });

    // Convert messages to core format
    const coreMessages = convertToCoreMessages(messages);

    // Stream the response with multi-step capabilities and thinking
    const result = await streamText({
      model,
      system: systemPrompt,
      messages: coreMessages,
      tools: campaignFinanceTools,
      toolChoice: 'auto',
      maxToolRoundtrips: 10, // Allow extensive multi-step analysis
      maxSteps: 15, // Maximum number of steps for complex investigations
      experimental_continueSteps: true, // Auto-continue for complex tasks
      temperature: 0.1, // Lower temperature for more consistent analysis

      // Enhanced provider options for Gemini thinking capability
      experimental_providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 8192, // Allow deep reasoning for complex analysis
            includeThoughts: true, // Show reasoning process to user
          },
          // Enable additional Gemini features
          candidateCount: 1,
          topK: 40,
          topP: 0.95,
        },
      },

      onStepFinish: ({ toolCalls, toolResults, stepType, text, usage }) => {
        // Log detailed step information for debugging
        console.log(`Step finished:`, {
          stepType,
          toolCallsCount: toolCalls?.length || 0,
          toolNames: toolCalls?.map(tc => tc.toolName) || [],
          hasResults: toolResults && toolResults.length > 0,
          textLength: text?.length || 0,
          usage,
          timestamp: new Date().toISOString()
        });

        // Enhanced logging for thinking steps
        if (stepType === 'text' && text && text.includes('<thinking>')) {
          console.log('Gemini thinking detected in step');
        }

        // Tool execution logging with performance metrics
        if (toolCalls && toolCalls.length > 0) {
          console.log(`Tools executed: ${toolCalls.map(tc => tc.toolName).join(', ')}`);

          // Log tool performance for optimization
          toolCalls.forEach(tc => {
            console.log(`Tool ${tc.toolName} called with args:`, tc.args);
          });

          // Log performance metrics
          const elapsed = Date.now() - startTime;
          console.log(`Step completed in ${elapsed}ms, usage:`, usage);
        }
      }
    });

    // Set up streaming response headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the AI response to the HTTP response
    result.pipeDataStreamToResponse(res);

    // Log final performance metrics
    const totalTime = Date.now() - startTime;
    console.log(`Request completed in ${totalTime}ms, cache size: ${queryCache.size}`);

  } catch (error) {
    console.error('AI SDK Chat error:', error);

    // Enhanced error handling with specific error types
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    let errorDetails = '';

    if (error instanceof Error) {
      // API Key errors
      if (error.message.includes('API key') || error.message.includes('authentication')) {
        statusCode = 401;
        errorMessage = 'Authentication failed';
        errorDetails = 'Please check your API key configuration';
      }
      // Rate limit errors
      else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        statusCode = 429;
        errorMessage = 'Rate limit exceeded';
        errorDetails = 'Please wait a moment before trying again';
      }
      // Database connection errors
      else if (error.message.includes('connect') || error.message.includes('database')) {
        statusCode = 503;
        errorMessage = 'Database connection failed';
        errorDetails = 'Campaign finance database is temporarily unavailable';
      }
      // Model/AI service errors
      else if (error.message.includes('model') || error.message.includes('gemini')) {
        statusCode = 502;
        errorMessage = 'AI service unavailable';
        errorDetails = 'The AI analysis service is temporarily unavailable';
      }
      // Tool execution errors
      else if (error.message.includes('tool') || error.message.includes('function')) {
        statusCode = 422;
        errorMessage = 'Analysis tool error';
        errorDetails = 'One of the campaign finance analysis tools encountered an error';
      }
      // Generic errors
      else {
        errorDetails = error.message;
      }
    }

    // Return structured error response
    res.status(statusCode).json({
      error: errorMessage,
      details: errorDetails,
      code: statusCode,
      timestamp: new Date().toISOString(),
      // Include retry information for client
      retryable: statusCode >= 500 || statusCode === 429,
      retryAfter: statusCode === 429 ? 60 : undefined // Suggest retry after 60 seconds for rate limits
    });
  }
}