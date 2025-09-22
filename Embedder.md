Here’s a drop-in `agent.md` you can place at the root of your repo. It gives a code-gen agent (e.g., GitHub Copilot / Codeium / “codex”) precise instructions to scaffold and implement the **Supabase Edge Function** for embeddings, plus a tiny query embed helper. It assumes you already ran the SQL migration for the `*_embeddings` tables and `embed_jobs` queue.

---

# agent.md — Build “embedder” Edge Function (Supabase + OpenAI embeddings)

## Objective

Create a production-ready **Supabase Edge Function** named `embedder` that:

1. Consumes queued items from `embed_jobs` (`domain ∈ {bill, rts, donor}`).
2. Builds the correct **content** string per domain:

   * **bill**: upsert a `summary` row (short title + summary) and optional `chunk` rows (from long bill text).
   * **rts**: one row per RTS record (entity\_name, representing, position, comments).
   * **donor**: one row per canonical `transaction_entity_id` (donor name + most representative employer/occupation), **but only** if the donor passes a **majority rule** on `transaction_type_disposition_id`.
3. Calls **OpenAI** embeddings (small model) and writes the vector into the appropriate table:
   `bill_embeddings`, `rts_embeddings`, `donor_embeddings`.
4. Marks jobs `done` or `error`, supports idempotency, structured logging, and batched processing.
5. Is parameterized via environment variables stored in `.env` (see **Environment**).

Also create a secondary function `embed_query` that accepts plaintext input and returns a 1536-dim embedding (for app/agent searches).

---

## Environment (read from `.env`)

The function must read (don’t hardcode) these keys. **Look up the exact names in `.env`**; if not present, fall back to these defaults where noted.

* `SUPABASE_URL` — required
* `SUPABASE_SERVICE_ROLE_KEY` — required (server-side)
* `OPENAI_API_KEY` — required
* `EMBEDDING_MODEL` — default: `text-embedding-3-small`
* `VECTOR_DIM` — default: `1536`
* `MAX_JOBS_PER_INVOCATION` — default: `50`
* `BATCH_SIZE` — default: `16` (how many texts to embed in one OpenAI call; okay to start with 1 if you prefer simplicity)
* `BILL_CHUNK_SIZE` — default: `1400`
* `BILL_CHUNK_OVERLAP` — default: `200`
* `TARGET_DISPOSITION_ID` — default: `1` (the `transaction_type_disposition_id` that must be a **majority** for donor canonicalization)
* `MIN_CONTENT_CHARS` — default: `10` (skip embedding if content too short)
* `LOG_LEVEL` — default: `info` (`debug|info|warn|error`)

> Implementation detail: the OpenAI embeddings API accepts arrays for batched inputs. If batching complicates error handling, process one by one for v1.

---

## Directory Structure to Create

```
supabase/
  functions/
    _shared/
      db.ts
      embeddings.ts
      log.ts
      util.ts
    embedder/
      index.ts
    embed_query/
      index.ts
```

* **`_shared/db.ts`**: Supabase client factory (Service Role), small helper for row updates with consistent error handling.
* **`_shared/embeddings.ts`**: OpenAI embedding client wrapper with (optional) batching and backoff/retry.
* **`_shared/log.ts`**: Tiny logger honoring `LOG_LEVEL`.
* **`_shared/util.ts`**: Text chunker; string builders for content.
* **`embedder/index.ts`**: Main worker: fetch jobs → build content → embed → upsert → mark done/error.
* **`embed_query/index.ts`**: Simple POST endpoint to embed an arbitrary string and return `vector: number[]`.

---

## Database Contracts (assume existing)

Tables (created by your migration):

* `bill_embeddings(id, bill_id, kind, chunk_index, content, embedding, session_id, bill_number, created_at, updated_at)`
* `rts_embeddings(id, rts_id, content, embedding, bill_id, position, created_at, updated_at)`
* `donor_embeddings(id, transaction_entity_id, content, embedding, created_at, updated_at)`
* `embed_jobs(id, domain, source_id, status, error, created_at, updated_at)`

**Source tables (read-only):**

* `bills(bill_id, short_title, bill_summary, bill_text, session_id, bill_number)`
* `rts_positions(id, bill_id, entity_name, representing, position, comment, notes)`
* `cf_transaction_entities(transaction_entity_id, entity_name, entity_type_description, …)`
* `cf_donations(id, transaction_entity_id, donor_name, donor_employer, donor_occupation, amount, transaction_type_disposition_id, created_at, …)`

> If your exact column names differ slightly, adapt SELECTs accordingly.

---

## Content Rules

### Bill content

* **Summary row** (`kind = 'summary'`, `chunk_index = NULL`):

  ```
  <short_title>

  <bill_summary>
  ```

  * If `bill_summary` is null/empty, you may fallback to `LEFT(bill_text, 1800)` (optional).
* **Chunks** (`kind = 'chunk'`, `chunk_index = 0..N`):

  * Only if `bill_text` exists and `LENGTH(bill_text) > 2000`.
  * Use sliding windows: `BILL_CHUNK_SIZE` with `BILL_CHUNK_OVERLAP`.
  * Ensure **idempotency**: don’t re-insert existing `(bill_id, chunk_index)`.

