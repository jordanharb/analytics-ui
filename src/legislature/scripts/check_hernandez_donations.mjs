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

console.log('Checking donations for Daniel Hernandez (entity 201600418)...\n');

// Check donations for all sessions
const res = await fetch(`${url}/rest/v1/rpc/get_donations_with_relevance`, {
  method: 'POST',
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    p_entity_ids: [201600418],
    p_session_ids: null
  })
});

const data = await res.json();
console.log(`Found ${data.length} total donations for entity 201600418`);

if (data.length > 0) {
  // Group by year
  const byYear = {};
  data.forEach(d => {
    const year = d.transaction_date?.substring(0, 4);
    if (year) {
      if (!byYear[year]) byYear[year] = { count: 0, total: 0 };
      byYear[year].count++;
      byYear[year].total += d.amount || 0;
    }
  });

  console.log('\nDonations by year:');
  Object.entries(byYear).sort().forEach(([year, stats]) => {
    console.log(`  ${year}: ${stats.count} donations, total $${stats.total.toFixed(2)}`);
  });

  // Check session 125 specifically (2022)
  const session125Donations = data.filter(d => {
    const date = new Date(d.transaction_date);
    return date >= new Date('2021-07-01') && date <= new Date('2022-12-31');
  });

  console.log(`\nDonations potentially relevant to Session 125 (2022): ${session125Donations.length}`);
  if (session125Donations.length > 0) {
    console.log('Sample donations:');
    session125Donations.slice(0, 5).forEach(d => {
      const nameParts = d.donor_name?.split('|') || [];
      const cleanName = nameParts[nameParts.length - 1] || d.donor_name;
      console.log(`  ${d.transaction_date}: $${d.amount} from ${cleanName}`);
    });
  }

  // Check other sessions
  console.log('\n--- Session 123 (2021) ---');
  const session123 = data.filter(d => {
    const date = new Date(d.transaction_date);
    return date >= new Date('2020-07-01') && date <= new Date('2021-12-31');
  });
  console.log(`Donations: ${session123.length}`);

  console.log('\n--- Session 122 (2020) ---');
  const session122 = data.filter(d => {
    const date = new Date(d.transaction_date);
    return date >= new Date('2019-07-01') && date <= new Date('2020-12-31');
  });
  console.log(`Donations: ${session122.length}`);

  console.log('\n--- Session 119 (2018) ---');
  const session119 = data.filter(d => {
    const date = new Date(d.transaction_date);
    return date >= new Date('2017-07-01') && date <= new Date('2018-12-31');
  });
  console.log(`Donations: ${session119.length}`);
}