#!/usr/bin/env node

// Enhanced Gemini-powered CLI with improved entity matching and bill analysis
// Key improvements:
// 1. AI selects entities from last-name matches
// 2. Excludes individual donors, focuses on PACs/organizations
// 3. Can fetch bill details during analysis
// 4. Groups donations by session periods (before/during/after)

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

// --- Supabase RPC helper ---
async function supabaseRpc(fnName, args, { url, key }) {
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
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

// --- Enhanced Gemini helper with function calling ---
async function geminiGenerateWithFunctions({ 
  apiKey, 
  model = 'gemini-1.5-pro-latest', 
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
    }
  };

  // Add function declarations if any
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

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
  
  // Handle function calls if any
  const candidate = data?.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args;
        
        if (availableFunctions[funcName]) {
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
            const followUpText = followUpData?.candidates?.[0]?.content?.parts
              ?.map(p => p.text || '').join('\n');
            return followUpText?.trim();
          }
        }
      }
    }
  }
  
  // Regular text response
  const parts = candidate?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('\n');
  return text.trim();
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

Return a JSON array of ALL matching entity_ids. Example: [101373, 201600506, 201800123]
If no good matches, return empty array: []`;

const ENHANCED_ANALYSIS_PROMPT = `You are an investigative policy analyst examining potential vote-buying patterns.

Using the supplied data:
1. ENTITY MATCHING: First, identify which campaign entities belong to the legislator
2. DONATION PATTERNS: Analyze non-individual donations (PACs, organizations) grouped by legislative session periods
3. VOTE CORRELATION: Look for suspicious patterns where donations spike before key votes
4. BILL ANALYSIS: For suspicious correlations, you can request bill details to understand the legislation

Focus on:
- Large donations from PACs/organizations (individuals excluded)
- Timing relative to sessions (before/during/after)
- Votes against party line that align with donor interests
- Industry patterns in donations

For any suspicious patterns, be specific with dates, amounts, and bill numbers.
If you need bill details, request them and I'll provide the text/summary.`;