### RTS content

```
Entity: <entity_name>
Representing: <representing>   (omit if null)
Position: <position>           (normalize to 'For'/'Against'/'Neutral' or raw passthrough)
<Comment or Notes if present>
```

### Donor content (canonical `transaction_entity_id`)

**Include only** if **majority** of rows for this entity satisfy:

```
transaction_type_disposition_id = TARGET_DISPOSITION_ID
```

Majority = `sum(match)/count(all) > 0.5`. Use COALESCE where helpful.

Build content from the **most frequent** or **most recent non-null** values:

```
<donor_display_name>                  (entity_name if donor_name is null)
Employer: <employer>                  (from cf_donations)
Occupation: <occupation>              (from cf_donations)
```

* Prefer `donor_name` if consistently present; else fallback to `cf_transaction_entities.entity_name`.
* For `employer`/`occupation`, pick the most frequent non-null per entity, or fallback to most recent non-null.

Skip embeddings if content is too short (`MIN_CONTENT_CHARS`).

---

## Implementation Steps

1. **Create shared utilities**

   * `_shared/log.ts`: `log(level, msg, meta?)` using `LOG_LEVEL`.
   * `_shared/db.ts`:

     * `getServiceClient()` initializes Supabase client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
     * Tiny helpers: `markJob(id, status, error?)`, `now()` etc.
   * `_shared/embeddings.ts`:

     * `embedOne(text: string): Promise<number[]>`
     * Optionally `embedMany(texts: string[]): Promise<number[][]>`
     * Handle OpenAI POST to `/v1/embeddings` with `{ model: EMBEDDING_MODEL, input }`. Validate lengths and return arrays of length = `VECTOR_DIM`.
     * Respect rate limits with simple exponential backoff (e.g., 100ms → 200ms → 400ms, max 5 tries).
   * `_shared/util.ts`:

     * `chunkText(s, size, overlap) => string[]`
     * `buildBillSummary(bill) => string`
     * `buildRtsContent(rts) => string`
     * `selectDonorDisplayParts(entity, stats) => {name, employer, occupation}`

2. **`embedder/index.ts`**

   * `serve` handler:

     * Read config from env with defaults.
     * Fetch up to `MAX_JOBS_PER_INVOCATION` from `embed_jobs WHERE status='queued' ORDER BY created_at ASC`.
     * For each job:

       * Update `status='processing'`.
       * Branch by `domain`:

         * **bill**:

           * SELECT `bills` row.
           * Build summary content, `embedOne`, upsert into `bill_embeddings` (`kind='summary'`), set `session_id`, `bill_number`.
           * If `bill_text` long enough, chunk with overlap, for each new `chunk_index`: `embedOne` and INSERT (skip if exists).
         * **rts**:

           * SELECT `rts_positions` row.
           * Build content, `embedOne`, UPSERT into `rts_embeddings` by unique `rts_id`.
         * **donor**:

           * Compute **majority rule**:

             ```
             SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN transaction_type_disposition_id = TARGET_DISPOSITION_ID THEN 1 ELSE 0 END) AS hits
             FROM cf_donations
             WHERE transaction_entity_id = $1;
             ```

             Only proceed if `hits::float / NULLIF(total,0) > 0.5`.
           * SELECT display parts:

             * Base entity: `cf_transaction_entities` (name).
             * Most frequent non-null employer/occupation from `cf_donations` for that entity (or most recent).
           * Build content, `embedOne`, UPSERT into `donor_embeddings` by `transaction_entity_id`.
       * Mark job `done`; on any error mark `error` with error string.
     * Return HTTP 200 with small JSON summary: `{ processed, done, errored }`.

3. **`embed_query/index.ts`**

   * POST `{ "text": "..." }` → returns `{ "vector": number[] }`.
   * Validate length and return 400 on empty.

4. **Permissions**

   * Use Service Role in Edge Functions; do **not** expose Service Role to clients.
   * Row level security (RLS) on embeddings tables can remain off for server-side writes. If RLS is on, add suitable policies for the Edge Function.

5. **Cron/Schedule**

   * Configure Supabase Scheduled Triggers: call `POST /functions/v1/embedder` every 5 minutes.
   * You can also enqueue on data change (triggers), but keep v1 simple: batch + cron.

---

## SQL Snippets to Use Inside the Function

### Fetch jobs

```sql
-- JS: sb.from('embed_jobs')
--   .select('*')
--   .eq('status','queued')
--   .order('created_at', { ascending: true })
--   .limit(MAX_JOBS_PER_INVOCATION)
```

### Bills

```sql
-- Load bill
SELECT bill_id, short_title, bill_summary, bill_text, session_id, bill_number
FROM bills
WHERE bill_id = :id;
```

**Upsert summary**

```sql
-- JS: upsert into bill_embeddings where (bill_id, kind='summary', chunk_index IS NULL)
```

**Check existing chunks**

```sql
SELECT chunk_index FROM bill_embeddings
WHERE bill_id = :bill_id AND kind = 'chunk';
```

**Insert new chunk**

