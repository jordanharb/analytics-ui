#!/usr/bin/env node

// Exact copy of gemini_chat_v2.mjs adapted for API usage
// This maintains the EXACT same flow that produces good reports

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

// --- Supabase RPC helper with pagination support ---
async function supabaseRpc(fnName, args, { url, key }, options = {}) {
  const { paginate = false, limit = 50000 } = options;
  
  // For paginated requests, we need to handle differently
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
      
      // Check if we got less than a full page
      if (data.length < pageSize) break;
      
      offset += pageSize;
      
      // Safety check
      if (allResults.length >= limit) {
        console.error(`Warning: Reached limit of ${limit} results for ${fnName}`);
        break;
      }
    }
    
    return allResults;
  }
  
  // Non-paginated request with higher limit
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

// --- Gemini 2.5 Pro helper ---
async function geminiThinkingGenerate({ 
  apiKey, 
  model = 'gemini-2.5-pro', // ONLY Gemini 2.5 Pro
  prompt, 
  contextJson, 
  temperature = 0.3,
  availableFunctions = {}
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  // Define function declarations for Gemini
  const functionDeclarations = Object.entries(availableFunctions).map(([name, config]) => ({
    name: name,
    description: config.description,
    parameters: config.parameters
  }));

  const userText = `${prompt}\n\nDATA (JSON):\n${toJSON(contextJson)}`;
  
  const body = {
    contents: [
      { role: 'user', parts: [{ text: userText }] }
    ],
    generationConfig: {
      temperature,
      candidateCount: 1,
      maxOutputTokens: 65536  // Increased to maximum for longer reports
    }
  };

  // Add function declarations if any
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  console.error('[Gemini 2.5 Pro] Processing request...');
  
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini error: ${res.status} ${text}`);
  }
  
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  
  let thoughts = [];
  let finalResponse = '';
  
  // Extract thoughts and response
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.thought === true && part.text) {
        thoughts.push(part.text);
        console.error('[THINKING]', part.text.substring(0, 200) + '...');
      } else if (part.functionCall) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args;
        
        if (availableFunctions[funcName]) {
          console.error(`[Function Call] ${funcName}(bill_id: ${funcArgs.bill_id})`);
          
          // Execute the function
          const result = await availableFunctions[funcName].handler(funcArgs);
          
          // Send result back to Gemini
          const followUpBody = {
            contents: [
              { role: 'user', parts: [{ text: userText }] },
              { role: 'model', parts: candidate.content.parts },
              { role: 'function', parts: [{
                functionResponse: {
                  name: funcName,
                  response: { result }
                }
              }]}
            ],
            generationConfig: body.generationConfig,
            tools: body.tools
          };
          
          const followUpRes = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(followUpBody)
          });
          
          if (followUpRes.ok) {
            const followUpData = await followUpRes.json();
            const followUpCandidate = followUpData?.candidates?.[0];
            
            // Extract thoughts and response from follow-up
            if (followUpCandidate?.content?.parts) {
              for (const part of followUpCandidate.content.parts) {
                if (part.thought === true && part.text) {
                  thoughts.push(part.text);
                  console.error('[THINKING]', part.text.substring(0, 200) + '...');
                } else if (part.text && !part.thought) {
                  finalResponse += part.text;
                }
              }
            }
          }
        }
      } else if (part.text && !part.thought) {
        finalResponse += part.text;
      }
    }
  }
  
  return { thoughts, response: finalResponse };
}

// --- Enhanced prompts ---
const ENTITY_SELECTION_PROMPT = `You are helping match a legislator to their campaign finance committees.
Given the legislator information and a list of potential campaign entities (found by last name), 
identify ALL entity IDs that belong to this legislator's campaign committees.

CRITICAL: Look at the 'primary_candidate_name' field - this should match the legislator's name!
A legislator may have MULTIPLE committees over different election cycles.

Match based on:
1. primary_candidate_name matches the legislator's name (most important!)
2. Party alignment (D=Democratic, R=Republican)
3. Office type matches (House = State Representative, Senate = State Senator)
4. Include ALL committees from different years/elections

For example: "Daniel Hernandez, Jr." should match any entity where primary_candidate_name contains "Daniel Hernandez"

Return ONLY a JSON array of ALL matching entity_ids. Example: [101373, 201600506, 201800123]
If no good matches, return empty array: []`;

const DEEP_ANALYSIS_PROMPT = `You are an investigative journalist finding SPECIFIC connections between DONORS and VOTES across ALL legislative sessions.

YOUR PRIMARY MISSION: Find concrete connections between campaign donors and legislative actions ACROSS ALL TIME.

IMPORTANT: You have donation data spanning MULTIPLE YEARS and MULTIPLE SESSIONS. Look for connections between:
- 2018-2019 donations → 2020 legislative actions
- 2020 donations → 2021 legislative actions  
- 2021 donations → 2022 legislative actions
- etc.

AVAILABLE TOOL DURING ANALYSIS:
- get_bill_details(bill_id): Look up bill text/summary. USE THIS for EVERY suspicious vote to understand what the bill actually does!

CRITICAL ANALYSIS STEPS:

1. **COMPREHENSIVE DONOR REVIEW**: 
   - List ALL major donors across ALL years
   - Group donors by industry/interest (energy, insurance, healthcare, real estate, etc.)
   - Note donation patterns over time

2. **CROSS-SESSION ANALYSIS**:
   - Donors often give money YEARS before expecting legislative payoff
   - Look at 2020 donations when analyzing 2022 votes
   - Look at 2019 donations when analyzing 2021 votes
   - Money given in election years often influences votes in following sessions

3. **CONNECT DONORS TO VOTES**: 
   - For EVERY major donor, find related votes/sponsorships
   - Example: "Pinnacle West Capital donated $500 in Oct 2020, then Hernandez voted YES on HB2101 (energy bill) in Feb 2022"
   - Track cumulative giving: "Insurance industry gave total of $3,500 across 2020-2021, then got favorable votes on HB2272"
   - USE get_bill_details to verify what each suspicious bill actually does!

4. **SPONSORSHIP ANALYSIS**:
   - What bills did legislator sponsor each session?
   - Which donors would benefit?
   - Track donor → sponsorship connections across years
   - USE get_bill_details to understand sponsored bills

5. **PATTERN IDENTIFICATION**:
   - Industry clusters (e.g., multiple insurance PACs donating)
   - Timing patterns (donations in election years, votes in following sessions)
   - Quid pro quo patterns (donation → vote → donation cycle)

REMEMBER: Political influence is a LONG GAME. A donation in 2020 can buy influence for votes in 2022. ANALYZE ALL DATA ACROSS ALL TIME PERIODS.

BE SPECIFIC: Always cite donor names, exact amounts, specific dates, and bill numbers.

VOTE DATA: For each vote, you have complete information including:
- How the legislator voted (Y/N)
- Whether it was a party outlier vote
- Actual vote counts: party_yes_votes, party_no_votes (for their party)
- Actual vote counts: other_party_yes_votes, other_party_no_votes (for the opposition)
- Total vote counts across all members

Arizona House has 60 members total. Use the actual vote counts provided to describe voting patterns accurately.

IMPORTANT: Generate a COMPLETE report analyzing all connections between donations and legislative actions.

== ADDITIONAL FUNCTIONS FOR FOLLOW-UP QUESTIONS ==

After the initial analysis, you can use these additional functions in follow-up questions:

1. resolve_legislator(name: string)
   - Finds a legislator by name and returns their IDs and campaign entities
   - Returns: all_legislator_ids array, matching_entity_ids array
   - Use this to analyze a different legislator

2. get_donations(entity_ids: number[], session_ids?: number[])
   - Gets all donations for specified campaign entities
   - Returns detailed donation records with donor names, amounts, dates
   - Use to deep dive into specific donors or time periods

3. get_votes(legislator_ids: number[], session_ids?: number[])
   - Gets voting records for specified legislators
   - Returns votes with bill info and party outlier status
   - Use to examine specific voting patterns

4. get_sponsorships(legislator_ids: number[], session_ids?: number[])
   - Gets bills sponsored/co-sponsored by legislators
   - Returns bill details with sponsorship type
   - Use to analyze legislative priorities

5. get_bill_details(bill_id: number)
   - Gets full text and summary of a specific bill
   - Returns complete bill information
   - Use to understand what any bill actually does

6. get_sessions()
   - Gets all legislative sessions with dates
   - Returns session IDs, names, and date ranges
   - Use to understand timing context

These functions allow you to dig deeper into any aspect of the campaign finance data in response to user questions.`;

// Helper function to group donations by session
function groupDonationsBySession(donations, sessions) {
  const grouped = {};
  
  for (const session of sessions) {
    const sessionDonations = donations.filter(d => d.ret_session_id === session.session_id);
    
    if (sessionDonations.length > 0) {
      grouped[session.session_name] = {
        total: sessionDonations.length,
        before: sessionDonations.filter(d => d.period_type === 'before').length,
        during: sessionDonations.filter(d => d.period_type === 'during').length,
        after: sessionDonations.filter(d => d.period_type === 'after').length,
        total_amount: sessionDonations.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0),
        lobbyists: sessionDonations.filter(d => d.occupation?.toLowerCase().includes('lobbyist')).length,
        pacs: sessionDonations.filter(d => d.donor_type === 'PACs').length
      };
    }
  }
  
  return grouped;
}

// --- Main function ---
async function main() {
  try {
    // Get command line arguments
    const nameRaw = process.argv[2];
    const isInitial = process.argv[3] === 'true';
    const userMessage = process.argv[4];
    const sessionId = process.argv[5];
    const conversationHistory = process.argv[6] ? JSON.parse(process.argv[6]) : [];
    
    if (!nameRaw) {
      throw new Error('Lawmaker name is required.');
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    
    if (!SUPABASE_URL || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error('Missing Gemini API key');
    }

    if (isInitial) {
      console.error('Resolving lawmaker and finding potential entities...');
      
      // Step 1: Resolve lawmaker with potential entities - EXACT COPY FROM CLI v2
      const lawmakerData = await supabaseRpc('resolve_lawmaker_with_entities', {
        p_name: nameRaw
      }, { url: SUPABASE_URL, key: supabaseKey });

      if (!lawmakerData || lawmakerData.length === 0) {
        throw new Error('No matching lawmaker found.');
      }

      const legislator = lawmakerData[0];
      const allLegislatorIds = legislator.all_legislator_ids || [legislator.legislator_id];
      
      console.error(`Found: ${legislator.full_name} (${legislator.party}) - ${legislator.body}`);
      console.error(`All legislator IDs: ${allLegislatorIds.join(', ')}`);
      console.error(`Potential campaign entities: ${legislator.potential_entities.length}`);

      // Step 2: Let Gemini select the correct entities using Gemini 2.5 Pro - EXACT COPY
      console.error('[AI] Using Gemini 2.5 Pro to match campaign committees...');
      
      const entityResult = await geminiThinkingGenerate({
        apiKey: GEMINI_API_KEY,
        prompt: ENTITY_SELECTION_PROMPT,
        contextJson: {
          legislator: {
            id: legislator.legislator_id,
            name: legislator.full_name,
            party: legislator.party,
            body: legislator.body
          },
          potential_entities: legislator.potential_entities.slice(0, 20) // First 20 for selection
        },
        temperature: 0.1
      });

      // Parse entity IDs - EXACT COPY
      let selectedEntityIds = [];
      try {
        const parsed = JSON.parse(entityResult.response.match(/\[[\d,\s]*\]/)?.[0] || '[]');
        selectedEntityIds = parsed.filter(id => typeof id === 'number');
      } catch (e) {
        console.error('Could not parse entity selection:', e.message);
      }

      console.error(`Selected entity IDs: ${selectedEntityIds.join(', ') || 'none'}`);

      if (selectedEntityIds.length === 0) {
        throw new Error('No matching campaign entities found.');
      }

      // Step 3: Get ALL data - EXACT COPY FROM CLI v2
      console.error('Fetching comprehensive data...');
      
      // Sessions
      const sessions = await supabaseRpc('get_session_dates_calculated', {}, 
        { url: SUPABASE_URL, key: supabaseKey });
      const validSessions = sessions.filter(s => s.calculated_start && s.calculated_end);
      console.error(`  - ${validSessions.length} sessions`);

      // Donations - get ALL donations with pagination to avoid 1000 row limit
      const donations = await supabaseRpc('get_donations_with_relevance', {
        p_entity_ids: selectedEntityIds,
        p_session_ids: null  // Get ALL sessions to see all donations
      }, { url: SUPABASE_URL, key: supabaseKey }, { paginate: true });
      
      // Filter to only politically relevant donations to reduce data size
      const relevantDonations = donations.filter(d => d.is_politically_relevant);
      console.error(`  - ${donations.length} total donations (${relevantDonations.length} politically relevant)`);

      // Votes - Using optimized function for LATEST vote per bill only
      console.error('  - Fetching votes (latest per bill only)...');
      let allVotes = [];
      try {
        // Get ALL votes with pagination support
        const votes = await supabaseRpc('get_legislator_votes_latest_only', {
          p_legislator_ids: allLegislatorIds,  // USE ALL IDS!
          p_session_ids: null  // Get all sessions
        }, { url: SUPABASE_URL, key: supabaseKey }, { paginate: true });  // Enable pagination
        
        if (votes && votes.length > 0) {
          allVotes = votes;
        }
      } catch (e) {
        console.error('Failed to fetch optimized votes, falling back to old method');
        // Fallback to old method if new function doesn't exist yet
        for (const session of validSessions.slice(0, 3)) {  // Limit to 3 sessions
          try {
            const votes = await supabaseRpc('votes_with_party_outliers', {
              p_legislator_ids: allLegislatorIds,
              p_session_ids: [session.session_id]
            }, { url: SUPABASE_URL, key: supabaseKey });
            
            if (votes && votes.length > 0) {
              allVotes.push({ 
                session_id: session.session_id, 
                session_name: session.session_name,
                votes: votes.slice(0, 50)  // Limit to 50 votes
              });
            }
          } catch (e) {
            // Silent fail
          }
        }
      }
      console.error(`  - ${Array.isArray(allVotes) ? allVotes.length : allVotes.reduce((sum, s) => sum + s.votes.length, 0)} total unique bill votes`);

      // Sponsorships - USING ALL LEGISLATOR IDS
      console.error('  - Fetching sponsorships...');
      const allSponsorships = [];
      for (const session of validSessions) {
        try {
          const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
            p_legislator_ids: allLegislatorIds,  // USE ALL IDS!
            p_session_ids: [session.session_id]
          }, { url: SUPABASE_URL, key: supabaseKey });
          
          if (sponsors && sponsors.length > 0) {
            allSponsorships.push({ 
              session_id: session.session_id,
              session_name: session.session_name,
              sponsorships: sponsors 
            });
          }
        } catch (e) {
          // Silent fail
        }
      }
      console.error(`  - ${allSponsorships.reduce((sum, s) => sum + s.sponsorships.length, 0)} total sponsorships`);

      // Prepare context - include ACTUAL donation details! - EXACT COPY
      // relevantDonations already defined above
      
      const analysisContext = {
        legislator: {
          id: legislator.legislator_id,
          all_ids: allLegislatorIds,
          name: legislator.full_name,
          party: legislator.party,
          body: legislator.body
        },
        selected_entities: selectedEntityIds,
        sessions: validSessions.map(s => ({
          id: s.session_id,
          name: s.session_name,
          start: s.calculated_start,
          end: s.calculated_end
        })),
        // Include ACTUAL donations with donor names, amounts, dates!
        donations: {
          all_politically_relevant: relevantDonations.map(d => ({
            donor_name: d.donor_name,
            amount: d.amount,
            date: d.transaction_date,
            session_id: d.ret_session_id,
            session_name: d.ret_session_name,
            period: d.period_type,
            donor_type: d.donor_type,
            occupation: d.occupation,
            employer: d.employer
          })),
          summary_by_session: groupDonationsBySession(donations, validSessions)
        },
        voting_records: allVotes,  // Now optimized: latest vote per bill with party counts
        sponsorships: allSponsorships
      };

      // Function to fetch bill details
      const availableFunctions = {
        get_bill_details: {
          description: "Get detailed information about a specific bill including text and summary",
          parameters: {
            type: "object",
            properties: {
              bill_id: { type: "integer", description: "The bill ID to fetch details for" }
            },
            required: ["bill_id"]
          },
          handler: async (args) => {
            const details = await supabaseRpc('get_bill_details', {
              p_bill_id: args.bill_id
            }, { url: SUPABASE_URL, key: supabaseKey });
            return details[0] || null;
          }
        }
      };

      // Step 4: Generate analysis with Gemini 2.5 Pro - EXACT COPY
      console.error('=== GEMINI 2.5 PRO ANALYSIS ===');
      console.error('The AI is now thinking deeply about the data...');
      
      const analysisResult = await geminiThinkingGenerate({
        apiKey: GEMINI_API_KEY,
        model: 'gemini-2.5-pro',
        prompt: DEEP_ANALYSIS_PROMPT,
        contextJson: analysisContext,
        temperature: 0.4,
        availableFunctions
      });

      // Add metadata for report linking
      const metadata = {
        legislator_ids: allLegislatorIds,
        entity_ids: selectedEntityIds
      };
      
      // Build up the full report with auto-continues
      let fullReport = analysisResult.response;
      
      // Save conversation state with initial analysis
      const messages = [
        { role: 'user', parts: [{ text: `Analyze campaign finance for ${nameRaw}` }] },
        { role: 'model', parts: [{ text: analysisResult.response }] }
      ];
      
      // Auto-continue the report at least 2 times to get more comprehensive analysis
      console.error('\n=== AUTO-CONTINUING REPORT (1/2) ===');
      const continue1 = await geminiThinkingGenerate({
        apiKey: GEMINI_API_KEY,
        model: 'gemini-2.5-pro',
        prompt: 'Continue analyzing. Focus on any connections you haven\'t fully explored yet. Look for patterns across different time periods and sessions.',
        contextJson: {
          ...analysisContext,
          previousAnalysis: fullReport
        },
        temperature: 0.4,
        availableFunctions
      });
      
      if (continue1.response && continue1.response.length > 100) {
        fullReport += '\n\n## Continued Analysis\n\n' + continue1.response;
        messages.push(
          { role: 'user', parts: [{ text: 'Continue the analysis' }] },
          { role: 'model', parts: [{ text: continue1.response }] }
        );
      }
      
      console.error('\n=== AUTO-CONTINUING REPORT (2/2) ===');
      const continue2 = await geminiThinkingGenerate({
        apiKey: GEMINI_API_KEY,
        model: 'gemini-2.5-pro',
        prompt: 'Provide final insights and conclusions. Summarize the key findings and any concerning patterns you\'ve identified.',
        contextJson: {
          ...analysisContext,
          previousAnalysis: fullReport
        },
        temperature: 0.4,
        availableFunctions
      });
      
      if (continue2.response && continue2.response.length > 100) {
        fullReport += '\n\n## Final Insights\n\n' + continue2.response;
        messages.push(
          { role: 'user', parts: [{ text: 'Provide final insights' }] },
          { role: 'model', parts: [{ text: continue2.response }] }
        );
      }
      
      const finalReport = fullReport + `\n\n<!-- METADATA: ${JSON.stringify(metadata)} -->`;

      // Output JSON result for API
      console.log(JSON.stringify({
        response: finalReport,
        sessionId,
        messages,
        metadata
      }));

    } else {
      // Handle follow-up questions - use stored conversation
      console.error('Processing follow-up question...');
      
      // Store conversation context
      let messages = conversationHistory || [];
      
      // Add user question
      messages.push({ role: 'user', parts: [{ text: userMessage }] });
      
      // Define ALL available functions for follow-up questions
      const allFunctions = [
        {
          name: 'resolve_legislator',
          description: 'Find a legislator by name and get their IDs and campaign entities',
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The legislator name to search for" }
            },
            required: ["name"]
          }
        },
        {
          name: 'get_donations',
          description: 'Get campaign donations for specific entities',
          parameters: {
            type: "object",
            properties: {
              entity_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Array of entity IDs" 
              },
              session_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Optional session IDs to filter"
              }
            },
            required: ["entity_ids"]
          }
        },
        {
          name: 'get_votes',
          description: 'Get voting records for legislators',
          parameters: {
            type: "object",
            properties: {
              legislator_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Array of legislator IDs" 
              },
              session_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Optional session IDs to filter"
              }
            },
            required: ["legislator_ids"]
          }
        },
        {
          name: 'get_sponsorships',
          description: 'Get bill sponsorships for legislators',
          parameters: {
            type: "object",
            properties: {
              legislator_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Array of legislator IDs" 
              },
              session_ids: { 
                type: "array", 
                items: { type: "integer" },
                description: "Optional session IDs to filter"
              }
            },
            required: ["legislator_ids"]
          }
        },
        {
          name: 'get_bill_details',
          description: 'Get detailed information about a specific bill',
          parameters: {
            type: "object",
            properties: {
              bill_id: { type: "integer", description: "The bill ID to fetch details for" }
            },
            required: ["bill_id"]
          }
        },
        {
          name: 'get_sessions',
          description: 'Get all legislative sessions with dates',
          parameters: {
            type: "object",
            properties: {}
          }
        }
      ];
      
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages,
          generationConfig: {
            temperature: 0.3,
            candidateCount: 1,
            maxOutputTokens: 65536  // Increased to maximum for longer reports
          },
          tools: [{ 
            functionDeclarations: allFunctions
          }]
        })
      });
      
      const chatData = await res.json();
      const candidate = chatData?.candidates?.[0];
      
      // Check if it's a function call
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            const funcName = part.functionCall.name;
            const funcArgs = part.functionCall.args;
            
            console.error(`[Function Call] ${funcName}(${JSON.stringify(funcArgs)})`);
            
            let result = null;
            
            // Execute the appropriate function
            switch (funcName) {
              case 'resolve_legislator': {
                const data = await supabaseRpc('resolve_lawmaker_with_entities', 
                  { p_name: funcArgs.name }, 
                  { url: SUPABASE_URL, key: supabaseKey });
                if (data && data.length > 0) {
                  const legislator = data[0];
                  result = {
                    legislator_id: legislator.legislator_id,
                    all_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],
                    full_name: legislator.full_name,
                    party: legislator.party,
                    body: legislator.body,
                    potential_entities: legislator.potential_entities
                  };
                }
                break;
              }
              case 'get_donations': {
                result = await supabaseRpc('get_donations_with_relevance', {
                  p_entity_ids: funcArgs.entity_ids,
                  p_session_ids: funcArgs.session_ids || null
                }, { url: SUPABASE_URL, key: supabaseKey }, { paginate: true });
                break;
              }
              case 'get_votes': {
                result = await supabaseRpc('votes_with_party_outliers', {
                  p_legislator_ids: funcArgs.legislator_ids,
                  p_session_ids: funcArgs.session_ids || null
                }, { url: SUPABASE_URL, key: supabaseKey });
                break;
              }
              case 'get_sponsorships': {
                result = await supabaseRpc('bill_sponsorships_for_legislator', {
                  p_legislator_ids: funcArgs.legislator_ids,
                  p_session_ids: funcArgs.session_ids || null
                }, { url: SUPABASE_URL, key: supabaseKey });
                break;
              }
              case 'get_bill_details': {
                const details = await supabaseRpc('get_bill_details', {
                  p_bill_id: funcArgs.bill_id
                }, { url: SUPABASE_URL, key: supabaseKey });
                result = details[0] || null;
                break;
              }
              case 'get_sessions': {
                result = await supabaseRpc('get_session_dates_calculated', {}, 
                  { url: SUPABASE_URL, key: supabaseKey });
                break;
              }
            }
            
            // Add function call and response to messages
            messages.push({ 
              role: 'model', 
              parts: candidate.content.parts 
            });
            
            messages.push({ 
              role: 'function',
              parts: [{
                functionResponse: {
                  name: funcName,
                  response: { result }
                }
              }]
            });
            
            // Get follow-up response
            const followUpRes = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: messages,
                generationConfig: {
                  temperature: 0.3,
                  candidateCount: 1,
                  maxOutputTokens: 65536  // Increased to maximum for longer reports
                },
                tools: [{ 
                  functionDeclarations: allFunctions
                }]
              })
            });
            
            const followUpData = await followUpRes.json();
            const chatResult = { 
              response: followUpData?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response' 
            };
            
            messages.push({ role: 'model', parts: [{ text: chatResult.response }] });
            
            console.log(JSON.stringify({
              response: chatResult.response,
              sessionId,
              messages
            }));
          } else if (part.text) {
            // Normal text response
            messages.push({ role: 'model', parts: [{ text: part.text }] });
            
            console.log(JSON.stringify({
              response: part.text,
              sessionId,
              messages
            }));
          }
        }
      } else {
        // Fallback
        const text = candidate?.content?.parts?.[0]?.text || 'No response';
        messages.push({ role: 'model', parts: [{ text }] });
        
        console.log(JSON.stringify({
          response: text,
          sessionId,
          messages
        }));
      }
    }

  } catch (error) {
    console.error('Error occurred:', error.message);
    console.log(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  }
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err?.message || err);
  console.log(JSON.stringify({
    error: err?.message || err,
    stack: err?.stack
  }));
  process.exit(1);
});