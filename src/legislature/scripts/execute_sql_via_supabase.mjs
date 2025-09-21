#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// The incremental analysis SQL functions
const sqlStatements = [
  // Function to get all previously analyzed bill IDs for a person
  `CREATE OR REPLACE FUNCTION get_analyzed_bills(
    p_person_id BIGINT,
    p_session_id INTEGER DEFAULT NULL
  )
  RETURNS INTEGER[] AS $$
  DECLARE
    analyzed_bill_ids INTEGER[];
  BEGIN
    IF p_session_id IS NOT NULL THEN
      -- Get bills from specific session
      SELECT COALESCE(
        array_agg(DISTINCT bill_id ORDER BY bill_id),
        ARRAY[]::INTEGER[]
      )
      INTO analyzed_bill_ids
      FROM (
        SELECT unnest(bill_ids) as bill_id
        FROM reports
        WHERE person_id = p_person_id
          AND session_id = p_session_id
          AND bill_ids IS NOT NULL
      ) bills;
    ELSE
      -- Get all bills for this person
      SELECT COALESCE(
        array_agg(DISTINCT bill_id ORDER BY bill_id),
        ARRAY[]::INTEGER[]
      )
      INTO analyzed_bill_ids
      FROM (
        SELECT unnest(bill_ids) as bill_id
        FROM reports
        WHERE person_id = p_person_id
          AND bill_ids IS NOT NULL
      ) bills;
    END IF;

    RETURN analyzed_bill_ids;
  END;
  $$ LANGUAGE plpgsql`,

  // Function to get incremental analysis statistics
  `CREATE OR REPLACE FUNCTION get_incremental_stats(
    p_person_id BIGINT,
    p_session_id INTEGER
  )
  RETURNS TABLE (
    total_bills INTEGER,
    analyzed_bills INTEGER,
    remaining_bills INTEGER,
    report_count INTEGER,
    last_analysis TIMESTAMP WITH TIME ZONE
  ) AS $$
  DECLARE
    analyzed_bill_ids INTEGER[];
    session_bill_count INTEGER;
  BEGIN
    -- Get previously analyzed bills
    analyzed_bill_ids := get_analyzed_bills(p_person_id, p_session_id);

    -- Get total bills in session (where person voted)
    SELECT COUNT(DISTINCT v.bill_id)
    INTO session_bill_count
    FROM votes v
    JOIN bills b ON v.bill_id = b.id
    WHERE v.person_id = p_person_id
      AND b.session_id = p_session_id;

    -- Return statistics
    RETURN QUERY
    SELECT
      session_bill_count as total_bills,
      array_length(analyzed_bill_ids, 1) as analyzed_bills,
      session_bill_count - COALESCE(array_length(analyzed_bill_ids, 1), 0) as remaining_bills,
      (SELECT COUNT(*) FROM reports WHERE person_id = p_person_id AND session_id = p_session_id)::INTEGER as report_count,
      (SELECT MAX(created_at) FROM reports WHERE person_id = p_person_id AND session_id = p_session_id) as last_analysis;
  END;
  $$ LANGUAGE plpgsql`,

  // Function to get bills for incremental analysis (excluding already analyzed)
  `CREATE OR REPLACE FUNCTION get_bills_for_incremental_analysis(
    p_person_id BIGINT,
    p_session_id INTEGER,
    p_exclude_analyzed BOOLEAN DEFAULT TRUE
  )
  RETURNS TABLE (
    bill_id INTEGER,
    bill_number VARCHAR,
    title TEXT,
    vote_type VARCHAR
  ) AS $$
  DECLARE
    analyzed_bill_ids INTEGER[];
  BEGIN
    IF p_exclude_analyzed THEN
      -- Get previously analyzed bills
      analyzed_bill_ids := get_analyzed_bills(p_person_id, p_session_id);
    ELSE
      analyzed_bill_ids := ARRAY[]::INTEGER[];
    END IF;

    -- Return bills that haven't been analyzed
    RETURN QUERY
    SELECT DISTINCT
      b.id as bill_id,
      b.bill_number,
      b.title,
      v.vote_text as vote_type
    FROM bills b
    JOIN votes v ON b.id = v.bill_id
    WHERE v.person_id = p_person_id
      AND b.session_id = p_session_id
      AND (
        array_length(analyzed_bill_ids, 1) IS NULL
        OR b.id != ALL(analyzed_bill_ids)
      )
    ORDER BY b.bill_number;
  END;
  $$ LANGUAGE plpgsql`,

  // Grant permissions
  `GRANT EXECUTE ON FUNCTION get_analyzed_bills TO anon`,
  `GRANT EXECUTE ON FUNCTION get_analyzed_bills TO authenticated`,
  `GRANT EXECUTE ON FUNCTION get_incremental_stats TO anon`,
  `GRANT EXECUTE ON FUNCTION get_incremental_stats TO authenticated`,
  `GRANT EXECUTE ON FUNCTION get_bills_for_incremental_analysis TO anon`,
  `GRANT EXECUTE ON FUNCTION get_bills_for_incremental_analysis TO authenticated`
];

