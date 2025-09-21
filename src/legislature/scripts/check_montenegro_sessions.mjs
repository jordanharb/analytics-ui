import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(dirname(__dirname), '.env.local') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkMontenegro() {
  // Get Steve Montenegro's person record - he's person_id 58
  const { data: person, error: personError } = await supabase
    .from('people')
    .select('*')
    .eq('person_id', 58)
    .single();

  if (personError || !person) {
    console.log('Could not find Montenegro (person_id 58) in people table');
    console.log('Error:', personError);
    return;
  }

  const montenegroPerson = person;
  console.log('=== STEVE MONTENEGRO SESSIONS ===\n');
  console.log('Person ID:', montenegroPerson.person_id);
  console.log('Display Name:', montenegroPerson.display_name);
  console.log('Cached Sessions in people:', montenegroPerson.cached_sessions?.length || 0);

  // Get legislators
  const { data: legislators } = await supabase
    .from('legislators')
    .select('legislator_id, session_id')
    .eq('person_id', montenegroPerson.person_id)
    .order('session_id', { ascending: false });

  const uniqueSessions = [...new Set(legislators.map(l => l.session_id))];
  console.log('\nUnique sessions from legislators table:', uniqueSessions.length);
  console.log('Session IDs from legislators:', uniqueSessions.sort((a,b) => b-a));

  // Check cached vs actual
  if (montenegroPerson.cached_sessions) {
    const cachedSessionIds = montenegroPerson.cached_sessions.map(s => s.session_id).sort((a,b) => b-a);
    console.log('\nCached session IDs in people:', cachedSessionIds);
    console.log('Cached session count:', cachedSessionIds.length);

    // Check for discrepancy
    const missingInCached = uniqueSessions.filter(id => !cachedSessionIds.includes(id));
    const extraInCached = cachedSessionIds.filter(id => !uniqueSessions.includes(id));

    if (missingInCached.length > 0) {
      console.log('\n⚠️  Sessions in legislators but NOT in cached:', missingInCached);
    }
    if (extraInCached.length > 0) {
      console.log('⚠️  Sessions in cached but NOT in legislators:', extraInCached);
    }
  }

  // Get session details
  console.log('\n=== SESSION DETAILS ===');
  const { data: sessions } = await supabase
    .from('sessions')
    .select('session_id, session_name, start_date, end_date')
    .in('session_id', uniqueSessions)
    .order('session_id', { ascending: false });

  sessions?.forEach(session => {
    console.log(`\nSession ${session.session_id}: ${session.session_name}`);
    console.log(`  Dates: ${session.start_date} to ${session.end_date}`);
  });

  // Check what the server sees
  console.log('\n=== WHAT THE SERVER WOULD SEE ===');
  console.log('When fetching person 58 (Montenegro):');
  console.log('- Cached sessions available:', montenegroPerson.cached_sessions?.length || 0);
  console.log('- Cached legislator IDs:', montenegroPerson.cached_legislator_ids?.length || 0);
  console.log('- Cached entity IDs:', montenegroPerson.cached_entity_ids?.length || 0);
}

checkMontenegro();