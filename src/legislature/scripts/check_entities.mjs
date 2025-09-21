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

async function checkEntities() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  console.log('Fetching entity IDs from cf_entities...\n');

  const res = await fetch(`${url}/rest/v1/cf_entities?select=entity_id,primary_candidate_name,primary_committee_name&order=entity_id.asc&limit=20`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    console.error('Failed to fetch:', res.status, res.statusText);
    const text = await res.text();
    console.error('Response:', text);
    return;
  }

  const data = await res.json();

  console.log(`Found ${data.length} entities:\n`);
  console.log('Entity ID | Candidate Name | Committee Name');
  console.log('----------|----------------|---------------');

  data.forEach(entity => {
    console.log(
      `${String(entity.entity_id).padEnd(9)} | ` +
      `${(entity.primary_candidate_name || 'N/A').substring(0, 30).padEnd(14)} | ` +
      `${(entity.primary_committee_name || 'N/A').substring(0, 40)}`
    );
  });

  if (data.length > 0) {
    console.log(`\nTest the candidate page with: http://localhost:3000/candidate/${data[0].entity_id}`);
  }
}

checkEntities().catch(console.error);