// --- Main enhanced function ---
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

    // Step 2: Let Gemini select the correct entities
    console.log('\nUsing AI to match campaign committees...');
    // Debug: Show what entities are available
    console.log('\nEntities to choose from:');
    const entities = legislator.potential_entities;
    entities.slice(0, 5).forEach(e => {
      console.log(`  ${e.entity_id}: ${e.committee_name} (Primary: ${e.primary_candidate_name})`);
    });
    
    const entitySelectionResponse = await geminiGenerateWithFunctions({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-1.5-pro-latest',
      prompt: ENTITY_SELECTION_PROMPT,
      contextJson: {
        legislator: {
          id: legislator.legislator_id,
          name: legislator.full_name,
          party: legislator.party,
          body: legislator.body
        },
        potential_entities: legislator.potential_entities
      },
      temperature: 0.1
    });

    // Parse entity IDs from Gemini response
    console.log('\nGemini response:', entitySelectionResponse);
    let selectedEntityIds = [];
    try {
      const parsed = JSON.parse(entitySelectionResponse.match(/\[[\d,\s]*\]/)?.[0] || '[]');
      selectedEntityIds = parsed.filter(id => typeof id === 'number');
    } catch (e) {
      console.error('Could not parse entity selection:', e.message);
      console.error('Raw response:', entitySelectionResponse);
    }

    console.log(`Selected entity IDs: ${selectedEntityIds.join(', ') || 'none'}`);

    // Step 3: Get calculated session dates
    console.log('\nFetching session information...');
    const sessions = await supabaseRpc('get_session_dates_calculated', {}, 
      { url: SUPABASE_URL, key: supabaseKey });
    
    // Filter to sessions with valid dates
    const validSessions = sessions.filter(s => s.calculated_start && s.calculated_end);
    console.log(`Found ${validSessions.length} sessions with calculated dates`);

    // Step 4: Get non-individual donations if entities found
    let donations = [];
    if (selectedEntityIds.length > 0) {
      console.log('\nFetching non-individual donations (PACs/Organizations only)...');
      donations = await supabaseRpc('get_non_individual_donations', {
        p_entity_ids: selectedEntityIds
      }, { url: SUPABASE_URL, key: supabaseKey });
      
      console.log(`Found ${donations.length} non-individual donations across all sessions`);
    }

    // Step 5: Get voting records for all sessions
    console.log('\nFetching voting records...');
    const allVotes = [];
    for (const session of validSessions.slice(0, 5)) { // Limit to recent 5 sessions
      try {
        const votes = await supabaseRpc('votes_with_party_outliers', {
          p_legislator_ids: [legislator.legislator_id],
          p_session_ids: [session.session_id]
        }, { url: SUPABASE_URL, key: supabaseKey });
        
        if (votes && votes.length > 0) {
          allVotes.push({ session_id: session.session_id, votes });
        }
      } catch (e) {
        // Session might not have votes
      }
    }

    // Step 6: Get bill sponsorships
    console.log('Fetching bill sponsorships...');
    const allSponsorships = [];
    for (const session of validSessions.slice(0, 5)) {
      try {
        const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
          p_legislator_ids: [legislator.legislator_id],
          p_session_ids: [session.session_id]
        }, { url: SUPABASE_URL, key: supabaseKey });
        
        if (sponsors && sponsors.length > 0) {
          allSponsorships.push({ session_id: session.session_id, sponsorships: sponsors });
        }
      } catch (e) {
        // Session might not have sponsorships
      }
    }

    // Step 7: Prepare context for analysis
    const analysisContext = {
      legislator: {
        id: legislator.legislator_id,
        name: legislator.full_name,
        party: legislator.party,
        body: legislator.body
      },
      selected_entities: selectedEntityIds,
      sessions: validSessions.slice(0, 5).map(s => ({
        id: s.session_id,
        name: s.session_name,
        start: s.calculated_start,
        end: s.calculated_end
      })),
      donations_by_period: groupDonationsByPeriod(donations, validSessions.slice(0, 5)),
      voting_records: allVotes,
      sponsorships: allSponsorships
    };

    // Function to fetch bill details on demand
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

    // Step 8: Generate comprehensive analysis
    console.log('\nGenerating comprehensive analysis with Gemini...');
    const report = await geminiGenerateWithFunctions({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-1.5-pro-latest',
      prompt: ENHANCED_ANALYSIS_PROMPT,
      contextJson: analysisContext,
      temperature: 0.3,
      availableFunctions
    });

    // Save report
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = nameRaw.replace(/[^a-z0-9]+/gi, '_');
    const outDir = path.join(process.cwd(), 'reports');
    const outPath = path.join(outDir, `${safeName}_enhanced_${ts}.md`);
    
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, `# Enhanced Analysis: ${nameRaw}\n\n${report}\n`);

    console.log('\n===== Enhanced Analysis Report =====\n');
    console.log(report);
    console.log(`\nSaved to: ${outPath}`);

  } finally {
    rl.close();
  }
}

// Helper function to group donations by session periods
function groupDonationsByPeriod(donations, sessions) {
  const grouped = {};
  
  for (const session of sessions) {
    grouped[session.session_id] = {
      session_name: session.session_name,
      before: [],
      during: [],
      after: []
    };
  }
  
  for (const donation of donations) {
    if (grouped[donation.session_id]) {
      grouped[donation.session_id][donation.period_type].push({
        donor: donation.donor_name,
        type: donation.donor_type,
        amount: donation.amount,
        date: donation.transaction_date,
        days_from_session: donation.days_from_session
      });
    }
  }
  
  return grouped;
}

// Run
main().catch((err) => {
  console.error('\nError:', err?.message || err);
  process.exit(1);
});