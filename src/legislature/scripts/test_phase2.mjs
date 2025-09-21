#!/usr/bin/env node

import fs from 'fs';
import { spawn } from 'child_process';

// Read the pairing data
const pairingData = fs.readFileSync('reports/daniel_hernandez/Session_119/potential_pairings.json', 'utf8');

// Run Phase 2
const child = spawn('node', ['scripts/gemini_chat_api_session.mjs'], {
  env: {
    ...process.env,
    LEGISLATOR_NAME: 'Daniel Hernandez',
    PHASE: '2',
    SELECTED_SESSION_ID: '119',
    PAIRING_DATA: pairingData
  }
});

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
  if (code === 0) {
    try {
      const result = JSON.parse(output);
      console.log('\n=== PHASE 2 OUTPUT ===');
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error('Failed to parse output:', e.message);
    }
  } else {
    console.error('Process exited with code:', code);
  }
});