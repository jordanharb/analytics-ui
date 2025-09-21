#!/usr/bin/env node

// Interactive Gemini chat for campaign finance analysis
// Maintains conversation context and allows follow-up questions

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import chalk from 'chalk';

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
async function supabaseRpc(fnName, args, { url, key }, options = {}) {
  const { limit = 50000 } = options;
  
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

// --- Gemini Chat helper ---
async function geminiChat({ 
  apiKey, 
  model = 'gemini-2.5-pro',
  messages,
  availableFunctions = {}
}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  // Define function declarations
  const functionDeclarations = Object.entries(availableFunctions).map(([name, config]) => ({
    name: name,
    description: config.description,
    parameters: config.parameters
  }));

  const body = {
    contents: messages,
    generationConfig: {
      temperature: 0.3,
      candidateCount: 1,
      maxOutputTokens: 32768
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
  const candidate = data?.candidates?.[0];
  
  // Handle function calls if any
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        const funcName = part.functionCall.name;
        const funcArgs = part.functionCall.args;
        
        if (availableFunctions[funcName]) {
          console.log(chalk.cyan(`\n📊 Looking up: ${funcName}(${JSON.stringify(funcArgs)})`));
          
          // Execute the function
          const result = await availableFunctions[funcName].handler(funcArgs);
          
          // Add function response to messages
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
              generationConfig: body.generationConfig,
              tools: body.tools
            })
          });
          
          if (followUpRes.ok) {
            const followUpData = await followUpRes.json();
            const followUpText = followUpData?.candidates?.[0]?.content?.parts
              ?.map(p => p.text || '').join('\n');
            return { 
              response: followUpText?.trim(), 
              updatedMessages: messages 
            };
          }
        }
      }
    }
  }
  
  // Regular text response
  const parts = candidate?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('\n');
  
  // Add assistant response to messages
  messages.push({ 
    role: 'model', 
    parts: [{ text: text.trim() }] 
  });
  
  return { 
    response: text.trim(), 
    updatedMessages: messages 
  };
}

