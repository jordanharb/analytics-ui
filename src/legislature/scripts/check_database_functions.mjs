import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listDatabaseFunctions() {
  console.log('Checking database functions...\n');

  try {
    // Query to list all user-defined functions
    const { data: functions, error } = await supabase.rpc('query_raw', {
      query: `
        SELECT
          n.nspname as schema_name,
          p.proname as function_name,
          pg_get_function_arguments(p.oid) as arguments,
          t.typname as return_type,
          case p.prokind
            when 'f' then 'FUNCTION'
            when 'p' then 'PROCEDURE'
            when 'a' then 'AGGREGATE'
            when 'w' then 'WINDOW'
          end as kind
        FROM pg_proc p
        LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_type t ON t.oid = p.prorettype
        WHERE n.nspname = 'public'
        ORDER BY p.proname;
      `
    }).single();

    if (error) {
      // Try alternative approach using direct SQL
      console.log('Trying alternative approach...');
      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/get_database_functions`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        }
      );

      if (!response.ok) {
        // Try another method - query information schema
        console.log('Querying information schema...');
        const { data: routines, error: routineError } = await supabase
          .from('information_schema.routines')
          .select('routine_name, routine_type')
          .eq('routine_schema', 'public');

        if (routineError) {
          console.error('Error querying information schema:', routineError);

          // Last resort - check known functions
          console.log('\nChecking known functions by attempting to call them...');
          await checkKnownFunctions();
        } else {
          console.log('Functions found:', routines);
        }
      } else {
        const data = await response.json();
        console.log('Functions found:', data);
      }
    } else {
      console.log('Database functions found:');
      functions.forEach(fn => {
        console.log(`  - ${fn.function_name}(${fn.arguments}) -> ${fn.return_type}`);
      });
    }

  } catch (err) {
    console.error('Error listing functions:', err);
    console.log('\nChecking known functions individually...');
    await checkKnownFunctions();
  }
}

async function checkKnownFunctions() {
  const knownFunctions = [
    'resolve_lawmaker_with_entities',
    'get_session_dates_calculated',
    'get_donations_with_relevance',
    'get_bill_details',
    'get_legislator_votes_latest_only',
    'get_bill_by_number',
    'get_all_donations',
    'resolve_multiple_legislators'
  ];

  console.log('\nChecking for known functions:');

  for (const fnName of knownFunctions) {
    try {
      // Try to get function definition
      const { data, error } = await supabase.rpc('query_raw', {
        query: `
          SELECT
            proname,
            pg_get_functiondef(oid) as definition
          FROM pg_proc
          WHERE proname = '${fnName}'
          LIMIT 1;
        `
      }).single();

      if (!error && data) {
        console.log(`✓ ${fnName} - EXISTS`);
      } else {
        console.log(`✗ ${fnName} - NOT FOUND`);
      }
    } catch (err) {
      console.log(`✗ ${fnName} - ERROR checking`);
    }
  }
}

// Run the check
listDatabaseFunctions().catch(console.error);