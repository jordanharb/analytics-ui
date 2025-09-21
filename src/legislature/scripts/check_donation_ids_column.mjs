import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(dirname(__dirname), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTableStructure() {
  try {
    // Get column information
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: 'rs_analysis_reports' })
      .single();

    if (columnsError) {
      // Try alternative approach using raw SQL
      console.log('Trying alternative approach...');

      const { data, error } = await supabase
        .from('rs_analysis_reports')
        .select('*')
        .limit(0);

      if (error) {
        console.error('Error fetching table structure:', error);
      } else {
        // Get column names from the empty result
        console.log('\nTable columns in rs_analysis_reports:');
        if (data && Array.isArray(data)) {
          const sampleRow = { ...data[0] };
          const columnNames = Object.keys(sampleRow || {});

          if (columnNames.length === 0) {
            // Try to get actual table structure
            const { data: testData, error: testError } = await supabase
              .from('rs_analysis_reports')
              .select('*')
              .limit(1);

            if (!testError && testData && testData.length > 0) {
              console.log('Columns found:', Object.keys(testData[0]));
              console.log('\ndonation_ids column exists:', 'donation_ids' in testData[0]);
            } else {
              // Use information_schema directly via SQL
              const { data: schemaData, error: schemaError } = await supabase.rpc('get_columns_info');

              if (!schemaError && schemaData) {
                console.log('Column information:', schemaData);
              } else {
                console.log('Could not retrieve column information');
              }
            }
          } else {
            console.log('Columns:', columnNames);
            console.log('\ndonation_ids column exists:', columnNames.includes('donation_ids'));
          }
        }
      }
    } else {
      console.log('Table columns:', columns);
    }

    // Check if the function exists and its signature
    console.log('\n\nChecking save_analysis_report function...');
    const { data: functions, error: funcError } = await supabase.rpc('get_function_info');

    if (!funcError && functions) {
      console.log('Function information:', functions);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// Create helper RPC functions if they don't exist
async function createHelperFunctions() {
  try {
    // Create function to get column info
    const createColumnInfoFunc = `
      CREATE OR REPLACE FUNCTION get_columns_info()
      RETURNS TABLE(
        column_name text,
        data_type text,
        is_nullable text,
        column_default text
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT
          c.column_name::text,
          c.data_type::text,
          c.is_nullable::text,
          c.column_default::text
        FROM information_schema.columns c
        WHERE c.table_name = 'rs_analysis_reports'
          AND c.table_schema = 'public'
        ORDER BY c.ordinal_position;
      END;
      $$ LANGUAGE plpgsql;
    `;

    // Create function to get function parameter info
    const createFunctionInfoFunc = `
      CREATE OR REPLACE FUNCTION get_function_info()
      RETURNS TABLE(
        function_name text,
        parameter_names text[],
        parameter_types text[]
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT
          p.proname::text as function_name,
          array_agg(a.argname::text ORDER BY a.argposition) as parameter_names,
          array_agg(format_type(a.argtype, NULL) ORDER BY a.argposition) as parameter_types
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN LATERAL unnest(p.proargtypes, p.proargnames)
          WITH ORDINALITY AS a(argtype, argname, argposition) ON true
        WHERE n.nspname = 'public'
          AND p.proname = 'save_analysis_report'
        GROUP BY p.proname, p.oid;
      END;
      $$ LANGUAGE plpgsql;
    `;

    console.log('Creating helper functions...');

    // Note: Supabase client doesn't support direct DDL execution
    // You'll need to run these in the Supabase SQL editor
    console.log('\nPlease run these SQL commands in Supabase SQL editor:');
    console.log(createColumnInfoFunc);
    console.log(createFunctionInfoFunc);

  } catch (error) {
    console.error('Error creating helper functions:', error);
  }
}

// Run the check
console.log('Checking rs_analysis_reports table structure...\n');
await checkTableStructure();