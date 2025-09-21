import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Parse database URL from Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Extract project ref from URL
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!projectRef) {
  console.error('Could not extract project reference from Supabase URL');
  process.exit(1);
}

// Construct direct database URL
const databaseUrl = `postgresql://postgres.${projectRef}:${supabaseKey}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

const { Client } = pg;
const client = new Client({
  connectionString: databaseUrl
});

async function listFunctions() {
  try {
    await client.connect();
    console.log('Connected to database\n');

    // List all user-defined functions
    const result = await client.query(`
      SELECT
        p.proname as function_name,
        pg_get_function_arguments(p.oid) as arguments,
        t.typname as return_type,
        case p.prokind
          when 'f' then 'FUNCTION'
          when 'p' then 'PROCEDURE'
        end as kind
      FROM pg_proc p
      LEFT JOIN pg_namespace n ON p.pronamespace = n.oid
      LEFT JOIN pg_type t ON t.oid = p.prorettype
      WHERE n.nspname = 'public'
      ORDER BY p.proname;
    `);

    console.log('Database Functions Found:');
    console.log('========================\n');

    result.rows.forEach(row => {
      console.log(`${row.kind}: ${row.function_name}`);
      console.log(`  Arguments: ${row.arguments || '(none)'}`);
      console.log(`  Returns: ${row.return_type}`);
      console.log('');
    });

    console.log(`Total functions: ${result.rows.length}`);

    // Check for specific functions needed by the app
    console.log('\n\nChecking for required functions:');
    console.log('================================\n');

    const requiredFunctions = [
      'resolve_lawmaker_with_entities',
      'get_session_dates_calculated',
      'get_donations_with_relevance',
      'get_bill_details',
      'get_legislator_votes_latest_only',
      'get_bill_by_number',
      'get_all_donations',
      'resolve_multiple_legislators'
    ];

    for (const fnName of requiredFunctions) {
      const exists = result.rows.find(r => r.function_name === fnName);
      if (exists) {
        console.log(`✓ ${fnName} - EXISTS`);
      } else {
        console.log(`✗ ${fnName} - MISSING`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);

    // Try alternate connection string format
    console.log('\nTrying alternate connection...');
    const altDatabaseUrl = `postgresql://postgres:${supabaseKey}@db.${projectRef}.supabase.co:5432/postgres`;

    const altClient = new Client({
      connectionString: altDatabaseUrl
    });

    try {
      await altClient.connect();
      console.log('Connected with alternate URL');

      const result = await altClient.query(`
        SELECT proname FROM pg_proc
        WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        LIMIT 5;
      `);

      console.log('Sample functions:', result.rows);
      await altClient.end();
    } catch (altErr) {
      console.error('Alternate connection also failed:', altErr.message);
    }
  } finally {
    await client.end();
  }
}

listFunctions().catch(console.error);