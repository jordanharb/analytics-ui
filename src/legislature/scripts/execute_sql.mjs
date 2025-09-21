import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function executeSQLViaSupabase(query) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/rpc/execute_sql`,
    {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to execute SQL: ${response.status} - ${errorText}`);
  }

  return response.json();
}

async function listFunctions() {
  console.log('Listing database functions via Supabase...\n');

  const queries = [
    // List all functions
    `SELECT proname as function_name
     FROM pg_proc
     WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
     ORDER BY proname;`,

    // Check specific tables exist
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
     AND table_name IN ('bills', 'legislators', 'votes', 'sessions', 'cf_entities', 'cf_transactions')
     ORDER BY table_name;`,
  ];

  for (const query of queries) {
    try {
      console.log('Executing:', query.substring(0, 50) + '...');
      const result = await executeSQLViaSupabase(query);
      console.log('Result:', result);
      console.log('\n');
    } catch (err) {
      console.error('Error:', err.message);
      console.log('\n');
    }
  }
}

// Try a different approach - check tables and functions via REST API
async function checkViaRestAPI() {
  console.log('\nChecking tables via REST API...\n');

  const tables = ['bills', 'legislators', 'sessions', 'votes', 'cf_entities', 'cf_transactions'];

  for (const table of tables) {
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
        {
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          }
        }
      );

      if (response.ok) {
        console.log(`✓ Table '${table}' exists and is accessible`);
      } else {
        console.log(`✗ Table '${table}' - Status: ${response.status}`);
      }
    } catch (err) {
      console.log(`✗ Table '${table}' - Error: ${err.message}`);
    }
  }
}

// Run both checks
async function main() {
  await checkViaRestAPI();

  console.log('\n\nNow checking if we can create the missing functions...');
  console.log('Based on the endpoint errors, the following SQL functions need to be created:\n');

  const missingFunctions = [
    'get_bill_details',
    'get_session_dates_calculated',
    'get_donations_with_relevance',
    'resolve_lawmaker_with_entities',
    'get_legislator_votes_latest_only'
  ];

  for (const fn of missingFunctions) {
    console.log(`- ${fn}`);
  }

  console.log('\nSQL files containing these functions have been identified in:');
  console.log('- sql/complete_functions.sql');
  console.log('- sql/optimized_votes_function.sql');
}

main().catch(console.error);