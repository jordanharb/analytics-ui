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

async function test() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  const res = await fetch(`${url}/rest/v1/rpc/get_donations_with_relevance`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_entity_ids: [201800490], p_session_ids: [125] })
  });

  const data = await res.json();
  if (data && data.length > 0) {
    console.log('Sample donation fields:', Object.keys(data[0]));
    console.log('\nFirst donation:', JSON.stringify(data[0], null, 2));

    // Check for date fields
    const dateFields = Object.keys(data[0]).filter(k =>
      k.toLowerCase().includes('date') ||
      k.toLowerCase().includes('time') ||
      k.toLowerCase().includes('when')
    );
    console.log('\nDate-related fields found:', dateFields);

    // Check actual values
    console.log('\nDate values in first 3 donations:');
    data.slice(0, 3).forEach((d, i) => {
      console.log(`Donation ${i+1}:`, {
        donor: d.donor_name,
        amount: d.amount,
        ...dateFields.reduce((acc, field) => {
          acc[field] = d[field];
          return acc;
        }, {})
      });
    });
  }
}

test().catch(console.error);