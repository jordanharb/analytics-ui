#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

// Get credentials from environment or hardcode for testing
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.log('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

console.log('🔍 Checking Supabase connection...');
console.log(`URL: ${supabaseUrl}`);
console.log(`Key: ${supabaseKey.substring(0, 20)}...`);

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkFunctions() {
  console.log('\n📋 Checking for functions in database...\n');

  // Try to list all functions
  try {
    const { data: functions, error } = await supabase.rpc('sql_execute', {
      query: `
        SELECT
          routine_schema,
          routine_name,
          routine_type
        FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name LIKE '%incremental%'
           OR routine_name LIKE '%analyzed%'
        ORDER BY routine_name;
      `
    });

    if (error) {
      console.log('❌ Error listing functions (trying alternative method):', error.message);

      // Alternative: Try to query pg_proc directly
      const { data: altFunctions, error: altError } = await supabase.rpc('sql_execute', {
        query: `
          SELECT
            n.nspname as schema,
            p.proname as name
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = 'public'
          AND (p.proname LIKE '%incremental%' OR p.proname LIKE '%analyzed%');
        `
      });

      if (altError) {
        console.log('❌ Alternative query also failed:', altError.message);
      } else {
        console.log('Functions found (alternative query):', altFunctions);
      }
    } else {
      console.log('✅ Functions found:', functions);
    }
  } catch (e) {
    console.log('❌ Exception querying functions:', e.message);
  }

  // Test each specific function
  const functionsToTest = [
    'get_analyzed_bills',
    'get_incremental_stats',
    'get_bills_for_incremental_analysis'
  ];

  console.log('\n🧪 Testing specific functions:\n');

  for (const funcName of functionsToTest) {
    console.log(`Testing ${funcName}...`);

    try {
      let result;

      if (funcName === 'get_analyzed_bills') {
        result = await supabase.rpc(funcName, {
          p_person_id: 58,
          p_session_id: 127
        });
      } else if (funcName === 'get_incremental_stats') {
        result = await supabase.rpc(funcName, {
          p_person_id: 58,
          p_session_id: 127
        });
      } else {
        result = await supabase.rpc(funcName, {
          p_person_id: 58,
          p_session_id: 127,
          p_exclude_analyzed: true
        });
      }

      if (result.error) {
        console.log(`  ❌ ${funcName}: ${result.error.message}`);
        if (result.error.details) {
          console.log(`     Details: ${result.error.details}`);
        }
      } else {
        console.log(`  ✅ ${funcName}: Works! Data:`, result.data);
      }
    } catch (e) {
      console.log(`  ❌ ${funcName}: Exception: ${e.message}`);
    }
  }

  // Check if reports table exists and has data
  console.log('\n📊 Checking reports table:\n');

  const { data: reportCheck, error: reportError } = await supabase
    .from('reports')
    .select('id, person_id, session_id, bill_ids')
    .eq('person_id', 58)
    .eq('session_id', 127)
    .limit(1);

  if (reportError) {
    console.log('❌ Error checking reports:', reportError.message);
  } else {
    console.log('✅ Reports table accessible');
    if (reportCheck && reportCheck.length > 0) {
      console.log(`   Found report for person 58, session 127`);
      console.log(`   Bill IDs array length: ${reportCheck[0].bill_ids?.length || 0}`);
    } else {
      console.log('   No reports found for person 58, session 127');
    }
  }

  console.log('\n💡 Suggestions:\n');
  console.log('1. If functions are missing, copy sql/incremental_analysis.sql to Supabase SQL editor');
  console.log('2. Make sure to execute ALL statements including GRANT permissions');
  console.log('3. Check that you\'re connected to the right Supabase project');
  console.log('4. Try creating a simple test function to verify permissions:\n');
  console.log('   CREATE OR REPLACE FUNCTION test_func() RETURNS TEXT AS $$');
  console.log('   BEGIN RETURN \'works\'; END; $$ LANGUAGE plpgsql;');
}

checkFunctions().catch(console.error);