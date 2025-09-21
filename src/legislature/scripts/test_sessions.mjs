#!/usr/bin/env node

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

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabase = { url: supabaseUrl, key: supabaseKey };

  console.log('Testing Daniel Hernandez sessions with vote dates...\n');

  // Resolve legislator
  const resolved = await supabaseRpc('resolve_lawmaker_with_entities',
    { p_name: 'Daniel Hernandez' }, supabase);

  const legislator = resolved[0];
  const legislatorIds = legislator.all_legislator_ids || [legislator.legislator_id];

  console.log('Legislator IDs:', legislatorIds);

  // Get recent sessions
  const allSessions = await supabaseRpc('get_session_dates_calculated', {}, supabase);
  const recentSessions = allSessions
    .filter(s => s.calculated_start && s.calculated_end)
    .sort((a, b) => new Date(b.calculated_start) - new Date(a.calculated_start))
    .slice(0, 10);

  console.log('\nChecking sessions for activity...\n');

  for (const session of recentSessions) {
    try {
      const votes = await supabaseRpc('votes_with_party_outliers', {
        p_legislator_ids: legislatorIds,
        p_session_ids: [session.session_id]
      }, supabase);

      if (votes && votes.length > 0) {
        // Check what fields are available
        console.log(`Session ${session.session_id}: ${session.session_name}`);
        console.log(`  Sample vote fields:`, Object.keys(votes[0]));

        // Try different date fields
        const voteDates = votes
          .map(v => v.vote_date || v.voted_date || v.date || v.bill_date)
          .filter(d => d)
          .sort();

        console.log(`  Calculated: ${session.calculated_start} to ${session.calculated_end}`);
        if (voteDates.length > 0) {
          console.log(`  Actual votes: ${voteDates[0]} to ${voteDates[voteDates.length - 1]}`);
        }
        console.log(`  Total votes: ${votes.length}\n`);
      }
    } catch (error) {
      // Skip
    }
  }
}

main().catch(console.error);