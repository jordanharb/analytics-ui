#!/usr/bin/env node

// Minimal Gemini-powered CLI that:
// 1) Prompts for a lawmaker name (and optional settings)
// 2) Calls Supabase RPC endpoints to compile structured data
// 3) Sends data + instructions to Gemini to produce a narrative report
// 4) Prints to stdout and writes to reports/<name>_<timestamp>.md

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Basic helpers ---
function loadEnvFromFile(envPath) {
  try {
    const full = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
    if (!fs.existsSync(full)) return;
    const text = fs.readFileSync(full, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    // ignore
  }
}

function getEnv(keys, { requireAll = true } = {}) {
  const out = {};
  for (const k of keys) {
    out[k] = process.env[k];
    if (!out[k] && requireAll) throw new Error(`Missing required env var: ${k}`);
  }
  return out;
}

function rlInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)));
}

function toJSON(obj) {
  return JSON.stringify(obj, null, 2);
}

function parseDate(d) {
  return d ? new Date(d) : null;
}

function sortByStartDateAsc(sessions) {
  return [...sessions].sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
}

function stripSuffixes(name) {
  if (!name) return name;
  return name.replace(/,?\s*(Jr\.|Sr\.|III|II|IV)$/i, '').trim();
}

// --- Supabase RPC helper ---
async function supabaseRpc(fnName, args, { url, key }) {
  const res = await fetch(`${url}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${fnName} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// GET helper for PostgREST
async function supabaseSelect(pathname, params, { url, key }) {
  const u = new URL(`${url.replace(/\/$/, '')}/${pathname}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      u.searchParams.append(k, String(v));
    }
  }
  const res = await fetch(u.toString(), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`GET ${pathname} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// --- Gemini REST helper ---
// Uses Google Generative Language REST API (v1beta) without extra deps
async function geminiGenerate({ apiKey, model = 'gemini-1.5-pro', prompt, contextJson, temperature = 0.3 }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const userText = `${prompt}\n\nDATA (JSON):\n${toJSON(contextJson)}`;
  const body = {
    contents: [
      { role: 'user', parts: [{ text: userText }] }
    ],
    generationConfig: {
      temperature,
      candidateCount: 1,
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini error: ${res.status} ${text}`);
  }
  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('\n');
  return text.trim();
}

// --- Default analysis prompt ---
const DEFAULT_PROMPT = `You are an investigative policy analyst.
Using the supplied JSON data about an Arizona lawmaker, write a clear, evidence-based report that:
- Summarizes the member's identity and sessions analyzed.
- Highlights donation patterns by donor group before, during, and after sessions; call out notable spikes.
- Flags votes where the member went against their party's majority and list the bill numbers/titles.
- Summarizes key bills the member sponsored/co-sponsored.
- Incorporates relevant RTS (Request to Speak) positions if provided, noting alignment/conflict with donations and votes.
For any suspicious correlations (e.g., donation spikes preceding outlier votes or aligned sponsorships), describe them plainly with dates, groups, and bill identifiers. Keep the tone factual. End with a short "Potential Conflicts/Notes" section.`;

