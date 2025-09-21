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
  } catch (e) {}
}

loadEnvFromFile('.env');
loadEnvFromFile('.env.local');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('Checking vote and sponsorship fields...\n');

// Get a sample vote
const voteRes = await fetch(`${url}/rest/v1/rpc/votes_with_party_outliers?limit=1`, {
  method: 'POST',
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    p_legislator_ids: [1749],
    p_session_ids: [119]
  })
});

const voteData = await voteRes.json();
if (voteData && voteData.length > 0) {
  console.log('VOTE FIELDS:');
  console.log('=============');
  Object.keys(voteData[0]).forEach(key => {
    console.log(`  ${key}: ${typeof voteData[0][key]} = ${JSON.stringify(voteData[0][key]).substring(0, 50)}`);
  });

  console.log('\nKey fields we need:');
  console.log(`  Bill ID: ${voteData[0].out_bill_id || 'NOT FOUND'}`);
  console.log(`  Bill Number: ${voteData[0].out_bill_number || 'NOT FOUND'}`);
  console.log(`  Bill Title: ${voteData[0].out_short_title || 'NOT FOUND'}`);
}

// Get a sample sponsorship
const sponsorRes = await fetch(`${url}/rest/v1/rpc/get_sponsorships?limit=1`, {
  method: 'POST',
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    p_legislator_ids: [1749],
    p_session_ids: [119]
  })
});

const sponsorData = await sponsorRes.json();
if (sponsorData && sponsorData.length > 0) {
  console.log('\nSPONSORSHIP FIELDS:');
  console.log('===================');
  Object.keys(sponsorData[0]).forEach(key => {
    console.log(`  ${key}: ${typeof sponsorData[0][key]} = ${JSON.stringify(sponsorData[0][key]).substring(0, 50)}`);
  });

  console.log('\nKey fields we need:');
  console.log(`  Bill ID: ${sponsorData[0].bill_id || 'NOT FOUND'}`);
  console.log(`  Bill Number: ${sponsorData[0].bill_number || 'NOT FOUND'}`);
  console.log(`  Bill Title: ${sponsorData[0].short_title || 'NOT FOUND'}`);
}