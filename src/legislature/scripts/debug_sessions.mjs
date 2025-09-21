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

  console.log('Testing Daniel Hernandez session lookup...\n');

  // Step 1: Resolve legislator
  console.log('Step 1: Resolving legislator...');
  const resolved = await supabaseRpc('resolve_lawmaker_with_entities',
    { p_name: 'Daniel Hernandez' }, supabase);

  if (!resolved || resolved.length === 0) {
    console.error('Could not resolve Daniel Hernandez');
    return;
  }

  const legislator = resolved[0];
  console.log('Found legislator:', {
    legislator_id: legislator.legislator_id,
    full_name: legislator.full_name,
    all_legislator_ids: legislator.all_legislator_ids
  });

  // Step 2: Try to get votes to find sessions
  console.log('\nStep 2: Getting votes for legislator IDs:', legislator.all_legislator_ids);

  try {
    const votes = await supabaseRpc('votes_with_party_outliers', {
      p_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],
      p_session_ids: null
    }, supabase);

    console.log('Total votes found:', votes.length);

    if (votes.length > 0) {
      // Get unique session IDs
      const sessionIds = [...new Set(votes.map(v => v.session_id))];
      console.log('Unique session IDs from votes:', sessionIds);

      // Get session details
      console.log('\nStep 3: Getting session details...');
      const allSessions = await supabaseRpc('get_session_dates_calculated', {}, supabase);
      console.log('Total sessions available:', allSessions.length);

      const legislatorSessions = allSessions.filter(s =>
        sessionIds.includes(s.session_id) && s.calculated_start && s.calculated_end
      );

      console.log('\nLegislator sessions found:', legislatorSessions.length);
      legislatorSessions.forEach(s => {
        console.log(`- Session ${s.session_id}: ${s.session_name} (${s.calculated_start} to ${s.calculated_end})`);
      });
    } else {
      console.log('No votes found for this legislator');

      // Try alternative approach - get sponsorships
      console.log('\nTrying sponsorships...');
      const sponsorships = await supabaseRpc('bill_sponsorships_for_legislator', {
        p_legislator_ids: legislator.all_legislator_ids || [legislator.legislator_id],
        p_session_ids: null
      }, supabase);

      console.log('Sponsorships found:', sponsorships.length);
      if (sponsorships.length > 0) {
        const sessionIds = [...new Set(sponsorships.map(s => s.session_id))];
        console.log('Unique session IDs from sponsorships:', sessionIds);
      }
    }
  } catch (error) {
    console.error('Error getting votes:', error.message);
  }
}

main().catch(console.error);