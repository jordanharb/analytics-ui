#!/usr/bin/env node

// Enhanced Gemini-powered CLI with thinking model and bill analysis
// Uses Gemini 2.5 Pro for deep reasoning

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

// --- Enhanced Gemini helper with thinking and function calling ---
async function geminiGenerateWithThinking({ 
  apiKey, 
  model = 'gemini-2.5-pro', // Using Gemini 2.5 Pro with thinking
  prompt, 
  contextJson, 
  temperature = 0.3,
  availableFunctions = {},
  onThought = null  // Callback for streaming thoughts
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
      maxOutputTokens: 8192,
      responseMimeType: 'text/plain'
    }
  };

  // Add function declarations if any
  if (functionDeclarations.length > 0) {
    body.tools = [{ functionDeclarations }];
  }

  let allThoughts = [];
  let finalResponse = '';

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
  
  // Extract thinking from parts marked with thought: true
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.thought === true && part.text) {
        const thoughtText = part.text;
        allThoughts.push(thoughtText);
        if (onThought) {
          onThought(thoughtText);
        }
      }
    }
  }
  
  // Handle function calls if any
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args;
        
        if (availableFunctions[funcName]) {
          console.log(`\n[Gemini is looking up: ${funcName}(${JSON.stringify(funcArgs)})]`);
          
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
            
            // Extract any additional thoughts from parts marked with thought: true
            if (followUpCandidate?.content?.parts) {
              for (const part of followUpCandidate.content.parts) {
                if (part.thought === true && part.text) {
                  const thoughtText = part.text;
                  allThoughts.push(thoughtText);
                  if (onThought) {
                    onThought(thoughtText);
                  }
                }
              }
            }
            
            // Get the actual response text (excluding thoughts)
            const followUpText = followUpCandidate?.content?.parts
              ?.filter(p => !p.thought && p.text)
              ?.map(p => p.text).join('\n');
            finalResponse = followUpText?.trim() || '';
          }
        }
      } else if (part.text && !part.thought) {
        finalResponse += part.text;
      }
    }
  }
  
  // If no function calls, just get the text response (excluding thoughts)
  if (!finalResponse) {
    const parts = candidate?.content?.parts || [];
    finalResponse = parts
      .filter(p => !p.thought && p.text)
      .map(p => p.text)
      .join('\n').trim();
  }
  
  return {
    thoughts: allThoughts,
    response: finalResponse
  };
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