// --- Main ---
async function main() {
  // Load env from .env.local if present (no external deps)
  loadEnvFromFile('.env.local');
  loadEnvFromFile('.env');

  // Resolve Supabase envs
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !supabaseKey) {
    throw new Error('Missing Supabase credentials. Ensure SUPABASE_URL and SUPABASE_ANON_KEY (or SERVICE_ROLE_KEY) are set in .env.local');
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!GEMINI_API_KEY) {
    throw new Error('Missing Gemini key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) in .env.local');
  }

  const rl = rlInterface();
  try {
    const nameRaw = (await ask(rl, 'Enter the lawmaker name (e.g., First Last): ')).trim();
    if (!nameRaw) throw new Error('Lawmaker name is required.');
    const likeName = `%${nameRaw}%`;

    const preDaysAns = (await ask(rl, 'Pre-window days around session [default 90]: ')).trim();
    const postDaysAns = (await ask(rl, 'Post-window days around session [default 90]: ')).trim();
    const preDays = parseInt(preDaysAns || '90', 10);
    const postDays = parseInt(postDaysAns || '90', 10);

    // Resolve identity
    const identityResults = await supabaseRpc('resolve_lawmaker', {
      p_legislator_id: null,
      p_cf_entity_id: null,
      p_name: likeName
    }, { url: SUPABASE_URL, key: supabaseKey });

    if (!Array.isArray(identityResults) || identityResults.length === 0) {
      console.error('No matching lawmaker found. Try a different name.');
      process.exit(1);
    }
    const target = identityResults[0];
    console.log(`\nResolved: ${target.full_name} (${target.party}) — body: ${target.body}`);

    // List sessions and let user choose
    const sessions = await supabaseRpc('list_sessions', {}, { url: SUPABASE_URL, key: supabaseKey });
    const ordered = sortByStartDateAsc(sessions);
    console.log('\nAvailable sessions:');
    ordered.forEach((s, idx) => {
      const start = s.start_date; const end = s.end_date;
      console.log(`${idx + 1}. ${s.session_name || s.session_id} (${start} → ${end})`);
    });
    const pickAns = (await ask(rl, 'Pick session numbers (comma-separated) or press Enter for the latest: ')).trim();
    let chosenSessionIds = [];
    if (pickAns) {
      const idxs = pickAns.split(',').map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x) && x >= 1 && x <= ordered.length);
      chosenSessionIds = idxs.map(i => ordered[i - 1].session_id);
    } else if (ordered.length) {
      chosenSessionIds = [ordered[ordered.length - 1].session_id];
    }
    if (!chosenSessionIds.length) {
      console.error('No sessions selected.');
      process.exit(1);
    }

    const kwAns = (await ask(rl, 'Optional RTS keywords (comma-separated, e.g., Hospital, Realtor) or Enter to skip: ')).trim();
    const rtsKeywords = kwAns ? kwAns.split(',').map(s => s.trim()).filter(Boolean) : null;

    let context;
    try {
      // Try the Edge Function orchestrator first (if deployed with secrets)
      const res = await fetch(`${SUPABASE_URL.replace(/\/$/,'')}/functions/v1/compile_lawmaker_report`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lawmaker_query: likeName,
          session_ids: chosenSessionIds,
          pre_days: preDays,
          post_days: postDays,
          rts_keywords: rtsKeywords
        })
      });
      if (res.ok) {
        context = await res.json();
      } else {
        throw new Error(`Edge unavailable: ${res.status}`);
      }
    } catch {
      // Fan out RPC calls per the guide
      const legislatorIds = [target.legislator_id];
      let entityIds = Array.isArray(target.cf_entity_ids) ? target.cf_entity_ids : [];

      // Fallback committee mapping if resolver returns no entity_ids
      if (!entityIds.length) {
        const candidates = [target.full_name, stripSuffixes(target.full_name)].filter(Boolean);
        const set = new Set();
        for (const nm of candidates) {
          try {
            const recs = await supabaseSelect('rest/v1/cf_entity_records', {
              candidate: `ilike.*${nm}*`,
              select: 'entity_id,is_primary_record,committee_name,party_name',
              limit: 200
            }, { url: SUPABASE_URL, key: supabaseKey });
            for (const r of recs || []) {
              if (typeof r.entity_id === 'number') set.add(r.entity_id);
            }
          } catch {}
        }
        entityIds = Array.from(set);
      }

      const donations = entityIds.length ? await supabaseRpc('donations_by_session', {
        p_entity_ids: entityIds,
        p_session_ids: chosenSessionIds,
        p_pre_days: preDays,
        p_post_days: postDays
      }, { url: SUPABASE_URL, key: supabaseKey }) : [];

      const votes = await supabaseRpc('votes_with_party_outliers', {
        p_legislator_ids: legislatorIds,
        p_session_ids: chosenSessionIds,
        p_yes: ['Y'],
        p_no: ['N']
      }, { url: SUPABASE_URL, key: supabaseKey });

      const sponsors = await supabaseRpc('bill_sponsorships_for_legislator', {
        p_legislator_ids: legislatorIds,
        p_session_ids: chosenSessionIds
      }, { url: SUPABASE_URL, key: supabaseKey });

      const billIds = Array.from(new Set([
        ...votes.map(v => v.bill_id).filter(Boolean),
        ...sponsors.map(s => s.bill_id).filter(Boolean)
      ]));

      const rts = billIds.length ? await supabaseRpc('search_rts_positions', {
        p_bill_ids: billIds,
        p_keywords: rtsKeywords,
        p_limit: 500
      }, { url: SUPABASE_URL, key: supabaseKey }) : [];

      // Compose context
      context = {
        identity: target,
        analyzed_sessions: chosenSessionIds,
        donations_by_session: donations || [],
        votes_with_party_outliers: votes || [],
        bill_sponsorships: sponsors || [],
        rts_matches: rts || []
      };
    }

    // Prompt for custom instructions (optional)
    const customPrompt = (await ask(rl, '\nOptional: provide a custom analysis prompt or press Enter to use the default: ')).trim();
    const finalPrompt = customPrompt || DEFAULT_PROMPT;

    console.log('\nContacting Gemini...');
    const reportText = await geminiGenerate({
      apiKey: GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
      prompt: finalPrompt,
      contextJson: context,
      temperature: Number(process.env.GEMINI_TEMPERATURE || 0.3)
    });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = nameRaw.replace(/[^a-z0-9]+/gi, '_');
    const outDir = path.join(process.cwd(), 'reports');
    const outPath = path.join(outDir, `${safeName}_${ts}.md`);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, `# Report: ${nameRaw}\n\n${reportText}\n`);

    console.log('\n===== Gemini Report =====\n');
    console.log(reportText);
    console.log(`\nSaved to: ${outPath}`);
  } finally {
    rl.close();
  }
}

// Run
main().catch((err) => {
  console.error('\nError:', err?.message || err);
  process.exit(1);
});
