import { createClient } from '@supabase/supabase-js';

// Test database functions endpoint for Vercel
export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Testing database functions...');

    // Initialize Supabase client
    const supabaseUrl = process.env.CAMPAIGN_FINANCE_SUPABASE_URL || process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL;
    const supabaseServiceKey = process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY;

    const supabase2 = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
      }
    });

    // Test if we can list functions
    const { data: functions, error: funcError } = await supabase2
      .from('information_schema.routines')
      .select('routine_name')
      .eq('routine_type', 'FUNCTION')
      .ilike('routine_name', '%search%');

    if (funcError) {
      console.log('❌ Function query error:', funcError);
    } else {
      console.log('📋 Available search functions:', functions);
    }

    // Test a simple query to verify connection
    const { data: testData, error: testError } = await supabase2
      .from('mv_legislators_search')
      .select('*')
      .limit(1);

    if (testError) {
      console.log('❌ Table query error:', testError);
    } else {
      console.log('✅ Table query successful, sample:', testData?.[0]);
    }

    res.json({
      functions: functions || [],
      testData: testData || [],
      errors: {
        funcError: funcError?.message,
        testError: testError?.message
      }
    });
  } catch (error) {
    console.error('💥 Database test error:', error);
    res.status(500).json({ error: error.message });
  }
}