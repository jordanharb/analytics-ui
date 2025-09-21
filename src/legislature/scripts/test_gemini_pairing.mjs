#!/usr/bin/env node

// Quick test to verify Gemini is creating pairings properly

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

console.log('Testing Session 119 pairing generation...\n');

// Run the analysis
const { spawn } = await import('child_process');

const child = spawn('node', ['scripts/gemini_chat_api_session.mjs'], {
  env: {
    ...process.env,
    LEGISLATOR_NAME: 'Daniel Hernandez',
    IS_INITIAL: 'true',
    PHASE: '1'
  }
});

// Provide session selection
child.stdin.write('7\n');
child.stdin.end();

let output = '';
let error = '';

child.stdout.on('data', (data) => {
  output += data.toString();
});

child.stderr.on('data', (data) => {
  error += data.toString();
  process.stderr.write(data);
});

child.on('close', (code) => {
  if (code !== 0) {
    console.error('Process exited with code:', code);
    return;
  }

  try {
    const result = JSON.parse(output);
    const response = JSON.parse(result.response.replace(/```json\n/, '').replace(/\n```/, ''));

    console.log('\n=== ANALYSIS RESULTS ===');
    console.log(`Session: ${response.session_info.session_name}`);
    console.log(`Date Range: ${response.session_info.date_range}`);
    console.log('\nSummary Stats:');
    console.log(`  Total Donations: ${response.summary_stats.total_donations}`);
    console.log(`  Total Votes: ${response.summary_stats.total_votes}`);
    console.log(`  Total Sponsorships: ${response.summary_stats.total_sponsorships}`);
    console.log(`  Potential Pairs Found: ${response.potential_pairs.length}`);
    console.log(`    - High confidence: ${response.summary_stats.high_confidence_pairs}`);
    console.log(`    - Medium confidence: ${response.summary_stats.medium_confidence_pairs}`);
    console.log(`    - Low confidence: ${response.summary_stats.low_confidence_pairs}`);

    if (response.potential_pairs.length > 0) {
      console.log('\n=== TOP PAIRINGS ===');
      response.potential_pairs
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, 3)
        .forEach(pair => {
          console.log(`\n${pair.bill_number}: ${pair.bill_title}`);
          console.log(`  Vote/Sponsor: ${pair.vote_or_sponsorship} ${pair.vote_value || ''}`);
          console.log(`  Confidence: ${pair.confidence_score}`);
          console.log(`  Donors: ${pair.donors.map(d => `${d.name} ($${d.amount})`).join(', ')}`);
          console.log(`  Reason: ${pair.connection_reason}`);
        });
    }
  } catch (e) {
    console.error('Failed to parse output:', e.message);
    console.log('Raw output:', output);
  }
});