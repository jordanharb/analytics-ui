#!/usr/bin/env node

// Test script to verify data is being pulled correctly for each session
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
  } catch (e) {
    // ignore
  }
}

loadEnvFromFile('.env');
loadEnvFromFile('.env.local');

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

async function testDataFlow() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabase = { url: supabaseUrl, key: supabaseKey };

  console.log('=== Testing Data Flow for Session-Specific Analysis ===\n');

  // Step 1: Resolve legislator
  console.log('Step 1: Resolving Daniel Hernandez...');
  const resolved = await supabaseRpc('resolve_lawmaker_with_entities',
    { p_name: 'Daniel Hernandez' }, supabase);

  const legislator = resolved[0];
  const legislatorIds = legislator.all_legislator_ids || [legislator.legislator_id];
  const entityIds = legislator.potential_entities
    ?.filter(e => {
      const name = e.primary_candidate_name?.toLowerCase() || '';
      return name.includes('daniel') || name.includes('hernandez');
    })
    .map(e => e.entity_id) || [];

  console.log(`  Legislator IDs: ${legislatorIds}`);
  console.log(`  Entity IDs: ${entityIds}\n`);

  // Step 2: Test specific session (Session 125 - most recent)
  const testSessionId = 125;
  console.log(`Step 2: Testing data retrieval for Session ${testSessionId}...\n`);

  // Test donations with session filter
  console.log('Testing get_donations with session filter...');
  try {
    const donations = await supabaseRpc('get_donations_with_relevance',
      { p_entity_ids: entityIds, p_session_ids: [testSessionId] },
      supabase, { paginate: true });

    console.log(`  Total donations for session ${testSessionId}: ${donations.length}`);
    if (donations.length > 0) {
      const dateRange = donations.reduce((acc, d) => {
        const date = d.date || d.donation_date;
        if (date) {
          acc.min = !acc.min || date < acc.min ? date : acc.min;
          acc.max = !acc.max || date > acc.max ? date : acc.max;
        }
        return acc;
      }, { min: null, max: null });
      console.log(`  Date range: ${dateRange.min} to ${dateRange.max}`);
      console.log(`  Sample donors: ${donations.slice(0, 3).map(d => d.donor_name).join(', ')}`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  // Test votes with session filter
  console.log('\nTesting get_votes with session filter...');
  try {
    const votes = await supabaseRpc('votes_with_party_outliers', {
      p_legislator_ids: legislatorIds,
      p_session_ids: [testSessionId]
    }, supabase);

    console.log(`  Total votes for session ${testSessionId}: ${votes.length}`);
    if (votes.length > 0) {
      const billNumbers = [...new Set(votes.slice(0, 5).map(v => v.out_bill_number))];
      console.log(`  Sample bills voted on: ${billNumbers.join(', ')}`);
      const partyOutliers = votes.filter(v => v.out_is_party_outlier);
      console.log(`  Party outlier votes: ${partyOutliers.length}`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  // Test sponsorships with session filter
  console.log('\nTesting get_sponsorships with session filter...');
  try {
    const sponsorships = await supabaseRpc('bill_sponsorships_for_legislator', {
      p_legislator_ids: legislatorIds,
      p_session_ids: [testSessionId]
    }, supabase);

    console.log(`  Total sponsorships for session ${testSessionId}: ${sponsorships.length}`);
    if (sponsorships.length > 0) {
      const billNumbers = sponsorships.slice(0, 5).map(s => s.bill_number || s.out_bill_number);
      console.log(`  Sample bills sponsored: ${billNumbers.join(', ')}`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  // Step 3: Test without session filter for comparison
  console.log('\n\nStep 3: Comparing with ALL sessions (no filter)...\n');

  console.log('Testing get_donations WITHOUT session filter...');
  try {
    const allDonations = await supabaseRpc('get_donations_with_relevance',
      { p_entity_ids: entityIds, p_session_ids: null },
      supabase, { paginate: true });

    console.log(`  Total donations across ALL sessions: ${allDonations.length}`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  console.log('\nTesting get_votes WITHOUT session filter...');
  try {
    const allVotes = await supabaseRpc('votes_with_party_outliers', {
      p_legislator_ids: legislatorIds,
      p_session_ids: null
    }, supabase);

    console.log(`  Total votes across ALL sessions: ${allVotes.length}`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  console.log('\n=== Data Flow Test Complete ===');
  console.log('\nVerification:');
  console.log('✓ Session filtering should show FEWER records than unfiltered');
  console.log('✓ Donations should be from the session timeframe');
  console.log('✓ Votes and sponsorships should be from the specific session');
}

testDataFlow().catch(console.error);