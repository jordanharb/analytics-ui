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

  console.log('Checking donation fields from get_donations_with_relevance...\n');

  // Try with multiple entity IDs
  const entityIds = [201800490, 201800416, 201800160, 201600506];

  const res = await fetch(`${url}/rest/v1/rpc/get_donations_with_relevance?limit=10`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_entity_ids: entityIds,
      p_session_ids: null  // Try without session filter first
    })
  });

  const data = await res.json();

  if (!data || data.length === 0) {
    console.log('No donations found');
    return;
  }

  console.log(`Found ${data.length} donations\n`);

  // Show all fields available
  console.log('All available fields:');
  console.log(Object.keys(data[0]).join(', '));
  console.log('\n');

  // Show first donation with all fields
  console.log('First donation (all fields):');
  console.log(JSON.stringify(data[0], null, 2));
  console.log('\n');

  // Look for the fields we need
  console.log('Looking for the fields we need:');
  console.log('===============================');

  // Try to identify date fields
  const possibleDateFields = Object.keys(data[0]).filter(k =>
    k.toLowerCase().includes('date') ||
    k.toLowerCase().includes('time') ||
    k.toLowerCase().includes('when') ||
    k.toLowerCase().includes('created') ||
    k.toLowerCase().includes('updated')
  );
  console.log('Possible date fields:', possibleDateFields);

  // Try to identify name fields
  const possibleNameFields = Object.keys(data[0]).filter(k =>
    k.toLowerCase().includes('name') ||
    k.toLowerCase().includes('donor')
  );
  console.log('Possible name fields:', possibleNameFields);

  // Try to identify employer fields
  const possibleEmployerFields = Object.keys(data[0]).filter(k =>
    k.toLowerCase().includes('employer') ||
    k.toLowerCase().includes('company') ||
    k.toLowerCase().includes('organization') ||
    k.toLowerCase().includes('org')
  );
  console.log('Possible employer fields:', possibleEmployerFields);

  // Try to identify industry fields
  const possibleIndustryFields = Object.keys(data[0]).filter(k =>
    k.toLowerCase().includes('industry') ||
    k.toLowerCase().includes('sector') ||
    k.toLowerCase().includes('type') ||
    k.toLowerCase().includes('category')
  );
  console.log('Possible industry fields:', possibleIndustryFields);

  console.log('\n');
  console.log('Sample of first 3 donations with key fields:');
  console.log('=============================================');

  data.slice(0, 3).forEach((d, i) => {
    console.log(`\nDonation ${i + 1}:`);
    // Try different field names
    console.log(`  Donor Name: ${d.donor_name || d.name || d.contributor_name || 'NOT FOUND'}`);
    console.log(`  Amount: ${d.amount || d.donation_amount || 'NOT FOUND'}`);
    console.log(`  Date: ${d.date || d.donation_date || d.created_at || 'NOT FOUND'}`);
    console.log(`  Employer: ${d.employer || d.employer_name || d.organization || 'NOT FOUND'}`);
    console.log(`  Industry: ${d.industry || d.sector || d.donor_type || 'NOT FOUND'}`);
    console.log(`  Type: ${d.donor_type || d.contribution_type || 'NOT FOUND'}`);
  });
}

test().catch(console.error);