const ENHANCED_ANALYSIS_PROMPT = `You are an investigative policy analyst examining potential vote-buying patterns in Arizona politics.

AVAILABLE TOOLS:
- get_bill_details: You can look up full text and summary of any bill by its ID. USE THIS for bills that show suspicious voting patterns or timing with donations!

ANALYSIS INSTRUCTIONS:
1. First, identify the campaign entities that match this legislator
2. Analyze ALL donations (including individuals - lobbyists and consultants are especially important!)
3. Look for patterns:
   - Donation spikes before/during/after legislative sessions
   - Large donations from lobbyists, consultants, or PACs
   - Timing correlations between donations and key votes
4. For suspicious patterns, LOOK UP THE BILL DETAILS to understand what was at stake
5. Focus on politically relevant donors (marked as is_politically_relevant=true)

IMPORTANT: When you find a suspicious correlation between donations and votes/sponsorships:
- Use get_bill_details() to fetch the actual bill text and summary
- Explain what the bill does and why the donation timing is suspicious
- Be specific with dates, amounts, and bill numbers

Write a comprehensive report covering:
- Summary of legislator and their campaign committees
- Donation patterns across sessions (especially from lobbyists/PACs)
- Suspicious timing correlations
- Key bills with detailed analysis (use get_bill_details!)
- Potential conflicts of interest

Be specific and evidence-based. Use dates, amounts, and bill details.`;

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

    // Debug: Show what entities are available
    console.log('\nEntities to choose from (first 5):');
    const entities = legislator.potential_entities;
    entities.slice(0, 5).forEach(e => {
      console.log(`  ${e.entity_id}: ${e.committee_name}`);
      console.log(`    Primary candidate: ${e.primary_candidate_name}`);
    });

    // Step 2: Let Gemini select the correct entities
    console.log('\nUsing AI to match campaign committees...');
    
    let entityThoughts = [];
    const entityResult = await geminiGenerateWithThinking({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-2.5-pro',
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
      temperature: 0.1,
      onThought: (thought) => {
        console.log(`[Thinking] ${thought}`);
        entityThoughts.push(thought);
      }
    });

    // Parse entity IDs from response
    console.log('\nAI response:', entityResult.response);
    let selectedEntityIds = [];
    try {
      const parsed = JSON.parse(entityResult.response.match(/\[[\d,\s]*\]/)?.[0] || '[]');
      selectedEntityIds = parsed.filter(id => typeof id === 'number');
    } catch (e) {
      console.error('Could not parse entity selection:', e.message);
    }

    console.log(`Selected entity IDs: ${selectedEntityIds.join(', ') || 'none'}`);

    // Step 3: Get calculated session dates
    console.log('\nFetching session information...');
    const sessions = await supabaseRpc('get_session_dates_calculated', {}, 
      { url: SUPABASE_URL, key: supabaseKey });
    
    // Filter to sessions with valid dates
    const validSessions = sessions.filter(s => s.calculated_start && s.calculated_end);
    console.log(`Found ${validSessions.length} sessions with calculated dates`);

    // Step 4: Get donations with relevance if entities found
    let donations = [];
    if (selectedEntityIds.length > 0) {
      console.log('\nFetching ALL donations (including politically relevant individuals)...');
      donations = await supabaseRpc('get_donations_with_relevance', {
        p_entity_ids: selectedEntityIds
      }, { url: SUPABASE_URL, key: supabaseKey });
      
      const relevantDonations = donations.filter(d => d.is_politically_relevant);
      console.log(`Found ${donations.length} total donations, ${relevantDonations.length} politically relevant`);
    }

    // Step 5: Get voting records for recent sessions
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
      donations: groupDonationsBySession(donations, validSessions.slice(0, 5)),
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
          console.log(`\n[Fetching details for bill ${args.bill_id}...]`);
          const details = await supabaseRpc('get_bill_details', {
            p_bill_id: args.bill_id
          }, { url: SUPABASE_URL, key: supabaseKey });
          return details[0] || null;
        }
      }
    };

    // Step 8: Generate comprehensive analysis with thinking
    console.log('\n\n=== GEMINI 2.5 PRO ANALYSIS (WITH THINKING) ===\n');
    console.log('Thinking process will appear below...\n');
    console.log('-'.repeat(80));
    
    let allAnalysisThoughts = [];
    
    const analysisResult = await geminiGenerateWithThinking({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-2.5-pro',
      prompt: ENHANCED_ANALYSIS_PROMPT,
      contextJson: analysisContext,
      temperature: 0.3,
      availableFunctions,
      onThought: (thought) => {
        console.log(`\n[THINKING] ${thought}`);
        allAnalysisThoughts.push(thought);
      }
    });

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE - GENERATING REPORT');
    console.log('='.repeat(80) + '\n');

    // Save report with thoughts
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = nameRaw.replace(/[^a-z0-9]+/gi, '_');
    const outDir = path.join(process.cwd(), 'reports');
    const outPath = path.join(outDir, `${safeName}_thinking_${ts}.md`);
    
    // Build complete report with thoughts section
    let fullReport = `# Campaign Finance Analysis: ${nameRaw}\n\n`;
    fullReport += `Generated: ${new Date().toISOString()}\n\n`;
    
    if (allAnalysisThoughts.length > 0) {
      fullReport += `## AI Thinking Process\n\n`;
      fullReport += `<details>\n<summary>Click to expand thinking process</summary>\n\n`;
      allAnalysisThoughts.forEach((thought, i) => {
        fullReport += `### Thought ${i + 1}\n${thought}\n\n`;
      });
      fullReport += `</details>\n\n`;
    }
    
    fullReport += `## Analysis Report\n\n`;
    fullReport += analysisResult.response;
    
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, fullReport);

    console.log('\n===== FINAL REPORT =====\n');
    console.log(analysisResult.response);
    console.log(`\nFull report with thinking saved to: ${outPath}`);

  } finally {
    rl.close();
  }
}

// Helper function to group donations by session periods
function groupDonationsBySession(donations, sessions) {
  const grouped = {};
  
  for (const session of sessions) {
    const sessionDonations = donations.filter(d => d.ret_session_id === session.session_id);
    
    grouped[session.session_id] = {
      session_name: session.session_name,
      before: sessionDonations.filter(d => d.period_type === 'before'),
      during: sessionDonations.filter(d => d.period_type === 'during'),
      after: sessionDonations.filter(d => d.period_type === 'after'),
      summary: {
        before_total: sessionDonations.filter(d => d.period_type === 'before').reduce((sum, d) => sum + parseFloat(d.amount), 0),
        during_total: sessionDonations.filter(d => d.period_type === 'during').reduce((sum, d) => sum + parseFloat(d.amount), 0),
        after_total: sessionDonations.filter(d => d.period_type === 'after').reduce((sum, d) => sum + parseFloat(d.amount), 0),
        lobbyist_donations: sessionDonations.filter(d => d.occupation && d.occupation.toLowerCase().includes('lobbyist')),
        pac_donations: sessionDonations.filter(d => d.donor_type === 'PACs'),
        large_donations: sessionDonations.filter(d => parseFloat(d.amount) >= 1000)
      }
    };
  }
  
  return grouped;
}

// Run
main().catch((err) => {
  console.error('\nError:', err?.message || err);
  process.exit(1);
});