async function executeSQLStatements() {
  console.log('🚀 Starting to execute incremental analysis SQL functions...\n');

  for (let i = 0; i < sqlStatements.length; i++) {
    const sql = sqlStatements[i];

    // Extract function or operation name for logging
    let operationName = 'SQL statement';
    if (sql.includes('CREATE OR REPLACE FUNCTION')) {
      const match = sql.match(/FUNCTION\s+(\w+)/);
      if (match) operationName = `function ${match[1]}`;
    } else if (sql.includes('GRANT')) {
      operationName = 'permissions grant';
    }

    console.log(`[${i + 1}/${sqlStatements.length}] Executing ${operationName}...`);

    try {
      // Use raw SQL execution via fetch since Supabase client doesn't directly support DDL
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          query: sql
        })
      });

      if (response.ok) {
        console.log(`  ✅ ${operationName} executed successfully`);
      } else {
        // If direct RPC doesn't work, we'll note it but continue
        console.log(`  ⚠️ Direct execution failed for ${operationName}, but this might be okay`);
        console.log(`     (Some Supabase instances don't allow DDL via RPC)`);
      }
    } catch (error) {
      console.log(`  ⚠️ Error executing ${operationName}: ${error.message}`);
    }
  }

  console.log('\n📋 Testing the functions...\n');

  try {
    // Test get_incremental_stats
    const { data: stats, error: statsError } = await supabase.rpc('get_incremental_stats', {
      p_person_id: 58,
      p_session_id: 127
    });

    if (statsError) {
      console.log('❌ get_incremental_stats test failed:', statsError.message);
      console.log('\n⚠️  The functions may need to be executed directly in Supabase SQL Editor');
      console.log('    Copy the contents of sql/incremental_analysis.sql and run in Supabase');
    } else {
      console.log('✅ get_incremental_stats test successful!');
      console.log('   Stats:', stats);
    }

    // Test get_analyzed_bills
    const { data: bills, error: billsError } = await supabase.rpc('get_analyzed_bills', {
      p_person_id: 58,
      p_session_id: 127
    });

    if (!billsError) {
      console.log('✅ get_analyzed_bills test successful!');
      console.log(`   Found ${bills ? bills.length : 0} previously analyzed bills`);
    }

  } catch (error) {
    console.log('⚠️  Testing failed:', error.message);
    console.log('\n📝 Next steps:');
    console.log('1. Go to your Supabase dashboard');
    console.log('2. Navigate to the SQL Editor');
    console.log('3. Copy the contents of sql/incremental_analysis.sql');
    console.log('4. Paste and execute in the SQL Editor');
  }

  console.log('\n✨ Done!');
}

executeSQLStatements().catch(console.error);