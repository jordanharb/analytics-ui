import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

// Prefer the Vite key explicitly, fall back to OPENAI_API_KEY
const OPENAI_API_KEY = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const OPENAI_KEY_SOURCE = process.env.VITE_OPENAI_API_KEY
  ? 'VITE_OPENAI_API_KEY'
  : (process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : 'MISSING');
const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

const SUPABASE_URL =
  process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL ||
  process.env.CAMPAIGN_FINANCE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL;

const SUPABASE_SERVICE_KEY =
  process.env.CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY ||
  process.env.VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[test-search-bills] Missing Supabase URL or service key in environment.');
  console.error('Set one of:');
  console.error('  VITE_CAMPAIGN_FINANCE_SUPABASE_URL or CAMPAIGN_FINANCE_SUPABASE_URL or VITE_SUPABASE_URL');
  console.error('  CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY or VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const DEFAULT_PAYLOAD = {
  p_legislator_id: 1749,
  p_session_id: 119,
  p_min_text_score: 0.3,
  p_limit: 50,
  p_offset: 0,
};

let activeLegislatorId = DEFAULT_PAYLOAD.p_legislator_id;
let activeSessionId = DEFAULT_PAYLOAD.p_session_id;

async function runSearch(rawInput) {
  const trimmed = rawInput.trim();
  const terms = trimmed
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);

  // Generate embeddings for all terms in a single OpenAI call when possible
  let queryVecs = null;
  if (terms.length && OPENAI_API_KEY) {
    try {
      console.log(`[embeddings] Using key from ${OPENAI_KEY_SOURCE}`);
      const resp = await fetch(`${OPENAI_API_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: terms,
          dimensions: 1536,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        console.error('[embeddings] HTTP', resp.status, resp.statusText, errBody);
      } else {
        const json = await resp.json();
        const vectors = (json?.data || []).map((d) => d?.embedding).filter(Array.isArray);
        if (vectors.length === terms.length) {
          // PostgREST expects vector[] elements as "[v1,v2,...]"
          queryVecs = vectors.map((v) => `[${v.join(',')}]`);
          console.log(`[embeddings] Generated ${vectors.length} vectors (dim=${vectors[0]?.length ?? 'n/a'})`);
        }
      }
    } catch (e) {
      console.error('[embeddings] Error generating embeddings:', e);
    }
  } else if (!OPENAI_API_KEY) {
    console.warn('[embeddings] OPENAI_API_KEY not set; proceeding without vectors.');
  }

  const payload = {
    ...DEFAULT_PAYLOAD,
    p_legislator_id: activeLegislatorId,
    p_session_id: activeSessionId,
    p_search_terms: terms.length ? terms : null,
    p_query_vecs: queryVecs, // vector[] expected by RPC
  };

  console.log('\n--- Request Payload ---');
  console.log(JSON.stringify(payload, null, 2));

  const { data, error } = await supabase.rpc('search_bills_for_legislator_optimized', payload);

  console.log('--- Raw Response ---');
  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });

  const legislatorAnswer = await rl.question(`legislator_id [${activeLegislatorId}]: `);
  if (legislatorAnswer.trim()) {
    const parsed = Number(legislatorAnswer.trim());
    if (!Number.isFinite(parsed)) {
      console.error('Invalid legislator_id; keeping default.');
    } else {
      activeLegislatorId = parsed;
    }
  }

  const sessionAnswer = await rl.question(`session_id [${activeSessionId}]: `);
  if (sessionAnswer.trim()) {
    const parsedSession = Number(sessionAnswer.trim());
    if (!Number.isFinite(parsedSession)) {
      console.error('Invalid session_id; keeping default.');
    } else {
      activeSessionId = parsedSession;
    }
  }

  console.log('Enter bill search text (comma-separated for multiple terms). Empty line to exit.');

  while (true) {
    const answer = await rl.question('search terms> ');
    if (!answer.trim()) {
      break;
    }

    try {
      await runSearch(answer);
    } catch (err) {
      console.error('RPC call failed:', err);
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
