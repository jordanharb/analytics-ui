#!/usr/bin/env node

// Session-specific API wrapper for Gemini chat with two-phase analysis
// Phase 1: Generate bill-donation pairing list
// Phase 2: Deep dive with bill text analysis

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import readline from 'readline';

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

// Helper function to prompt user for session selection
async function promptForSession(sessions, legislatorName) {
  console.error(`\nFound ${sessions.length} legislative sessions for ${legislatorName}:\n`);

  sessions.forEach((session, index) => {
    const year = session.session_name?.match(/\d{2}/)?.[0] || '';
    const legislature = session.session_name?.match(/\d+(?:th|st|nd|rd)/)?.[0] || session.session_name;
    const special = session.session_name?.includes('Special') ? ' (Special)' : '';
    console.error(`${index + 1}. ${legislature} Legislature - ${session.session_name}${special}`);

    // Display session dates
    console.error(`   Session dates: ${session.calculated_start?.split('T')[0]} to ${session.calculated_end?.split('T')[0]}`);

    // Show vote/sponsorship count if available
    if (session.vote_count) {
      console.error(`   (${session.vote_count} votes recorded)`);
    } else if (session.sponsorship_count) {
      console.error(`   (${session.sponsorship_count} bills sponsored)`);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr
  });

  return new Promise((resolve) => {
    rl.question('\nSelect a session number to analyze: ', (answer) => {
      rl.close();
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < sessions.length) {
        resolve(sessions[index]);
      } else {
        console.error('Invalid selection. Using most recent session.');
        resolve(sessions[0]);
      }
    });
  });
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
        description: 'Get detailed information about a specific bill using its numeric ID',
        parameters: {
          type: 'object',
          properties: {
            bill_id: {
              type: 'number',
              description: 'The numeric bill ID (e.g., 69612)'
            }
          },
          required: ['bill_id']
        }
      },
      {
        name: 'get_sessions',
        description: 'Get all legislative sessions with calculated date ranges',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_legislator_sessions',
        description: 'Get all sessions a specific legislator participated in',
        parameters: {
          type: 'object',
          properties: {
            legislator_ids: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of ALL legislator IDs for this person'
            }
          },
          required: ['legislator_ids']
        }
      }
    ]
  }
];