// --- Load legislator data ---
async function loadLegislatorData(legislatorName, { url, key, apiKey }) {
  console.log(chalk.gray('\n⏳ Loading legislator data...'));
  
  // Get legislator info
  const lawmakerData = await supabaseRpc('resolve_lawmaker_with_entities', {
    p_name: legislatorName
  }, { url, key });

  if (!lawmakerData || lawmakerData.length === 0) {
    throw new Error('No matching lawmaker found.');
  }

  const legislator = lawmakerData[0];
  console.log(chalk.green(`✓ Found: ${legislator.full_name} (${legislator.party}) - ${legislator.body}`));
  console.log(chalk.gray(`  Found ${legislator.potential_entities.length} potential campaign entities`));
  
  // Use Gemini to select the correct entities (like the working version does!)
  console.log(chalk.gray('  Using AI to match campaign committees...'));
  
  const ENTITY_SELECTION_PROMPT = `Given the legislator information and potential campaign entities, identify ALL entity IDs that belong to this legislator's campaign committees.

CRITICAL: Look at the 'primary_candidate_name' field - this should match the legislator's name!

Match based on:
1. primary_candidate_name matches the legislator's name (most important!)
2. Party alignment
3. Office type matches
4. Include ALL committees from different years/elections

Return ONLY a JSON array of matching entity_ids. Example: [101373, 201600506]
If no matches, return empty array: []

DATA:
${JSON.stringify({
    legislator: {
      name: legislator.full_name,
      party: legislator.party,
      body: legislator.body
    },
    potential_entities: legislator.potential_entities.slice(0, 20)
  }, null, 2)}`;
  
  const entityResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: ENTITY_SELECTION_PROMPT }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      })
    }
  );
  
  const entityData = await entityResponse.json();
  const entityText = entityData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  
  console.log(chalk.gray(`  AI response: ${entityText.substring(0, 100)}...`));
  
  let entityIds = [];
  try {
    const parsed = JSON.parse(entityText.match(/\[[\d,\s]*\]/)?.[0] || '[]');
    entityIds = parsed.filter(id => typeof id === 'number');
    console.log(chalk.gray(`  Parsed entity IDs: ${entityIds}`));
  } catch (e) {
    console.error('Could not parse entity selection:', e.message);
  }
  
  if (entityIds.length === 0) {
    console.log(chalk.yellow('⚠ No matching campaign entities found'));
    return { legislator, data: {} };
  }
  
  console.log(chalk.green(`✓ Campaign entities: ${entityIds.join(', ')}`));
  
  // Load all data
  console.log(chalk.gray('⏳ Loading donation and voting data...'));
  
  // Sessions
  const sessions = await supabaseRpc('get_session_dates_calculated', {}, { url, key });
  const validSessions = sessions.filter(s => s.calculated_start && s.calculated_end);
  
  // Donations
  const donations = await supabaseRpc('get_donations_with_relevance', {
    p_entity_ids: entityIds
  }, { url, key }, { limit: 100000 });
  
  // Votes
  const allVotes = [];
  for (const session of validSessions) {
    try {
      const votes = await supabaseRpc('votes_with_party_outliers', {
        p_legislator_ids: [legislator.legislator_id],
        p_session_ids: [session.session_id]
      }, { url, key });
      
      if (votes && votes.length > 0) {
        allVotes.push({ 
          session_id: session.session_id, 
          session_name: session.session_name,
          votes 
        });
      }
    } catch (e) {
      // Silent
    }
  }
  
  // Sponsorships
  const allSponsorships = [];
  for (const session of validSessions) {
    try {
      const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
        p_legislator_ids: [legislator.legislator_id],
        p_session_ids: [session.session_id]
      }, { url, key });
      
      if (sponsors && sponsors.length > 0) {
        allSponsorships.push({ 
          session_id: session.session_id,
          session_name: session.session_name,
          sponsorships: sponsors 
        });
      }
    } catch (e) {
      // Silent
    }
  }
  
  console.log(chalk.green(`✓ Loaded ${donations.length} donations, ${allVotes.reduce((s, v) => s + v.votes.length, 0)} votes, ${allSponsorships.reduce((s, v) => s + v.sponsorships.length, 0)} sponsorships`));
  
  return {
    legislator,
    data: {
      entityIds,
      sessions: validSessions,
      donations,
      votes: allVotes,
      sponsorships: allSponsorships
    }
  };
}

