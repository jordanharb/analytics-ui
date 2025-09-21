#!/usr/bin/env node

// Gemini 2.5 Pro API version - adapted from the successful v2 CLI script
// This version uses direct API calls instead of the SDK for better control

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
        console.log(`Warning: Reached limit of ${limit} results for ${fnName}`);
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

4. **SPONSORSHIP ANALYSIS**:
   - What bills did legislator sponsor each session?
   - Which donors would benefit?
   - Track donor → sponsorship connections across years

5. **PATTERN IDENTIFICATION**:
   - Industry clusters (e.g., multiple insurance PACs donating)
   - Timing patterns (donations in election years, votes in following sessions)
   - Quid pro quo patterns (donation → vote → donation cycle)

REMEMBER: Political influence is a LONG GAME. A donation in 2020 can buy influence for votes in 2022. ANALYZE ALL DATA ACROSS ALL TIME PERIODS.

BE SPECIFIC: Always cite donor names, exact amounts, specific dates, and bill numbers.

AVAILABLE FUNCTIONS FOR FOLLOW-UP QUESTIONS:

get_bill_details: 
- Use this to look up ANY bill you find interesting or suspicious
- Call with bill_id (number) to get full text, summary, and details
- Example: If you see a vote on bill_id 12345, call get_bill_details to understand what it was about
- This is CRITICAL for understanding what donors got in return for their money`;

// Main function for API usage
async function main() {
  try {
    // Get inputs from command line args or environment
    const legislatorName = process.argv[2];
    const isInitial = process.argv[3] === 'true';
    const userMessage = process.argv[4];
    const sessionId = process.argv[5];
    const conversationHistory = process.argv[6] ? JSON.parse(process.argv[6]) : [];

    // Get environment variables
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

    // Prepare messages array for conversation
    let messages = conversationHistory || [];

    // Define available functions
    const functionDeclarations = [{
      name: 'get_bill_details',
      description: 'Get detailed information about a specific bill including text and summary',
      parameters: {
        type: "object",
        properties: {
          bill_id: { type: "integer", description: "The bill ID to fetch details for" }
        },
        required: ["bill_id"]
      }
    }];

    if (isInitial) {
      console.error('Starting initial analysis...');
      
      // Step 1: Resolve lawmaker with potential entities
      const lawmakerData = await supabaseRpc('resolve_lawmaker_with_entities', {
        p_name: legislatorName
      }, { url: SUPABASE_URL, key: supabaseKey });

      if (!lawmakerData || lawmakerData.length === 0) {
        throw new Error('No matching lawmaker found.');
      }

      const legislator = lawmakerData[0];
      console.error(`Found: ${legislator.full_name} (${legislator.party}) - ${legislator.body}`);
      console.error(`All legislator IDs: ${legislator.all_legislator_ids || [legislator.legislator_id]}`);
      console.error(`Potential campaign entities: ${legislator.potential_entities.length}`);

      // Step 2: Let Gemini select the correct entities
      console.error('Using Gemini 2.5 Pro to match campaign committees...');
      
      const entityEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const entityUserText = `${ENTITY_SELECTION_PROMPT}\n\nDATA (JSON):\n${toJSON({
        legislator: {
          id: legislator.legislator_id,
          all_ids: legislator.all_legislator_ids,
          name: legislator.full_name,
          party: legislator.party,
          body: legislator.body
        },
        potential_entities: legislator.potential_entities.slice(0, 20) // First 20 for selection
      })}`;

      const entityRes = await fetch(entityEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: entityUserText }] }],
          generationConfig: {
            temperature: 0.1,
            candidateCount: 1,
            maxOutputTokens: 32768
          }
        })
      });

      if (!entityRes.ok) {
        throw new Error(`Gemini error: ${entityRes.status}`);
      }

      const entityData = await entityRes.json();
      const entityResponse = entityData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      
      // Parse entity IDs
      let selectedEntityIds = [];
      try {
        const parsed = JSON.parse(entityResponse.match(/\[[\d,\s]*\]/)?.[0] || '[]');
        selectedEntityIds = parsed.filter(id => typeof id === 'number');
      } catch (e) {
        console.error('Could not parse entity selection:', e.message);
      }

      console.error(`Selected entity IDs: ${selectedEntityIds.join(', ') || 'none'}`);

      if (selectedEntityIds.length === 0) {
        throw new Error('No matching campaign entities found');
      }

      // Use ALL legislator IDs for comprehensive data
      const allLegislatorIds = legislator.all_legislator_ids || [legislator.legislator_id];

      // Step 3: Get ALL data
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
      console.error(`  - ${donations.length} total donations (fetched with pagination)`);

      // Votes - use ALL legislator IDs
      console.error('  - Fetching votes for all legislator IDs...');
      const allVotes = [];
      for (const session of validSessions) {
        try {
          const votes = await supabaseRpc('votes_with_party_outliers', {
            p_legislator_ids: allLegislatorIds,  // Use ALL IDs
            p_session_ids: [session.session_id]
          }, { url: SUPABASE_URL, key: supabaseKey });
          
          if (votes && votes.length > 0) {
            allVotes.push({ 
              session_id: session.session_id, 
              session_name: session.session_name,
              votes 
            });
          }
        } catch (e) {
          // Silent fail
        }
      }
      console.error(`  - ${allVotes.reduce((sum, s) => sum + s.votes.length, 0)} total votes`);

      // Sponsorships - use ALL legislator IDs
      console.error('  - Fetching sponsorships for all legislator IDs...');
      const allSponsorships = [];
      for (const session of validSessions) {
        try {
          const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
            p_legislator_ids: allLegislatorIds,  // Use ALL IDs
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

      // Prepare context - include ACTUAL donation details!
      const relevantDonations = donations.filter(d => d.is_politically_relevant);
      
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
        voting_records: allVotes,
        sponsorships: allSponsorships
      };

      // Step 4: Generate initial analysis
      console.error('Generating analysis with Gemini 2.5 Pro...');
      
      const analysisEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const analysisUserText = `${DEEP_ANALYSIS_PROMPT}\n\nDATA (JSON):\n${toJSON(analysisContext)}`;
      
      const analysisRes = await fetch(analysisEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: analysisUserText }] }],
          generationConfig: {
            temperature: 0.4,
            candidateCount: 1,
            maxOutputTokens: 32768
          },
          tools: [{ functionDeclarations }]
        })
      });

      if (!analysisRes.ok) {
        throw new Error(`Gemini analysis error: ${analysisRes.status}`);
      }

      const analysisData = await analysisRes.json();
      let finalResponse = '';
      const candidate = analysisData?.candidates?.[0];
      
      // Handle initial response (might include function calls)
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            // Handle function call
            const funcName = part.functionCall.name;
            const funcArgs = part.functionCall.args;
            
            console.error(`Function call: ${funcName}(${JSON.stringify(funcArgs)})`);
            
            // Execute get_bill_details
            const details = await supabaseRpc('get_bill_details', {
              p_bill_id: funcArgs.bill_id
            }, { url: SUPABASE_URL, key: supabaseKey });
            
            // Send function result back
            const followUpRes = await fetch(analysisEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [
                  { role: 'user', parts: [{ text: analysisUserText }] },
                  { role: 'model', parts: candidate.content.parts },
                  { role: 'function', parts: [{
                    functionResponse: {
                      name: funcName,
                      response: { result: details[0] || null }
                    }
                  }]}
                ],
                generationConfig: {
                  temperature: 0.4,
                  candidateCount: 1,
                  maxOutputTokens: 32768
                },
                tools: [{ functionDeclarations }]
              })
            });
            
            const followUpData = await followUpRes.json();
            finalResponse = followUpData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } else if (part.text) {
            finalResponse += part.text;
          }
        }
      }

      // Add metadata at the end
      const metadata = {
        legislator_ids: allLegislatorIds,
        entity_ids: selectedEntityIds
      };
      
      finalResponse += `\n\n<!-- METADATA: ${JSON.stringify(metadata)} -->`;

      // Output result
      console.log(JSON.stringify({
        response: finalResponse,
        sessionId,
        messages: [
          { role: 'user', parts: [{ text: `Analyze campaign finance for ${legislatorName}` }] },
          { role: 'model', parts: [{ text: finalResponse }] }
        ],
        metadata
      }));

    } else {
      // Handle follow-up questions with function calling support
      console.error('Processing follow-up question...');
      
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
      // Add user's question to messages
      messages.push({ role: 'user', parts: [{ text: userMessage }] });
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: messages,
          generationConfig: {
            temperature: 0.3,
            candidateCount: 1,
            maxOutputTokens: 32768
          },
          tools: [{ functionDeclarations }]
        })
      });
      
      if (!res.ok) {
        throw new Error(`Gemini error: ${res.status}`);
      }
      
      const data = await res.json();
      const candidate = data?.candidates?.[0];
      let finalResponse = '';
      
      // Check for function calls
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            const funcName = part.functionCall.name;
            const funcArgs = part.functionCall.args;
            
            console.error(`Function call: ${funcName}(${JSON.stringify(funcArgs)})`);
            
            // Execute function
            const details = await supabaseRpc('get_bill_details', {
              p_bill_id: funcArgs.bill_id
            }, { url: SUPABASE_URL, key: supabaseKey });
            
            // Add function call to messages
            messages.push({ role: 'model', parts: candidate.content.parts });
            messages.push({ 
              role: 'function',
              parts: [{
                functionResponse: {
                  name: funcName,
                  response: { result: details[0] || null }
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
                  maxOutputTokens: 32768
                },
                tools: [{ functionDeclarations }]
              })
            });
            
            const followUpData = await followUpRes.json();
            finalResponse = followUpData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          } else if (part.text) {
            finalResponse = part.text;
          }
        }
      }
      
      // Add response to messages
      messages.push({ role: 'model', parts: [{ text: finalResponse }] });
      
      console.log(JSON.stringify({
        response: finalResponse,
        sessionId,
        messages
      }));
    }

  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  }
}

// Run
main().catch((err) => {
  console.error(JSON.stringify({
    error: err?.message || err,
    stack: err?.stack
  }));
  process.exit(1);
});