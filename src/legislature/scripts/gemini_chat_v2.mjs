#!/usr/bin/env node

// Gemini 2.0 Flash Thinking model for campaign finance analysis
// Uses the experimental thinking model for deep reasoning

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Basic helpers ---
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

function rlInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)));
}

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
      maxOutputTokens: 32768
    }
  };

  // Add function declarations if any
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  console.log('\n[Gemini 2.5 Pro] Processing request...');
  
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
        console.log('\n[THINKING]', part.text.substring(0, 200) + '...');
      } else if (part.functionCall) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args;
        
        if (availableFunctions[funcName]) {
          console.log(`\n[Function Call] ${funcName}(bill_id: ${funcArgs.bill_id})`);
          
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
                  console.log('\n[THINKING]', part.text.substring(0, 200) + '...');
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

AVAILABLE TOOLS:
- get_bill_details: Look up bill text/summary. USE THIS for every suspicious vote!

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

BE SPECIFIC: Always cite donor names, exact amounts, specific dates, and bill numbers.`;

// --- Main function ---
async function main() {
  // Load env
  loadEnvFromFile('.env.local');
  loadEnvFromFile('.env');

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

  const rl = rlInterface();
  
  try {
    // Get lawmaker name
    const nameRaw = (await ask(rl, 'Enter the lawmaker name (e.g., First Last): ')).trim();
    if (!nameRaw) throw new Error('Lawmaker name is required.');

    console.log('\nResolving lawmaker and finding potential entities...');
    
    // Step 1: Resolve lawmaker with potential entities
    const lawmakerData = await supabaseRpc('resolve_lawmaker_with_entities', {
      p_name: nameRaw
    }, { url: SUPABASE_URL, key: supabaseKey });

    if (!lawmakerData || lawmakerData.length === 0) {
      console.error('No matching lawmaker found.');
      process.exit(1);
    }

    const legislator = lawmakerData[0];
    console.log(`\nFound: ${legislator.full_name} (${legislator.party}) - ${legislator.body}`);
    console.log(`Potential campaign entities: ${legislator.potential_entities.length}`);

    // Step 2: Let Gemini select the correct entities using Gemini 2.5 Pro
    console.log('\n[AI] Using Gemini 2.5 Pro to match campaign committees...');
    
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

    // Parse entity IDs
    let selectedEntityIds = [];
    try {
      const parsed = JSON.parse(entityResult.response.match(/\[[\d,\s]*\]/)?.[0] || '[]');
      selectedEntityIds = parsed.filter(id => typeof id === 'number');
    } catch (e) {
      console.error('Could not parse entity selection:', e.message);
    }

    console.log(`\nSelected entity IDs: ${selectedEntityIds.join(', ') || 'none'}`);

    if (selectedEntityIds.length === 0) {
      console.log('\nNo matching campaign entities found. Exiting.');
      process.exit(0);
    }

    // Step 3: Get ALL data
    console.log('\nFetching comprehensive data...');
    
    // Sessions
    const sessions = await supabaseRpc('get_session_dates_calculated', {}, 
      { url: SUPABASE_URL, key: supabaseKey });
    const validSessions = sessions.filter(s => s.calculated_start && s.calculated_end);
    console.log(`  - ${validSessions.length} sessions`);

    // Donations - get ALL donations with pagination to avoid 1000 row limit
    const donations = await supabaseRpc('get_donations_with_relevance', {
      p_entity_ids: selectedEntityIds,
      p_session_ids: null  // Get ALL sessions to see all donations
    }, { url: SUPABASE_URL, key: supabaseKey }, { paginate: true });
    console.log(`  - ${donations.length} total donations (fetched with pagination)`);

    // Votes
    console.log('  - Fetching votes...');
    const allVotes = [];
    for (const session of validSessions) {
      try {
        const votes = await supabaseRpc('votes_with_party_outliers', {
          p_legislator_ids: [legislator.legislator_id],
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
    console.log(`  - ${allVotes.reduce((sum, s) => sum + s.votes.length, 0)} total votes`);

    // Sponsorships
    console.log('  - Fetching sponsorships...');
    const allSponsorships = [];
    for (const session of validSessions) {
      try {
        const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
          p_legislator_ids: [legislator.legislator_id],
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
    console.log(`  - ${allSponsorships.reduce((sum, s) => sum + s.sponsorships.length, 0)} total sponsorships`);

    // Prepare context - include ACTUAL donation details!
    const relevantDonations = donations.filter(d => d.is_politically_relevant);
    
    const analysisContext = {
      legislator: {
        id: legislator.legislator_id,
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

    // Step 4: Generate analysis with Gemini 2.5 Pro
    console.log('\n\n=== GEMINI 2.5 PRO ANALYSIS ===\n');
    console.log('The AI is now thinking deeply about the data...\n');
    console.log('-'.repeat(80));
    
    const analysisResult = await geminiThinkingGenerate({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-2.5-pro',
      prompt: DEEP_ANALYSIS_PROMPT,
      contextJson: analysisContext,
      temperature: 0.4,
      availableFunctions
    });

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80) + '\n');

    // Save report
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = nameRaw.replace(/[^a-z0-9]+/gi, '_');
    const outDir = path.join(process.cwd(), 'reports');
    const outPath = path.join(outDir, `${safeName}_thinking_${ts}.md`);
    
    // Build complete report with thinking
    let fullReport = `# Campaign Finance Analysis: ${nameRaw}\n\n`;
    fullReport += `Generated: ${new Date().toISOString()}\n`;
    fullReport += `Model: Gemini 2.5 Pro\n\n`;
    
    // Add thinking process if available
    if (analysisResult.thoughts && analysisResult.thoughts.length > 0) {
      fullReport += `## AI Thinking Process\n\n`;
      fullReport += `<details>\n<summary>Click to expand AI's thinking process (${analysisResult.thoughts.length} thoughts)</summary>\n\n`;
      analysisResult.thoughts.forEach((thought, i) => {
        fullReport += `### Thought ${i + 1}\n\n`;
        fullReport += thought + '\n\n';
      });
      fullReport += `</details>\n\n`;
    }
    
    fullReport += `## Analysis Report\n\n`;
    fullReport += analysisResult.response || 'No analysis generated.';
    
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, fullReport);

    console.log('===== FINAL REPORT =====\n');
    if (analysisResult.response) {
      console.log(analysisResult.response.substring(0, 3000));
      if (analysisResult.response.length > 3000) {
        console.log('\n... [Report truncated for display]');
      }
    } else {
      console.log('No analysis was generated.');
    }
    
    console.log(`\n\nFull report saved to: ${outPath}`);
    console.log(`Thinking process included: ${analysisResult.thoughts.length > 0 ? 'Yes' : 'No'}`);
    
    // ADD CHAT INTERFACE HERE
    console.log('\n' + '='.repeat(80));
    console.log('CHAT MODE - Ask follow-up questions (type "exit" to quit)');
    console.log('='.repeat(80) + '\n');
    
    // Store conversation context
    let messages = [
      { role: 'user', parts: [{ text: DEEP_ANALYSIS_PROMPT }] },
      { role: 'model', parts: [{ text: analysisResult.response }] }
    ];
    
    // Chat loop
    while (true) {
      const question = (await ask(rl, '\nYour question: ')).trim();
      
      if (question.toLowerCase() === 'exit') {
        console.log('\nGoodbye!');
        break;
      }
      
      if (!question) continue;
      
      // Add user question
      messages.push({ role: 'user', parts: [{ text: question }] });
      
      console.log('\nThinking...\n');
      
      // Get response using the existing Gemini API directly
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      
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
          tools: [{ 
            functionDeclarations: [{
              name: 'get_bill_details',
              description: 'Get detailed information about a specific bill including text and summary',
              parameters: {
                type: "object",
                properties: {
                  bill_id: { type: "integer", description: "The bill ID to fetch details for" }
                },
                required: ["bill_id"]
              }
            }]
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
            
            if (funcName === 'get_bill_details') {
              console.log(`\n[Looking up bill ${funcArgs.bill_id || funcArgs.bill_number}...]`);
              
              let details;
              
              // Try to determine if it's a bill_id (number) or bill_number (string like HB2272)
              if (funcArgs.bill_id) {
                // If bill_id looks like a bill number (contains letters), look it up by number
                if (isNaN(funcArgs.bill_id) || funcArgs.bill_id < 1000) {
                  // Likely a bill number like "HB2272" or just "2272"
                  const billNumber = funcArgs.bill_id.toString().includes('HB') || funcArgs.bill_id.toString().includes('SB') 
                    ? funcArgs.bill_id.toString() 
                    : `HB${funcArgs.bill_id}`;
                  
                  console.log(`  (Interpreting as bill number: ${billNumber})`);
                  
                  try {
                    // First try to get by bill number
                    details = await supabaseRpc('get_bill_by_number', {
                      p_bill_number: billNumber
                    }, { url: SUPABASE_URL, key: supabaseKey });
                    
                    // If not found, try with SB prefix
                    if (!details || details.length === 0) {
                      const sbNumber = `SB${funcArgs.bill_id.toString().replace(/[^0-9]/g, '')}`;
                      details = await supabaseRpc('get_bill_by_number', {
                        p_bill_number: sbNumber
                      }, { url: SUPABASE_URL, key: supabaseKey });
                    }
                  } catch (e) {
                    // Fall back to regular lookup
                    details = await supabaseRpc('get_bill_details', {
                      p_bill_id: parseInt(funcArgs.bill_id)
                    }, { url: SUPABASE_URL, key: supabaseKey });
                  }
                } else {
                  // Regular bill_id lookup
                  details = await supabaseRpc('get_bill_details', {
                    p_bill_id: funcArgs.bill_id
                  }, { url: SUPABASE_URL, key: supabaseKey });
                }
              } else if (funcArgs.bill_number) {
                // Direct bill number lookup
                details = await supabaseRpc('get_bill_by_number', {
                  p_bill_number: funcArgs.bill_number
                }, { url: SUPABASE_URL, key: supabaseKey });
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
                  tools: [{ 
                    functionDeclarations: [{
                      name: 'get_bill_details',
                      description: 'Get detailed information about a specific bill including text and summary',
                      parameters: {
                        type: "object",
                        properties: {
                          bill_id: { type: "integer", description: "The bill ID to fetch details for" }
                        },
                        required: ["bill_id"]
                      }
                    }]
                  }]
                })
              });
              
              const followUpData = await followUpRes.json();
              const chatResult = { 
                response: followUpData?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response' 
              };
              
              console.log(chatResult.response);
              messages.push({ role: 'model', parts: [{ text: chatResult.response }] });
            }
          } else if (part.text) {
            // Normal text response
            console.log(part.text);
            messages.push({ role: 'model', parts: [{ text: part.text }] });
            
            // Check if response seems cut off or incomplete
            const lastLine = part.text.trim().split('\n').pop();
            const seemsIncomplete = 
              part.text.length > 30000 || // Near token limit
              lastLine.endsWith(':') ||
              lastLine.endsWith('...') ||
              lastLine.includes('I will now') ||
              lastLine.includes('Next, I') ||
              lastLine.includes('Let me') ||
              lastLine.includes('I need to') ||
              lastLine.includes('proceed to');
            
            if (seemsIncomplete) {
              const shouldContinue = await ask(rl, '\n[Response may be incomplete. Press Enter to continue or type a message]: ');
              if (!shouldContinue || shouldContinue.trim() === '') {
                // Auto-continue
                messages.push({ role: 'user', parts: [{ text: 'Please continue with your analysis.' }] });
                
                const continueRes = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: messages,
                    generationConfig: {
                      temperature: 0.3,
                      candidateCount: 1,
                      maxOutputTokens: 32768
                    },
                    tools: [{ 
                      functionDeclarations: [{
                        name: 'get_bill_details',
                        description: 'Get detailed information about a specific bill including text and summary',
                        parameters: {
                          type: "object",
                          properties: {
                            bill_id: { type: "integer", description: "The bill ID to fetch details for" }
                          },
                          required: ["bill_id"]
                        }
                      }]
                    }]
                  })
                });
                
                const continueData = await continueRes.json();
                console.log('\n[Continuing...]\n');
                // Recursively handle the continuation
                const continuePart = continueData?.candidates?.[0]?.content?.parts?.[0];
                if (continuePart?.text) {
                  console.log(continuePart.text);
                  messages.push({ role: 'model', parts: [{ text: continuePart.text }] });
                }
              } else {
                // User typed something else, add it as a new question
                messages.push({ role: 'user', parts: [{ text: shouldContinue }] });
                continue; // This will restart the loop with the new question
              }
            }
          }
        }
      } else {
        // Fallback
        const text = candidate?.content?.parts?.[0]?.text || 'No response';
        console.log(text);
        messages.push({ role: 'model', parts: [{ text }] });
      }
    }

  } catch (error) {
    console.error('\nError occurred:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  }
  
  // Close readline at the very end
  rl.close();
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

// Run
main().catch((err) => {
  console.error('\nFatal error:', err?.message || err);
  process.exit(1);
});