// --- Main chat loop ---
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
  
  console.log(chalk.bold.cyan('\n🤖 Campaign Finance Analysis Chat'));
  console.log(chalk.gray('Type "exit" to quit, "new" to analyze a different legislator\n'));
  
  let currentLegislator = null;
  let currentData = null;
  let messages = [];
  
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
  
  try {
    // Get initial legislator
    const nameRaw = (await ask(rl, chalk.yellow('Enter legislator name: '))).trim();
    if (!nameRaw) {
      console.log(chalk.red('No name provided. Exiting.'));
      return;
    }
    
    // Load data
    const result = await loadLegislatorData(nameRaw, { 
      url: SUPABASE_URL, 
      key: supabaseKey,
      apiKey: GEMINI_API_KEY 
    });
    currentLegislator = result.legislator;
    currentData = result.data;
    
    // Use the full deep analysis prompt for initial report
    const INITIAL_ANALYSIS_PROMPT = `You are an investigative journalist finding SPECIFIC connections between DONORS and VOTES across ALL legislative sessions.

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

BE SPECIFIC: Always cite donor names, exact amounts, specific dates, and bill numbers.

DATA FOR ${currentLegislator.full_name} (${currentLegislator.party}-${currentLegislator.body}):
${toJSON({
  legislator: {
    id: currentLegislator.legislator_id,
    name: currentLegislator.full_name,
    party: currentLegislator.party,
    body: currentLegislator.body
  },
  selected_entities: currentData.entityIds,
  sessions: currentData.sessions?.map(s => ({
    id: s.session_id,
    name: s.session_name,
    start: s.calculated_start,
    end: s.calculated_end
  })),
  donations: {
    all_politically_relevant: currentData.donations?.filter(d => d.is_politically_relevant).map(d => ({
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
    summary_by_year: groupDonationsByYear(currentData.donations || [])
  },
  voting_records: currentData.votes,
  sponsorships: currentData.sponsorships
})}`;
    
    messages.push({ 
      role: 'user', 
      parts: [{ text: INITIAL_ANALYSIS_PROMPT }] 
    });
    
    console.log(chalk.cyan('\n🤖: Generating comprehensive analysis of donor-vote connections...\n'));
    console.log(chalk.gray('This may take a few minutes as I analyze all sessions and connections...\n'));
    
    // Get initial comprehensive analysis
    const initialResult = await geminiChat({
      apiKey: GEMINI_API_KEY,
      messages: messages,
      availableFunctions
    });
    
    messages = initialResult.updatedMessages;
    console.log(chalk.cyan(`\n${initialResult.response}\n`));
    console.log(chalk.green('\n✓ Initial analysis complete. You can now ask follow-up questions.\n'));
    
    // Chat loop
    while (true) {
      const input = (await ask(rl, chalk.yellow('You: '))).trim();
      
      if (input.toLowerCase() === 'exit') {
        break;
      }
      
      if (input.toLowerCase() === 'new') {
        // Reset and get new legislator
        const newName = (await ask(rl, chalk.yellow('Enter new legislator name: '))).trim();
        if (newName) {
          const result = await loadLegislatorData(newName, { 
            url: SUPABASE_URL, 
            key: supabaseKey,
            apiKey: GEMINI_API_KEY 
          });
          currentLegislator = result.legislator;
          currentData = result.data;
          messages = []; // Reset conversation
          console.log(chalk.cyan(`\n🤖: Loaded data for ${currentLegislator.full_name}. What would you like to investigate?\n`));
        }
        continue;
      }
      
      if (input.toLowerCase() === 'save') {
        // Save conversation to file
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const safeName = currentLegislator.full_name.replace(/[^a-z0-9]+/gi, '_');
        const outPath = path.join(process.cwd(), 'reports', `${safeName}_chat_${ts}.md`);
        
        let content = `# Campaign Finance Chat: ${currentLegislator.full_name}\n\n`;
        content += `Generated: ${new Date().toISOString()}\n\n`;
        
        for (let i = 2; i < messages.length; i++) {
          if (messages[i].role === 'user') {
            content += `## Q: ${messages[i].parts[0].text}\n\n`;
          } else if (messages[i].role === 'model') {
            content += `${messages[i].parts[0].text}\n\n`;
          }
        }
        
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, content);
        console.log(chalk.green(`\n✓ Saved to: ${outPath}\n`));
        continue;
      }
      
      // Add user message
      messages.push({ 
        role: 'user', 
        parts: [{ text: input }] 
      });
      
      // Add full data context for detailed questions
      if (input.toLowerCase().includes('donor') || input.toLowerCase().includes('vote') || input.toLowerCase().includes('sponsor')) {
        const detailedContext = {
          donations: currentData.donations?.slice(0, 500).map(d => ({
            donor: d.donor_name,
            amount: d.amount,
            date: d.transaction_date,
            type: d.donor_type,
            occupation: d.occupation,
            employer: d.employer
          })),
          recent_votes: currentData.votes?.slice(0, 3),
          recent_sponsorships: currentData.sponsorships?.slice(0, 3)
        };
        
        messages.push({ 
          role: 'user', 
          parts: [{ text: `DETAILED DATA:\n${toJSON(detailedContext)}` }] 
        });
      }
      
      console.log(chalk.gray('\n⏳ Thinking...'));
      
      // Get response
      const result = await geminiChat({
        apiKey: GEMINI_API_KEY,
        messages: messages,
        availableFunctions
      });
      
      messages = result.updatedMessages;
      
      console.log(chalk.cyan(`\n🤖: ${result.response}\n`));
    }
    
  } finally {
    rl.close();
  }
}

// Helper function
function groupDonationsByYear(donations) {
  const grouped = {};
  for (const d of donations) {
    const year = new Date(d.transaction_date).getFullYear();
    if (!grouped[year]) grouped[year] = { count: 0, total: 0 };
    grouped[year].count++;
    grouped[year].total += parseFloat(d.amount || 0);
  }
  return grouped;
}

// Run
main().catch((err) => {
  console.error(chalk.red('\n❌ Error:'), err?.message || err);
  process.exit(1);
});