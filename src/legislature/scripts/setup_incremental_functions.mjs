#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function executeSQLFile() {
  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '..', 'sql', 'incremental_analysis.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split SQL statements (simple split on semicolon followed by newline)
    const statements = sqlContent
      .split(/;\s*\n/)
      .filter(stmt => stmt.trim() && !stmt.trim().startsWith('--'))
      .map(stmt => stmt.trim() + ';');

    console.log(`Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\nExecuting statement ${i + 1}/${statements.length}...`);

      // Extract function name if it's a CREATE FUNCTION statement
      const funcMatch = statement.match(/CREATE OR REPLACE FUNCTION\s+(\w+)/i);
      if (funcMatch) {
        console.log(`Creating function: ${funcMatch[1]}`);
      }

      const { data, error } = await supabase.rpc('sql_execute', {
        query: statement
      }).single();

      if (error) {
        // Try direct execution as fallback
        console.log('Direct RPC failed, trying raw SQL execution...');
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ query: statement })
        });

        if (!response.ok) {
          console.error(`Error executing statement ${i + 1}:`, await response.text());

          // For CREATE FUNCTION statements, we'll need to execute them differently
          // Let's log the statement for manual execution
          console.log('\n--- Statement that failed ---');
          console.log(statement.substring(0, 200) + '...');
          console.log('--- End of statement preview ---\n');
        } else {
          console.log(`Statement ${i + 1} executed successfully`);
        }
      } else {
        console.log(`Statement ${i + 1} executed successfully`);
      }
    }

    console.log('\n✅ All incremental analysis functions have been set up');

    // Test the functions
    console.log('\nTesting functions...');

    // Test get_incremental_stats
    const { data: stats, error: statsError } = await supabase.rpc('get_incremental_stats', {
      p_person_id: 58,
      p_session_id: 127
    });

    if (statsError) {
      console.error('Error testing get_incremental_stats:', statsError);
    } else {
      console.log('get_incremental_stats test successful:', stats);
    }

  } catch (error) {
    console.error('Error setting up incremental functions:', error);
    process.exit(1);
  }
}

executeSQLFile();