```sql
-- JS: insert { bill_id, kind: 'chunk', chunk_index, content, embedding, session_id, bill_number }
```

### RTS

```sql
SELECT id, bill_id, entity_name, representing, position, comment, notes
FROM rts_positions
WHERE id = :rts_id;
```

### Donor majority rule

```sql
SELECT
  COUNT(*)::int AS total,
  SUM(CASE WHEN transaction_type_disposition_id = :TARGET_DISPOSITION_ID THEN 1 ELSE 0 END)::int AS hits
FROM cf_donations
WHERE transaction_entity_id = :entity_id;
-- proceed only if hits::float / GREATEST(total,1) > 0.5
```

**Donor display data**

* Base name:

```sql
SELECT transaction_entity_id, entity_name
FROM cf_transaction_entities
WHERE transaction_entity_id = :entity_id;
```

* Employer / occupation (most frequent non-null):

```sql
-- Employer
SELECT donor_employer, COUNT(*) AS c
FROM cf_donations
WHERE transaction_entity_id = :entity_id AND donor_employer IS NOT NULL AND donor_employer <> ''
GROUP BY donor_employer
ORDER BY c DESC
LIMIT 1;

-- Occupation
SELECT donor_occupation, COUNT(*) AS c
FROM cf_donations
WHERE transaction_entity_id = :entity_id AND donor_occupation IS NOT NULL AND donor_occupation <> ''
GROUP BY donor_occupation
ORDER BY c DESC
LIMIT 1;
```

---

## Acceptance Criteria

* ✅ `supabase/functions/embedder/index.ts` compiles and deploys.
* ✅ `supabase/functions/embed_query/index.ts` compiles and deploys.
* ✅ Handles up to `MAX_JOBS_PER_INVOCATION` jobs.
* ✅ Writes **summary** embedding for every bill; writes **chunk** embeddings when `bill_text` is long.
* ✅ Writes exactly one embedding per RTS (`rts_id`).
* ✅ Writes exactly one embedding per donor (`transaction_entity_id`) **only** if majority rule passes.
* ✅ Idempotent: re-runs don’t duplicate chunks or re-create identical rows.
* ✅ Good errors: failures mark the job `error` and keep going.
* ✅ Uses `EMBEDDING_MODEL`, `VECTOR_DIM` from env; fails fast if keys missing.
* ✅ Log lines include `job_id`, `domain`, `source_id`, and timings.

---

## Commands / Runbook

**Deploy**

```bash
# Install Supabase CLI if needed
# brew install supabase/tap/supabase

# From repo root
supabase functions deploy embedder
supabase functions deploy embed_query

# Set secrets (or use Dashboard → Project Settings → Functions → Secrets)
supabase secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  OPENAI_API_KEY=... \
  EMBEDDING_MODEL=text-embedding-3-small \
  VECTOR_DIM=1536 \
  MAX_JOBS_PER_INVOCATION=50 \
  BATCH_SIZE=16 \
  BILL_CHUNK_SIZE=1400 \
  BILL_CHUNK_OVERLAP=200 \
  TARGET_DISPOSITION_ID=1 \
  MIN_CONTENT_CHARS=10 \
  LOG_LEVEL=info
```

**Local test (optional)**

```bash
# Use the CLI to invoke with a dummy POST
supabase functions invoke embedder --no-verify-jwt --data '{"dryRun": false}'
supabase functions invoke embed_query --no-verify-jwt --data '{"text":"charter schools property tax"}'
```

**Schedule (Dashboard)**

* Add a Scheduled Trigger to call `POST /functions/v1/embedder` every 5 minutes.

---

## Testing Checklist

* Seed a few rows in:

  * `bills` (one short, one with long `bill_text`).
  * `rts_positions`.
  * `cf_transaction_entities` + `cf_donations` for 2–3 donors:

    * One that passes majority rule,
    * One that fails (e.g., 40% of matching disposition).
* Insert `embed_jobs` rows for each domain.
* Invoke `embedder`:

  * Confirm rows appear in `bill_embeddings`, `rts_embeddings`, `donor_embeddings`.
  * Re-invoke: confirm no duplicates; only missing chunks are added.
  * Flip a donor’s ratio to below 50%: `embedder` should **not** create an embedding (or should skip).
* Call `embed_query` with “charter schools” and verify a 1536-element array is returned.

---

## Notes for Future Iterations (not required now)

* Add RLS policies for controlled reads from your app roles.
* Add triggers to enqueue on `INSERT/UPDATE` to source tables.
* Add HNSW indexes if your pgvector version supports it and you want lower latency.
* Add a `search_*` Postgres RPC or a `/search` function that embeds a query string and returns cosine-ranked results from the embeddings tables.

---

## Style & Quality

* TypeScript strict mode.
* Minimal dependencies (std lib + `@supabase/supabase-js@2`).
* Defensive null checks on all DB reads.
* Clear, consistent logs with timing (`performance.now()`), sizes (#chunks), and OpenAI token estimates if you include them.
* Small helpers over big functions; keep `index.ts` under \~200 lines by moving utilities into `_shared`.

---

**Go build it.**