// Execute function calls
async function executeFunctionCall(name, args, supabase) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');

  try {
    switch (name) {
      case 'resolve_legislator': {
        console.error(`[FUNCTION] Resolving legislator: ${args.name}...`);
        const data = await supabaseRpc('resolve_lawmaker_with_entities',
          { p_name: args.name }, supabase);
        if (!data || data.length === 0) {
          console.error(`[ERROR] No legislator found for: ${args.name}`);
          return { error: 'No legislator found' };
        }
        const legislator = data[0];
        const entities = legislator.potential_entities || [];

        // Filter by last name first to reduce the list
        const searchName = args.name.toLowerCase();
        const searchParts = searchName.split(' ');
        const firstName = searchParts[0];
        const lastName = searchParts[searchParts.length - 1];

        const lastNameMatches = entities.filter(e => {
          const candidateName = e.primary_candidate_name?.toLowerCase() || '';
          return candidateName.includes(lastName);
        });

        console.error(`[SUCCESS] Found legislator: ${legislator.full_name}`);
        console.error(`  - Legislator IDs: ${legislator.all_legislator_ids || [legislator.legislator_id]}`);
        console.error(`  - Found ${lastNameMatches.length} entities with last name '${lastName}'`);

        // Use Gemini Flash to select the correct entities
        console.error(`[GEMINI] Using Gemini Flash to select correct entities...`);

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
        const flashModel = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024
          }
        });

        const entityPrompt = `You are helping identify which campaign finance entities belong to ${args.name}.

Legislator Information:
- Full Name: ${legislator.full_name}
- Party: ${legislator.party}
- Body: ${legislator.body}
- Legislator IDs: ${legislator.all_legislator_ids || [legislator.legislator_id]}

Here are ALL entities with the last name "${lastName}":
${lastNameMatches.map((e, i) =>
  `${i+1}. Entity ID: ${e.entity_id}
   Candidate Name: ${e.primary_candidate_name}
   Committee: ${e.committee_name}`
).join('\n\n')}

Based on the full name, party affiliation, and context, which entity IDs belong to ${args.name}?
Some committees may only show last name but still belong to this person.
Be careful to distinguish between different people with the same last name (e.g., Daniel Hernandez vs Lydia Hernandez).

Respond with ONLY a JSON array of entity IDs that belong to ${args.name}:
Example: [201600418, 201400420]`;

        try {
          // Add timeout for Gemini Flash call
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Gemini Flash timeout')), 30000)
          );

          const result = await Promise.race([
            flashModel.generateContent(entityPrompt),
            timeoutPromise
          ]);

          // Check if we got a valid response
          if (!result || !result.response) {
            throw new Error('No response from Gemini Flash');
          }

          const response = result.response.text();

          console.error(`[GEMINI DEBUG] Raw response: ${response ? response.substring(0, 200) + '...' : '(empty response)'}`);

          // Try multiple ways to extract the JSON array
          let selectedEntityIds = [];

          // Clean response if wrapped in code block
          let cleanResponse = response.trim();
          if (cleanResponse.startsWith('```')) {
            cleanResponse = cleanResponse.replace(/```json\s*/, '').replace(/```\s*$/, '').trim();
          }

          // Method 1: Try parsing as JSON first
          try {
            const parsed = JSON.parse(cleanResponse);
            if (Array.isArray(parsed)) {
              // Convert strings to numbers if needed
              selectedEntityIds = parsed.map(id => typeof id === 'string' ? parseInt(id) : id);
            }
          } catch (e) {
            // Method 2: Try parsing original response
            try {
              const parsed = JSON.parse(response);
              if (Array.isArray(parsed)) {
                selectedEntityIds = parsed.map(id => typeof id === 'string' ? parseInt(id) : id);
              }
            } catch (e2) {
              // Method 3: Look for JSON array pattern including quoted strings
              const jsonArrayMatch = response.match(/\[[\s\S]*?\]/);
              if (jsonArrayMatch) {
                try {
                  const parsed = JSON.parse(jsonArrayMatch[0]);
                  if (Array.isArray(parsed)) {
                    selectedEntityIds = parsed.map(id => typeof id === 'string' ? parseInt(id) : id);
                  }
                } catch (e3) {
                  // Method 4: Extract numbers manually (including those in quotes)
                  const numbers = response.match(/["']?(\d{6,})["']?/g);
                  if (numbers) {
                    selectedEntityIds = numbers.map(n => parseInt(n.replace(/["']/g, '')));
                  }
                }
              }
            }
          }

          if (selectedEntityIds.length > 0) {
            console.error(`[GEMINI] Selected ${selectedEntityIds.length} entities: ${selectedEntityIds.join(', ')}`);
          } else {
            console.error(`[WARNING] Could not parse Gemini response, using fallback matching`);
            console.error(`[DEBUG] Response was: ${response}`);
            // Fallback to exact name matching
            selectedEntityIds = lastNameMatches
              .filter(e => {
                const candidateName = e.primary_candidate_name?.toLowerCase() || '';
                return candidateName.includes(firstName) && candidateName.includes(lastName);
              })
              .map(e => e.entity_id);
          }

          const matching = entities.filter(e => selectedEntityIds.includes(e.entity_id));

          // Return data with ALL legislator IDs
          return {
            legislator_id: legislator.legislator_id,  // Primary ID for display
            all_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],  // Array of ALL IDs
            full_name: legislator.full_name,
            party: legislator.party,
            body: legislator.body,
            matching_entity_ids: selectedEntityIds,
            entity_count: entities.length,
            found_entities: selectedEntityIds.length
          };
        } catch (error) {
          console.error(`[ERROR] Gemini Flash entity selection failed: ${error.message}`);
          console.error(`[FALLBACK] Using simple name matching`);

          // Fallback to simple matching
          const matching = lastNameMatches.filter(e => {
            const candidateName = e.primary_candidate_name?.toLowerCase() || '';
            return candidateName.includes(firstName) && candidateName.includes(lastName);
          });

          return {
            legislator_id: legislator.legislator_id,
            all_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],
            full_name: legislator.full_name,
            party: legislator.party,
            body: legislator.body,
            matching_entity_ids: matching.map(e => e.entity_id),
            entity_count: entities.length,
            found_entities: matching.length
          };
        }
      }

      case 'get_donations': {
        const sessionInfo = args.session_ids ? `session ${args.session_ids.join(', ')}` : 'all sessions';
        console.error(`[FUNCTION] Getting donations for ${sessionInfo}...`);
        console.error(`  - Entity IDs: ${args.entity_ids.slice(0, 5).join(', ')}${args.entity_ids.length > 5 ? '...' : ''}`);

        const donations = await supabaseRpc('get_donations_with_relevance',
          { p_entity_ids: args.entity_ids, p_session_ids: args.session_ids || null },
          supabase, { paginate: true });

        // Process donations to clean up donor names
        const processedDonations = donations.map(d => {
          // Parse donor_name which is in format: "id|LastName|FirstName|...|...|DisplayName"
          const nameParts = d.donor_name?.split('|') || [];
          const cleanName = nameParts[nameParts.length - 1] || nameParts[1] || d.donor_name;

          return {
            ...d,
            clean_donor_name: cleanName,
            date: d.transaction_date,
            industry: d.donor_type
          };
        });

        const totalAmount = processedDonations.reduce((sum, d) => sum + (d.amount || 0), 0);
        const uniqueDonors = new Set(processedDonations.map(d => d.clean_donor_name)).size;

        console.error(`[SUCCESS] Found ${processedDonations.length} donations`);
        console.error(`  - Total amount: $${totalAmount.toFixed(2)}`);
        console.error(`  - Unique donors: ${uniqueDonors}`);
        console.error(`  - Top donor types: ${Object.entries(
          processedDonations.reduce((acc, d) => {
            acc[d.donor_type] = (acc[d.donor_type] || 0) + 1;
            return acc;
          }, {})
        ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => `${type}(${count})`).join(', ')}`);

        return {
          total_count: processedDonations.length,
          donations: processedDonations.slice(0, 100), // Return first 100 for context
          summary: {
            total_amount: totalAmount,
            unique_donors: uniqueDonors,
            by_type: processedDonations.reduce((acc, d) => {
              acc[d.donor_type] = (acc[d.donor_type] || 0) + 1;
              return acc;
            }, {})
          }
        };
      }

      case 'get_votes': {
        console.error(`[FUNCTION] Getting votes for legislator IDs: ${args.legislator_ids}`);

        const sessions = args.session_ids ||
          (await supabaseRpc('get_session_dates_calculated', {}, supabase))
            .filter(s => s.calculated_start && s.calculated_end)
            .slice(0, 5)
            .map(s => s.session_id);

        console.error(`  - Checking sessions: ${sessions.join(', ')}`);

        const allVotes = [];
        let totalVoteCount = 0;
        let partyOutlierCount = 0;

        for (const sessionId of sessions) {
          const votes = await supabaseRpc('votes_with_party_outliers', {
            p_legislator_ids: args.legislator_ids || [args.legislator_id],  // Use array of IDs
            p_session_ids: [sessionId]
          }, supabase);

          if (votes && votes.length > 0) {
            const outliers = votes.filter(v => v.out_is_party_outlier).length;
            totalVoteCount += votes.length;
            partyOutlierCount += outliers;

            console.error(`  - Session ${sessionId}: ${votes.length} votes (${outliers} party outliers)`);

            allVotes.push({
              session_id: sessionId,
              votes: votes.slice(0, 20) // Limit per session
            });
          }
        }

        console.error(`[SUCCESS] Found ${totalVoteCount} total votes across ${allVotes.length} sessions`);
        console.error(`  - Party outlier votes: ${partyOutlierCount}`);

        return { sessions: allVotes, total_votes: allVotes.reduce((sum, s) => sum + s.votes.length, 0) };
      }

      case 'get_sponsorships': {
        console.error(`[FUNCTION] Getting sponsorships for legislator IDs: ${args.legislator_ids}`);

        const sessions = args.session_ids ||
          (await supabaseRpc('get_session_dates_calculated', {}, supabase))
            .filter(s => s.calculated_start && s.calculated_end)
            .slice(0, 5)
            .map(s => s.session_id);

        console.error(`  - Checking sessions: ${sessions.join(', ')}`);

        const allSponsorships = [];
        let totalBillCount = 0;

        for (const sessionId of sessions) {
          const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
            p_legislator_ids: args.legislator_ids || [args.legislator_id],  // Use array of IDs
            p_session_ids: [sessionId]
          }, supabase);

          if (sponsors && sponsors.length > 0) {
            totalBillCount += sponsors.length;
            console.error(`  - Session ${sessionId}: ${sponsors.length} bills sponsored`);

            allSponsorships.push({
              session_id: sessionId,
              sponsorships: sponsors.slice(0, 10)
            });
          }
        }

        console.error(`[SUCCESS] Found ${totalBillCount} total sponsorships across ${allSponsorships.length} sessions`);

        return { sessions: allSponsorships, total_bills: allSponsorships.reduce((sum, s) => sum + s.sponsorships.length, 0) };
      }

      case 'get_bill_details': {
        // Only accept bill_id to ensure correct session-specific bill retrieval
        if (!args.bill_id) {
          return { error: 'bill_id is required' };
        }
        console.error(`[FUNCTION] Getting bill details for ID: ${args.bill_id}`);
        const bill = await supabaseRpc('get_bill_details',
          { p_bill_id: args.bill_id }, supabase);
        return bill?.[0] || { error: `Bill not found for ID: ${args.bill_id}` };
      }

      case 'get_sessions': {
        const sessions = await supabaseRpc('get_session_dates_calculated', {}, supabase);
        return sessions.filter(s => s.calculated_start && s.calculated_end);
      }

      case 'get_legislator_sessions': {
        // Try a simpler approach - get recent sessions and check for activity
        const allSessions = await supabaseRpc('get_session_dates_calculated', {}, supabase);
        const recentSessions = allSessions
          .filter(s => s.calculated_start && s.calculated_end)
          .sort((a, b) => new Date(b.calculated_start) - new Date(a.calculated_start))
          .slice(0, 10); // Check last 10 sessions

        // For each session, check if the legislator has votes
        const sessionsWithActivity = [];
        for (const session of recentSessions) {
          try {
            const votes = await supabaseRpc('votes_with_party_outliers', {
              p_legislator_ids: args.legislator_ids,
              p_session_ids: [session.session_id]
            }, supabase);

            if (votes && votes.length > 0) {
              sessionsWithActivity.push({
                ...session,
                vote_count: votes.length
              });
            }
          } catch (error) {
            // Try sponsorships as fallback
            try {
              const sponsorships = await supabaseRpc('bill_sponsorships_for_legislator', {
                p_legislator_ids: args.legislator_ids,
                p_session_ids: [session.session_id]
              }, supabase);

              if (sponsorships && sponsorships.length > 0) {
                sessionsWithActivity.push({
                  ...session,
                  sponsorship_count: sponsorships.length
                });
              }
            } catch (e) {
              // Skip this session
            }
          }
        }

        if (sessionsWithActivity.length === 0) {
          // Return all recent sessions as fallback
          return recentSessions.slice(0, 5);
        }

        return sessionsWithActivity;
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
    const phase = process.env.PHASE || '1'; // Phase 1 or 2
    const selectedSessionId = process.env.SELECTED_SESSION_ID ? parseInt(process.env.SELECTED_SESSION_ID) : null;
    const pairingData = process.env.PAIRING_DATA ? JSON.parse(process.env.PAIRING_DATA) : null;
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

    // Create model with function calling - use 2.5-pro for both phases
    // (2.5-flash has issues with complex function calling)
    const modelName = 'gemini-2.5-pro';
    console.error(`[MODEL] Using ${modelName} for Phase ${phase}`);

    // Use lower temperature for 2.5 models for more reliable function calling
    const temperature = modelName.includes('2.5') ? 0 : 0.3;

    const model = genAI.getGenerativeModel({
      model: modelName,
      tools,
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 32768
      }
    });

    // Build conversation - filter out any function responses from history
    const messages = (sessionData?.messages || []).filter(m =>
      m.role === 'user' || m.role === 'model'
    );

    let selectedSession = null;

    if (isInitial && phase === '1') {
      // Phase 1: Generate bill-donation pairing list
      console.error('=== PHASE 1: BILL-DONATION PAIRING GENERATION ===\n');

      if (!selectedSessionId) {
        // First, resolve the legislator to get their IDs
        console.error('[PHASE 1] Resolving legislator to get IDs...');
        const resolvePrompt = `Call resolve_legislator with name="${legislatorName}" to get their legislator IDs.`;
        const resolveChat = model.startChat();
        const resolveResult = await resolveChat.sendMessage(resolvePrompt);

        let legislatorData = null;
        if (resolveResult.response.functionCalls()?.length > 0) {
          const call = resolveResult.response.functionCalls()[0];
          legislatorData = await executeFunctionCall(call.name, call.args, supabase);
        }

        if (!legislatorData || !legislatorData.all_legislator_ids) {
          throw new Error('Could not resolve legislator');
        }

        // Get sessions for this legislator
        const sessions = await executeFunctionCall('get_legislator_sessions',
          { legislator_ids: legislatorData.all_legislator_ids }, supabase);

        if (!sessions || sessions.length === 0) {
          throw new Error('No legislative sessions found for this legislator');
        }

        // Prompt user to select a session
        selectedSession = await promptForSession(sessions, legislatorName);
        console.error(`\nAnalyzing session: ${selectedSession.session_name}\n`);
      } else {
        // Use the provided session ID
        const allSessions = await executeFunctionCall('get_sessions', {}, supabase);
        selectedSession = allSessions.find(s => s.session_id === selectedSessionId);
      }

      const prompt = `You are an investigative journalist creating a COMPREHENSIVE pairing list of potential donor-bill connections for ${legislatorName} in the ${selectedSession.session_name} legislative session.

YOUR PRIMARY MISSION: Create an exhaustive list of POTENTIAL connections between donors and bills for this SPECIFIC SESSION ONLY.

SESSION DETAILS:
- Session ID: ${selectedSession.session_id}
- Session Name: ${selectedSession.session_name}
- Date Range: ${selectedSession.calculated_start} to ${selectedSession.calculated_end}

FOLLOW THESE EXACT STEPS IN ORDER:

1. Call resolve_legislator with name="${legislatorName}"
   - This will return all_legislator_ids (e.g., [1749, 1875, 2016]) and matching_entity_ids (e.g., [201600418])
   - IMPORTANT: Use the EXACT IDs returned, don't make up numbers!

2. Call get_donations with:
   - entity_ids=[EXACT matching_entity_ids from step 1]
   - session_ids=[${selectedSession.session_id}]
   - Example: entity_ids=[201600418], NOT [1, 2, 3]

3. Call get_votes with:
   - legislator_ids=[EXACT all_legislator_ids from step 1]
   - session_ids=[${selectedSession.session_id}]
   - Example: legislator_ids=[1749, 1875, 2016], NOT [1, 2]

4. Call get_sponsorships with:
   - legislator_ids=[EXACT all_legislator_ids from step 1]
   - session_ids=[${selectedSession.session_id}]
   - Example: legislator_ids=[1749, 1875, 2016], NOT [1, 2]

5. DO NOT call get_bill_details in Phase 1!
   - We will analyze bill text in Phase 2
   - For now, just identify potential connections based on:
     * Donor industry/type
     * Bill titles and categories
     * Timing of donations vs votes
     * Vote patterns (especially party outliers)

IMPORTANT FUNCTION NOTES:
- resolve_legislator: Returns all_legislator_ids (array) and matching_entity_ids. Use ALL IDs!
- get_donations: Requires entity_ids array. Returns donations with donor names, amounts, dates.
- get_votes: Requires legislator_ids array. Returns votes with out_bill_id, out_bill_number, out_short_title fields.
- get_sponsorships: Requires legislator_ids array. Returns sponsorships with bill_id, bill_number, short_title fields.
- get_bill_details: Requires bill_number string like "HB2272" or "SB1234".
- get_sessions: No parameters. Returns all legislative sessions with dates.
- CRITICAL: You MUST include the bill_id field from votes (out_bill_id) or sponsorships (bill_id) in each pairing!

PHASE 1 OUTPUT REQUIREMENTS:

Create a STRUCTURED JSON output with ALL potential donor-bill pairs:

\`\`\`json
{
  "session_info": {
    "session_id": ${selectedSession.session_id},
    "session_name": "${selectedSession.session_name}",
    "date_range": "${selectedSession.calculated_start} to ${selectedSession.calculated_end}"
  },
  "legislator_info": {
    "name": "${legislatorName}",
    "legislator_ids": [...],
    "entity_ids": [...]
  },
  "potential_pairs": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "...",
      "vote_or_sponsorship": "vote/sponsor",
      "vote_value": "Y/N",
      "vote_date": "2021-03-15",
      "is_party_outlier": false,
      "donors": [
        {
          "name": "Donor Name (use clean_donor_name field)",
          "employer": "Employer from employer field",
          "occupation": "Occupation if available",
          "type": "donor_type field (Individual/PAC/etc)",
          "amount": 500,
          "transaction_date": "2021-01-10",
          "days_from_session": 64
        }
      ],
      "connection_reason": "Why this donor might care about this bill",
      "confidence_score": 0.0-1.0
    }
  ],
  "summary_stats": {
    "total_donations": 0,
    "total_votes": 0,
    "total_sponsorships": 0,
    "high_confidence_pairs": 0,
    "medium_confidence_pairs": 0,
    "low_confidence_pairs": 0
  }
}
\`\`\`

SCORING GUIDELINES:
- High confidence (0.7-1.0): Direct industry match + large donation + close timing
- Medium confidence (0.4-0.69): Industry overlap OR timing correlation
- Low confidence (0.1-0.39): Weak connection but worth investigating

INCLUDE EVERY POSSIBLE PAIRING - we'll filter in Phase 2!

IMPORTANT:
- Create pairs for EVERY significant donor (>$100) and EVERY vote/sponsorship
- Don't filter yet - include low confidence pairs
- Focus on creating a complete dataset for Phase 2 analysis
- Output ONLY the JSON structure, no narrative text`;

      console.error(`[PHASE 1] Sending prompt to Gemini for session ${selectedSession.session_id}`);
      console.error(`[PHASE 1] Session date range: ${selectedSession.calculated_start} to ${selectedSession.calculated_end}`);

      messages.push({ role: 'user', parts: [{ text: prompt }] });
    } else if (phase === '2' && pairingData) {
      // Phase 2: Deep dive analysis with bill text
      console.error('=== PHASE 2: DEEP DIVE ANALYSIS WITH BILL TEXT ===\n');
      const highConfidencePairs = pairingData.potential_pairs
        .filter(p => p.confidence_score >= 0.5)
        .slice(0, 20); // Limit to top 20 for analysis

      const prompt = `You are an investigative journalist doing a DEEP DIVE analysis of potential donor-bill connections.

You have been given a list of ${highConfidencePairs.length} potential connections to investigate.

YOUR MISSION: Validate or reject each connection by examining the actual bill text.

FOR EACH HIGH/MEDIUM CONFIDENCE PAIR:
1. Call get_bill_details with bill_id=<the numeric bill_id from the pairing>
   - Example: get_bill_details with bill_id=69612
2. Analyze if the bill content ACTUALLY benefits the identified donors
3. Look for specific provisions that align with donor interests
4. Confirm or reject the connection based on evidence

PAIRING DATA TO ANALYZE:
${JSON.stringify(highConfidencePairs, null, 2)}

OUTPUT FORMAT:
\`\`\`json
{
  "confirmed_connections": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "...",
      "donors": [...],
      "total_donor_amount": 0,
      "vote_or_sponsorship": "vote/sponsor",
      "vote_value": "Y/N",
      "key_provisions": [
        "Specific provision that benefits donor"
      ],
      "explanation": "Detailed explanation of how this bill benefits these specific donors",
      "confidence": 0.9,
      "severity": "high/medium/low"
    }
  ],
  "rejected_connections": [
    {
      "bill_number": "HB5678",
      "reason_rejected": "Bill text shows no clear benefit to donor interests"
    }
  ],
  "session_summary": "Executive summary of the most egregious conflicts of interest found",
  "key_findings": [
    "Top 3-5 most important discoveries"
  ]
}
\`\`\`

Be thorough but focus on the most suspicious connections.
IMPORTANT: Include the bill_id field from the pairing data in each confirmed_connection!`;

      messages.push({ role: 'user', parts: [{ text: prompt }] });
    } else {
      messages.push({ role: 'user', parts: [{ text: userMessage }] });
    }

    // Start chat with function calling
    console.error('\n[GEMINI] Starting conversation with Gemini...');

    let finalResponse = '';
    let functionCalls = null;

    try {
      console.error('[DEBUG] Creating chat instance...');
      const chat = model.startChat({ history: messages.slice(0, -1) });

      console.error(`[DEBUG] Sending message (${messages[messages.length - 1].parts[0].text.length} chars)...`);

      // Add timeout for the initial message
      const messageTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Gemini chat timeout after 60s')), 60000)
      );

      const result = await Promise.race([
        chat.sendMessage(messages[messages.length - 1].parts[0].text),
        messageTimeout
      ]);

      console.error('[DEBUG] Got response from Gemini');

      // Handle function calls
      finalResponse = result.response.text();
      functionCalls = result.response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      console.error(`[GEMINI] Gemini requested ${functionCalls.length} function call(s)`);
      const functionResponseParts = [];

      for (const call of functionCalls) {
        console.error(`\n[GEMINI] Executing function: ${call.name}`);
        const responseData = await executeFunctionCall(call.name, call.args, supabase);
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: { result: responseData }
          }
        });
      }

      // Send function results back to model
      console.error('\n[GEMINI] Sending function results back to Gemini...');
      let followUp = await chat.sendMessage(functionResponseParts);
      finalResponse = followUp.response.text();

      // Continue if more function calls are needed
      let iterations = 0;
      while (followUp.response.functionCalls()?.length > 0 && iterations < 5) {
        const moreCalls = followUp.response.functionCalls();
        console.error(`[GEMINI] Gemini requested ${moreCalls.length} more function call(s) (iteration ${iterations + 1})`);
        const moreResponseParts = [];

        for (const call of moreCalls) {
          console.error(`[GEMINI] Executing function: ${call.name}`);
          const responseData = await executeFunctionCall(call.name, call.args, supabase);
          moreResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: responseData }
            }
          });
        }

        console.error('[GEMINI] Sending additional function results to Gemini...');
        followUp = await chat.sendMessage(moreResponseParts);
        finalResponse = followUp.response.text();
        iterations++;
      }

      console.error(`\n[GEMINI] Analysis complete after ${iterations + 1} round(s) of function calls`);
    } else {
      console.error('[GEMINI] No function calls needed, Gemini responded directly');
    }

    } catch (error) {
      console.error(`[ERROR] Gemini chat failed: ${error.message}`);
      throw error;
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

    const output = {
      response: finalResponse,
      sessionId,
      stats,
      messages: conversationMessages
    };

    // Add session info for phase 1
    if (phase === '1' && selectedSession) {
      output.selectedSessionId = selectedSession.session_id;
      output.selectedSessionName = selectedSession.session_name;

      // Try to parse the response to show summary
      try {
        const responseData = JSON.parse(finalResponse);
        console.error('\n[PHASE 1 COMPLETE] Summary:');
        console.error(`  - Session: ${responseData.session_info?.session_name}`);
        console.error(`  - Total potential pairs: ${responseData.potential_pairs?.length || 0}`);
        console.error(`  - High confidence: ${responseData.potential_pairs?.filter(p => p.confidence_score >= 0.7).length || 0}`);
        console.error(`  - Medium confidence: ${responseData.potential_pairs?.filter(p => p.confidence_score >= 0.4 && p.confidence_score < 0.7).length || 0}`);
        console.error(`  - Low confidence: ${responseData.potential_pairs?.filter(p => p.confidence_score < 0.4).length || 0}`);
      } catch (e) {
        // Not JSON, skip summary
      }
    }

    if (phase === '2') {
      // Try to parse the response to show summary
      try {
        const responseData = JSON.parse(finalResponse);
        console.error('\n[PHASE 2 COMPLETE] Summary:');
        console.error(`  - Confirmed connections: ${responseData.confirmed_connections?.length || 0}`);
        console.error(`  - Rejected connections: ${responseData.rejected_connections?.length || 0}`);
        if (responseData.confirmed_connections?.length > 0) {
          console.error(`  - Top confirmed bills: ${responseData.confirmed_connections.slice(0, 3).map(c => c.bill_number).join(', ')}`);
        }
      } catch (e) {
        // Not JSON, skip summary
      }
    }

    console.log(JSON.stringify(output));

  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  }
}

main().catch(console.error);