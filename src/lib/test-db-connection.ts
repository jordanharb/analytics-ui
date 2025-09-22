import { supabase2 } from './supabase2';

export async function testDatabaseConnection() {
  console.log('Testing database connection...');
  console.log('Supabase URL:', import.meta.env.VITE_SUPABASE2_URL || import.meta.env.VITE_SUPABASE_URL);
  
  try {
    // Test basic connection
    const { data, error } = await supabase2.from('information_schema.tables').select('table_name').limit(1);
    console.log('Basic connection test:', { data, error });
    
    // Test if the function exists
    const { data: funcData, error: funcError } = await supabase2.rpc('search_people_with_sessions', {
      p_search_term: 'test'
    });
    console.log('Function test:', { funcData, funcError });
    
    // List available functions
    const { data: functions, error: functionsError } = await supabase2
      .from('pg_proc')
      .select('proname')
      .like('proname', 'search_%')
      .limit(10);
    console.log('Available search functions:', { functions, functionsError });
    
  } catch (error) {
    console.error('Database test failed:', error);
  }
}
