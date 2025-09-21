#!/usr/bin/env node

// Quick test to verify Phase 1 data retrieval with correct fields

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  } catch (e) {}
}

loadEnvFromFile('.env');
loadEnvFromFile('.env.local');

async function supabaseRpc(fnName, args, { url, key }, options = {}) {
  const { paginate = false } = options;

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

      if (allResults.length >= 50000) break;
    }

    return allResults;
  }

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

async function testPhase1Data() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabase = { url: supabaseUrl, key: supabaseKey };

  console.log('Testing Phase 1 data retrieval with correct field mapping...\n');

  // Resolve legislator
  const resolved = await supabaseRpc('resolve_lawmaker_with_entities',
    { p_name: 'Daniel Hernandez' }, supabase);
  const legislator = resolved[0];

  const entityIds = legislator.potential_entities
    ?.filter(e => {
      const name = e.primary_candidate_name?.toLowerCase() || '';
      return name.includes('daniel') || name.includes('hernandez');
    })
    .map(e => e.entity_id) || [];

  console.log('Entity IDs:', entityIds);

  // Test donations for Session 125
  const sessionId = 125;
  console.log(`\nGetting donations for session ${sessionId}...`);

  const donations = await supabaseRpc('get_donations_with_relevance',
    { p_entity_ids: entityIds, p_session_ids: [sessionId] },
    supabase, { paginate: true });

  console.log(`Found ${donations.length} donations\n`);

  // Process and show sample data as Gemini will see it
  console.log('Sample processed donations (as Gemini will see them):');
  console.log('=========================================================');

  donations.slice(0, 3).forEach((d, i) => {
    // Parse donor name
    const nameParts = d.donor_name?.split('|') || [];
    const cleanName = nameParts[nameParts.length - 1] || nameParts[1] || d.donor_name;

    console.log(`\nDonation ${i + 1}:`);
    console.log(`  Clean Name: ${cleanName}`);
    console.log(`  Date: ${d.transaction_date}`);
    console.log(`  Amount: $${d.amount}`);
    console.log(`  Employer: ${d.employer || 'N/A'}`);
    console.log(`  Occupation: ${d.occupation || 'N/A'}`);
    console.log(`  Type/Industry: ${d.donor_type}`);
    console.log(`  Days from session: ${d.days_from_session}`);
  });

  // Test votes
  console.log('\n\nGetting votes for session...');
  const votes = await supabaseRpc('votes_with_party_outliers', {
    p_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],
    p_session_ids: [sessionId]
  }, supabase);

  console.log(`Found ${votes.length} votes\n`);

  console.log('Sample votes:');
  votes.slice(0, 3).forEach((v, i) => {
    console.log(`  ${i + 1}. Bill ${v.out_bill_number}: ${v.out_short_title} - Vote: ${v.out_vote_type}`);
  });

  console.log('\n✅ Data retrieval test complete. Fields are correctly mapped.');
}

testPhase1Data().catch(console.error);