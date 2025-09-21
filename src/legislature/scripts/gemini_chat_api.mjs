#!/usr/bin/env node

// API wrapper for Gemini chat script with function calling
// Gemini can decide when to fetch data rather than pre-loading everything

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment
function loadEnvFromFile(envPath) {
  try {
    const full = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    // ignore
  }
}

loadEnvFromFile('.env');
loadEnvFromFile('.env.local');

// Supabase RPC helper with pagination
async function supabaseRpc(fnName, args, { url, key }, options = {}) {
  const { paginate = false, limit = 50000 } = options;
  
  if (paginate) {
    let allResults = [];
    let offset = 0;
    const pageSize = 1000;
    
    while (true) {
      const res = await fetch(`${url}/rest/v1/rpc/${fnName}?limit=${pageSize}&offset=${offset}`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact'
        },
        body: JSON.stringify(args || {})
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${fnName} failed: ${res.status} ${text}`);
      }
      
      const data = await res.json();
      if (!data || data.length === 0) break;
      
      allResults = allResults.concat(data);
      if (data.length < pageSize) break;
      offset += pageSize;
      
      if (allResults.length >= limit) break;
    }
    
    return allResults;
  }
  
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}?limit=${limit}`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${fnName} failed: ${res.status} ${text}`);
  }
  
  return res.json();
}

// Function calling tools for Gemini
const tools = [
  {
    functionDeclarations: [
      {
        name: 'resolve_legislator',
        description: 'Find a legislator by name and get ALL their legislator IDs (if they switched chambers) and campaign finance entities',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Full or partial name of the legislator'
            }
          },
          required: ['name']
        }
      },
      {
        name: 'get_donations',
        description: 'Get campaign donations for specific entities with pagination support',
        parameters: {
          type: 'object',
          properties: {
            entity_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of entity IDs to get donations for'
            },
            session_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional array of session IDs to filter by',
              nullable: true
            }
          },
          required: ['entity_ids']
        }
      },
      {
        name: 'get_votes',
        description: 'Get voting records for a legislator across sessions',
        parameters: {
          type: 'object',
          properties: {
            legislator_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of ALL legislator IDs for this person (use all_legislator_ids from resolve_legislator)'
            },
            session_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional array of session IDs to filter by',
              nullable: true
            }
          },
          required: ['legislator_ids']
        }
      },
      {
        name: 'get_sponsorships',
        description: 'Get bill sponsorships for a legislator',
        parameters: {
          type: 'object',
          properties: {
            legislator_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of ALL legislator IDs for this person (use all_legislator_ids from resolve_legislator)'
            },
            session_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Optional array of session IDs to filter by',
              nullable: true
            }
          },
          required: ['legislator_ids']
        }
      },
      {
        name: 'get_bill_details',
        description: 'Get detailed information about a specific bill',
        parameters: {
          type: 'object',
          properties: {
            bill_number: {
              type: 'string',
              description: 'Bill number like HB2272 or SB1234'
            }
          },
          required: ['bill_number']
        }
      },
      {
        name: 'get_sessions',
        description: 'Get all legislative sessions with calculated date ranges',
        parameters: {
          type: 'object',
          properties: {}
        }
      }
    ]
  }
];

// Execute function calls
async function executeFunctionCall(name, args, supabase) {
  try {
    switch (name) {
      case 'resolve_legislator': {
        const data = await supabaseRpc('resolve_lawmaker_with_entities', 
          { p_name: args.name }, supabase);
        if (!data || data.length === 0) {
          return { error: 'No legislator found' };
        }
        const legislator = data[0];
        // Include entity selection logic - find exact name matches
        const entities = legislator.potential_entities || [];
        const searchName = args.name.toLowerCase();
        const searchParts = searchName.split(' ');
        const firstName = searchParts[0];
        const lastName = searchParts[searchParts.length - 1];
        
        const matching = entities.filter(e => {
          const candidateName = e.primary_candidate_name?.toLowerCase() || '';
          // Match if candidate name includes the first name or last name from search
          return candidateName.includes(firstName) || 
                 (lastName && lastName !== firstName && candidateName.includes(lastName));
        });
        
        // Return data with ALL legislator IDs
        return {
          legislator_id: legislator.legislator_id,  // Primary ID for display
          all_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],  // Array of ALL IDs
          full_name: legislator.full_name,
          party: legislator.party,
          body: legislator.body,
          matching_entity_ids: matching.map(e => e.entity_id),
          entity_count: entities.length,
          found_entities: matching.length
        };
      }

      case 'get_donations': {
        const donations = await supabaseRpc('get_donations_with_relevance',
          { p_entity_ids: args.entity_ids, p_session_ids: args.session_ids || null },
          supabase, { paginate: true });
        return {
          total_count: donations.length,
          donations: donations.slice(0, 100), // Return first 100 for context
          summary: {
            total_amount: donations.reduce((sum, d) => sum + (d.amount || 0), 0),
            unique_donors: new Set(donations.map(d => d.donor_name)).size,
            by_type: donations.reduce((acc, d) => {
              acc[d.donor_type] = (acc[d.donor_type] || 0) + 1;
              return acc;
            }, {})
          }
        };
      }

      case 'get_votes': {
        const sessions = args.session_ids || 
          (await supabaseRpc('get_session_dates_calculated', {}, supabase))
            .filter(s => s.calculated_start && s.calculated_end)
            .slice(0, 5)
            .map(s => s.session_id);
        
        const allVotes = [];
        for (const sessionId of sessions) {
          const votes = await supabaseRpc('votes_with_party_outliers', {
            p_legislator_ids: args.legislator_ids || [args.legislator_id],  // Use array of IDs
            p_session_ids: [sessionId]
          }, supabase);
          
          if (votes && votes.length > 0) {
            allVotes.push({
              session_id: sessionId,
              votes: votes.slice(0, 20) // Limit per session
            });
          }
        }
        return { sessions: allVotes, total_votes: allVotes.reduce((sum, s) => sum + s.votes.length, 0) };
      }

      case 'get_sponsorships': {
        const sessions = args.session_ids || 
          (await supabaseRpc('get_session_dates_calculated', {}, supabase))
            .filter(s => s.calculated_start && s.calculated_end)
            .slice(0, 5)
            .map(s => s.session_id);
        
        const allSponsorships = [];
        for (const sessionId of sessions) {
          const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
            p_legislator_ids: args.legislator_ids || [args.legislator_id],  // Use array of IDs
            p_session_ids: [sessionId]
          }, supabase);
          
          if (sponsors && sponsors.length > 0) {
            allSponsorships.push({
              session_id: sessionId,
              sponsorships: sponsors.slice(0, 10)
            });
          }
        }
        return { sessions: allSponsorships, total_bills: allSponsorships.reduce((sum, s) => sum + s.sponsorships.length, 0) };
      }

      case 'get_bill_details': {
        const bill = await supabaseRpc('get_bill_by_number', 
          { p_bill_number: args.bill_number }, supabase);
        return bill || { error: 'Bill not found' };
      }

      case 'get_sessions': {
        const sessions = await supabaseRpc('get_session_dates_calculated', {}, supabase);
        return sessions.filter(s => s.calculated_start && s.calculated_end);
      }

      default:
        return { error: `Unknown function: ${name}` };
    }
  } catch (error) {
    return { error: error.message };
  }
}

// Main function
async function main() {
  try {
    const legislatorName = process.env.LEGISLATOR_NAME;
    const isInitial = process.env.IS_INITIAL === 'true';
    const userMessage = process.env.USER_MESSAGE || '';
    const sessionId = process.env.SESSION_ID;
    const sessionData = process.env.SESSION_DATA ? JSON.parse(process.env.SESSION_DATA) : null;

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (!apiKey || !supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const supabase = { url: supabaseUrl, key: supabaseKey };

    // Create model with function calling
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      tools,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 32768
      }
    });

    // Build conversation - filter out any function responses from history
    const messages = (sessionData?.messages || []).filter(m => 
      m.role === 'user' || m.role === 'model'
    );
    
    if (isInitial) {
      const prompt = `You are an investigative journalist finding SPECIFIC connections between DONORS and VOTES across ALL legislative sessions for ${legislatorName}.

YOUR PRIMARY MISSION: Find concrete connections between campaign donors and legislative actions ACROSS ALL TIME.

FOLLOW THESE EXACT STEPS IN ORDER:

1. Call resolve_legislator with name="${legislatorName}" 
   - This finds the legislator and returns all_legislator_ids (array of ALL their IDs if they switched chambers) and matching_entity_ids
   - IMPORTANT: Use ALL legislator IDs from all_legislator_ids array for votes/sponsorships
   - Use ALL entity IDs returned in matching_entity_ids for donations

2. Call get_donations with entity_ids=[use all matching_entity_ids from step 1]
   - This gets ALL donations to their campaigns
   - Pay attention to large donors and politically connected individuals
   - Include ALL individuals (lobbyists and consultants are especially important!)

3. Call get_votes with legislator_ids=[use ALL all_legislator_ids from step 1]  
   - This gets their COMPLETE voting record across all chambers (House/Senate)
   - Look for votes that align with donor interests

4. Call get_sponsorships with legislator_ids=[use ALL all_legislator_ids from step 1]
   - This gets ALL bills they sponsored across all chambers
   - Look for bills that benefit their donors

5. When you find interesting bills, call get_bill_details with bill_number="HB1234" (use actual bill numbers)
   - This gets full details about specific bills
   - USE THIS for every suspicious vote to understand what was at stake!

IMPORTANT FUNCTION NOTES:
- resolve_legislator: Returns all_legislator_ids (array) and matching_entity_ids. Use ALL IDs!
- get_donations: Requires entity_ids array. Returns donations with donor names, amounts, dates.
- get_votes: Requires legislator_ids array. Use all_legislator_ids from resolve_legislator.
- get_sponsorships: Requires legislator_ids array. Use all_legislator_ids from resolve_legislator.
- get_bill_details: Requires bill_number string like "HB2272" or "SB1234".
- get_sessions: No parameters. Returns all legislative sessions with dates.

CRITICAL ANALYSIS STEPS:

1. **COMPREHENSIVE DONOR REVIEW**: 
   - List ALL major donors across ALL years
   - Group donors by industry/interest (energy, insurance, healthcare, real estate, etc.)
   - Note donation patterns over time
   - Focus on politically relevant donors (lobbyists, PACs, consultants)

2. **CROSS-SESSION ANALYSIS**:
   - Donors often give money YEARS before expecting legislative payoff
   - Look at 2018-2019 donations when analyzing 2020-2021 votes
   - Look at 2020 donations when analyzing 2022 votes
   - Look at 2019 donations when analyzing 2021 votes
   - Money given in election years often influences votes in following sessions

3. **CONNECT DONORS TO VOTES**: 
   - For EVERY major donor, find related votes/sponsorships
   - Example: "Pinnacle West Capital donated $500 in Oct 2020, then ${legislatorName} voted YES on HB2101 (energy bill) in Feb 2022"
   - Track cumulative giving: "Insurance industry gave total of $3,500 across 2020-2021, then got favorable votes on HB2272"

4. **TIMING PATTERNS**:
   - Donation spikes before/during/after legislative sessions
   - Large donations from lobbyists, consultants, or PACs
   - Timing correlations between donations and key votes
   - Election cycle patterns vs legislative session timing

5. **BILL ANALYSIS**:
   - When you find a suspicious correlation between donations and votes/sponsorships:
   - Use get_bill_details() to fetch the actual bill text and summary
   - Explain what the bill does and why the donation timing is suspicious
   - Be specific with dates, amounts, and bill numbers

Write a comprehensive report covering:
- Summary of legislator and their campaign committees
- Donation patterns across sessions (especially from lobbyists/PACs)
- Suspicious timing correlations
- Key bills with detailed analysis (use get_bill_details!)
- Potential conflicts of interest
- Specific donor-vote connections with evidence

Be SPECIFIC: cite donor names, amounts, dates, and bill numbers.
Show your thinking process as you analyze the data.

=== FUNCTION DOCUMENTATION ===

You have access to these functions to gather data:

1. resolve_legislator(name: string)
   - Finds a legislator by name and their campaign finance entities
   - Returns: {
       legislator_id: number,
       full_name: string, 
       party: string,
       body: string,
       matching_entity_ids: number[], // Campaign committees that match this legislator
       entity_count: number,
       found_entities: number
     }
   - IMPORTANT: Use ALL entity IDs in matching_entity_ids for donation queries

2. get_donations(entity_ids: number[], session_ids?: number[])
   - Gets all donations for the specified campaign entities
   - entity_ids: Array of entity IDs from resolve_legislator
   - session_ids: Optional - filter by specific sessions
   - Returns: {
       total_count: number,
       donations: array of first 100 donations with full details,
       summary: {
         total_amount: number,
         unique_donors: number,
         by_type: object with counts by donor type
       }
     }
   - NOTE: Returns ALL donations with pagination, not just 1000

3. get_votes(legislator_id: number, session_ids?: number[])
   - Gets voting record for a legislator
   - legislator_id: From resolve_legislator
   - session_ids: Optional - specific sessions to check
   - Returns: {
       sessions: array of sessions with votes,
       total_votes: number
     }
   - Includes vote value (Y/N) and bill information

4. get_sponsorships(legislator_id: number, session_ids?: number[])
   - Gets bills sponsored or co-sponsored by legislator
   - legislator_id: From resolve_legislator
   - Returns: {
       sessions: array of sessions with sponsored bills,
       total_bills: number
     }

5. get_bill_details(bill_number: string)
   - Gets full details about a specific bill
   - bill_number: Like "HB2272" or "SB1234" (use the format from votes/sponsorships)
   - Returns: Full bill text, summary, sponsors, and legislative history
   - USE THIS whenever you find a suspicious vote or sponsorship!

6. get_sessions()
   - Gets all legislative sessions with calculated date ranges
   - No parameters needed
   - Returns: Array of sessions with start/end dates
   - Useful for understanding timing of donations vs legislative activity

REMEMBER: 
- Always use ALL matching_entity_ids from resolve_legislator
- Call get_bill_details for any suspicious bills you find
- Look for patterns across multiple years (donations in one year, votes in later years)
- Be specific with names, amounts, dates, and bill numbers in your analysis`;
      
      messages.push({ role: 'user', parts: [{ text: prompt }] });
    } else {
      messages.push({ role: 'user', parts: [{ text: userMessage }] });
    }

    // Start chat with function calling
    const chat = model.startChat({ history: messages.slice(0, -1) });
    const result = await chat.sendMessage(messages[messages.length - 1].parts[0].text);

    // Handle function calls
    let finalResponse = result.response.text();
    const functionCalls = result.response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      const functionResponseParts = [];
      
      for (const call of functionCalls) {
        const responseData = await executeFunctionCall(call.name, call.args, supabase);
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: responseData }
          }
        });
      }
      
      // Send function results back to model
      let followUp = await chat.sendMessage(functionResponseParts);
      finalResponse = followUp.response.text();
      
      // Continue if more function calls are needed
      let iterations = 0;
      while (followUp.response.functionCalls()?.length > 0 && iterations < 5) {
        const moreCalls = followUp.response.functionCalls();
        const moreResponseParts = [];
        
        for (const call of moreCalls) {
          const responseData = await executeFunctionCall(call.name, call.args, supabase);
          moreResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: responseData }
            }
          });
        }
        
        followUp = await chat.sendMessage(moreResponseParts);
        finalResponse = followUp.response.text();
        iterations++;
      }
    }

    // Calculate stats if available
    let stats = null;
    try {
      // Try to extract stats from function calls
      if (functionCalls) {
        const donationCall = functionCalls.find(c => c.name === 'get_donations');
        const voteCall = functionCalls.find(c => c.name === 'get_votes');
        const sponsorCall = functionCalls.find(c => c.name === 'get_sponsorships');
        
        if (donationCall || voteCall || sponsorCall) {
          stats = {
            donations: 0,
            votes: 0,
            sponsorships: 0
          };
        }
      }
    } catch (e) {
      // Ignore stats errors
    }
    
    // Output result - only store user and model messages, not function calls
    const conversationMessages = [
      ...messages.filter(m => m.role === 'user' || m.role === 'model'),
      { role: 'model', parts: [{ text: finalResponse }] }
    ];
    
    console.log(JSON.stringify({
      response: finalResponse,
      sessionId,
      stats,
      messages: conversationMessages
    }));

  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  }
}

main().catch(console.error);