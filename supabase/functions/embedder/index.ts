import { serve } from "https://deno.land/std@0.220.1/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  fetchQueuedJobs,
  getServiceClient,
  markJobDone,
  markJobErrored,
  markJobProcessing,
  type EmbedJob,
} from "../_shared/db.ts";
import { createEmbeddingClient, type EmbeddingClient } from "../_shared/embeddings.ts";
import { createLogger, type Logger } from "../_shared/log.ts";
import {
  buildBillSummary,
  buildDonorContent,
  buildRtsContent,
  chunkText,
  selectDonorDisplayParts,
  type BillRecord,
  type RtsRecord,
} from "../_shared/util.ts";

const logger = createLogger({ scope: "embedder" });

interface Config {
  maxJobs: number;
  jobFetchLimit: number;
  batchSize: number;
  billChunkSize: number;
  billChunkOverlap: number;
  targetDispositionId: number;
  minContentChars: number;
  embeddingModel: string;
  vectorDim: number;
  openAIApiKey: string;
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function numberEnv(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric environment variable ${key}: ${raw}`);
  }
  return parsed;
}

function loadConfig(): Config {
  return {
    maxJobs: numberEnv("MAX_JOBS_PER_INVOCATION", 50),
    jobFetchLimit: numberEnv("JOB_FETCH_LIMIT", 50),
    batchSize: numberEnv("BATCH_SIZE", 16),
    billChunkSize: numberEnv("BILL_CHUNK_SIZE", 1400),
    billChunkOverlap: numberEnv("BILL_CHUNK_OVERLAP", 200),
    targetDispositionId: numberEnv("TARGET_DISPOSITION_ID", 1),
    minContentChars: numberEnv("MIN_CONTENT_CHARS", 10),
    embeddingModel: Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-3-small",
    vectorDim: numberEnv("VECTOR_DIM", 1536),
    openAIApiKey: requireEnv("OPENAI_API_KEY"),
  };
}

interface InvocationSummary {
  processed: number;
  done: number;
  errored: number;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const invocationStart = performance.now();
  try {
    const config = loadConfig();
    const client = getServiceClient();
    const embeddingClient = createEmbeddingClient({
      apiKey: config.openAIApiKey,
      model: config.embeddingModel,
      vectorDim: config.vectorDim,
      batchSize: config.batchSize,
    });

    if (config.jobFetchLimit <= 0) {
      throw new Error("JOB_FETCH_LIMIT must be greater than zero");
    }

    const summary: InvocationSummary = {
      processed: 0,
      done: 0,
      errored: 0,
    };

    let remaining = config.maxJobs;
    let batches = 0;

    while (true) {
      const limit = remaining > 0 ? Math.min(remaining, config.jobFetchLimit) : config.jobFetchLimit;
      if (limit <= 0) {
        break;
      }

      const jobs = await fetchQueuedJobs(client, limit);
      if (!jobs.length) {
        if (batches === 0) {
          logger.info("No jobs to process");
        }
        break;
      }

      batches += 1;
      summary.processed += jobs.length;

      logger.info("Processing batch", {
        batch: batches,
        batch_size: jobs.length,
        limit,
        remaining,
      });

      for (const job of jobs) {
        const jobLogger = logger.child({ job_id: job.id, domain: job.domain, source_id: job.source_id });
        const jobStarted = performance.now();
        try {
          await markJobProcessing(client, job.id);
          await handleJob(client, embeddingClient, config, job, jobLogger);
          await markJobDone(client, job.id);
          summary.done += 1;
          jobLogger.info("Job completed", {
            duration_ms: Math.round(performance.now() - jobStarted),
          });
        } catch (error) {
          summary.errored += 1;
          const message = error instanceof Error ? error.message : String(error);
          jobLogger.error("Job failed", {
            error: message,
          });
          await markJobErrored(client, job.id, message);
        }
      }

      if (remaining > 0) {
        remaining -= jobs.length;
        if (remaining <= 0) {
          break;
        }
      }

      if (jobs.length < limit) {
        break;
      }
    }

    const duration = Math.round(performance.now() - invocationStart);
    logger.info("Invocation complete", { ...summary, duration_ms: duration });

    return new Response(JSON.stringify({ ...summary, duration_ms: duration }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Invocation error", { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

type JobHandler = (
  client: SupabaseClient,
  embeddingClient: EmbeddingClient,
  config: Config,
  job: EmbedJob,
  jobLogger: Logger,
) => Promise<void>;

const handlers: Record<EmbedJob["domain"], JobHandler> = {
  bill: handleBillJob,
  rts: handleRtsJob,
  donor: handleDonorJob,
};

async function handleJob(
  client: SupabaseClient,
  embeddingClient: EmbeddingClient,
  config: Config,
  job: EmbedJob,
  jobLogger: Logger,
): Promise<void> {
  const handler = handlers[job.domain];
  if (!handler) {
    throw new Error(`Unsupported job domain: ${job.domain}`);
  }
  await handler(client, embeddingClient, config, job, jobLogger);
}

async function handleBillJob(
  client: SupabaseClient,
  embeddingClient: EmbeddingClient,
  config: Config,
  job: EmbedJob,
  jobLogger: Logger,
): Promise<void> {
  const { data: bill, error } = await client
    .from("bills")
    .select("bill_id, short_title, now_title, bill_summary, bill_text, session_id, bill_number")
    .eq("bill_id", job.source_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load bill ${job.source_id}: ${error.message}`);
  }
  if (!bill) {
    throw new Error(`Bill ${job.source_id} not found`);
  }

  const billRecord: BillRecord = {
    short_title: bill.short_title,
    now_title: bill.now_title,
    bill_summary: bill.bill_summary,
    bill_text: bill.bill_text,
  };

  const summaryContent = buildBillSummary(billRecord);
  if (!summaryContent || summaryContent.length < config.minContentChars) {
    jobLogger.warn("Skipping bill summary: insufficient content", { length: summaryContent.length });
  } else {
    const vector = await embeddingClient.embedOne(summaryContent);

    const { data: existingSummary, error: existingSummaryError } = await client
      .from("bill_embeddings")
      .select("id")
      .eq("bill_id", bill.bill_id)
      .eq("kind", "summary")
      .is("chunk_index", null)
      .maybeSingle();

    if (existingSummaryError) {
      throw new Error(`Failed to load existing bill summary: ${existingSummaryError.message}`);
    }

    if (existingSummary?.id) {
      const { error: updateError } = await client
        .from("bill_embeddings")
        .update({
          content: summaryContent,
          embedding: vector,
          session_id: bill.session_id,
          bill_number: bill.bill_number,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingSummary.id);

      if (updateError) {
        throw new Error(`Failed to update bill summary: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await client.from("bill_embeddings").insert({
        bill_id: bill.bill_id,
        kind: "summary",
        chunk_index: null,
        content: summaryContent,
        embedding: vector,
        session_id: bill.session_id,
        bill_number: bill.bill_number,
      });

      if (insertError) {
        throw new Error(`Failed to insert bill summary: ${insertError.message}`);
      }
    }

    jobLogger.debug("Summary embedding stored", { bill_id: bill.bill_id });
  }

  if (!bill.bill_text || bill.bill_text.length <= config.billChunkSize + config.billChunkOverlap) {
    return;
  }

  const existingIndexes = await fetchExistingBillChunkIndexes(client, bill.bill_id);
  const chunks = chunkText(bill.bill_text, config.billChunkSize, config.billChunkOverlap);
  let inserted = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (existingIndexes.has(index)) {
      continue;
    }
    const content = chunks[index];
    if (!content || content.length < config.minContentChars) {
      continue;
    }
    const vector = await embeddingClient.embedOne(content);
    const { error: insertError } = await client.from("bill_embeddings").insert({
      bill_id: bill.bill_id,
      kind: "chunk",
      chunk_index: index,
      content,
      embedding: vector,
      session_id: bill.session_id,
      bill_number: bill.bill_number,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        jobLogger.debug("Chunk already exists, skipping", { chunk_index: index });
        continue;
      }
      throw new Error(`Failed to insert bill chunk ${index}: ${insertError.message}`);
    }
    inserted += 1;
  }

  jobLogger.info("Bill chunks processed", {
    total_chunks: chunks.length,
    inserted,
    skipped_existing: existingIndexes.size,
  });
}

async function fetchExistingBillChunkIndexes(client: SupabaseClient, billId: number): Promise<Set<number>> {
  const { data, error } = await client
    .from("bill_embeddings")
    .select("chunk_index")
    .eq("bill_id", billId)
    .eq("kind", "chunk");

  if (error) {
    throw new Error(`Failed to load existing bill chunks: ${error.message}`);
  }

  const set = new Set<number>();
  for (const row of data ?? []) {
    if (typeof row.chunk_index === "number") {
      set.add(row.chunk_index);
    }
  }
  return set;
}

async function handleRtsJob(
  client: SupabaseClient,
  embeddingClient: EmbeddingClient,
  config: Config,
  job: EmbedJob,
  jobLogger: Logger,
): Promise<void> {
  const { data: rts, error } = await client
    .from("rts_positions")
    .select("id, bill_id, entity_name, representing, position, comment, notes")
    .eq("id", job.source_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load RTS ${job.source_id}: ${error.message}`);
  }
  if (!rts) {
    throw new Error(`RTS ${job.source_id} not found`);
  }

  const rtsRecord: RtsRecord = {
    entity_name: rts.entity_name,
    representing: rts.representing,
    position: rts.position,
    comment: rts.comment,
    notes: rts.notes,
  };

  const content = buildRtsContent(rtsRecord);
  if (!content || content.length < config.minContentChars) {
    jobLogger.warn("Skipping RTS: insufficient content", { length: content.length });
    return;
  }

  const vector = await embeddingClient.embedOne(content);
  const { error: upsertError } = await client.from("rts_embeddings").upsert(
    {
      rts_id: rts.id,
      bill_id: rts.bill_id,
      content,
      embedding: vector,
      position: rts.position,
    },
    { onConflict: "rts_id" },
  );

  if (upsertError) {
    throw new Error(`Failed to upsert RTS embedding: ${upsertError.message}`);
  }
}

async function handleDonorJob(
  client: SupabaseClient,
  embeddingClient: EmbeddingClient,
  config: Config,
  job: EmbedJob,
  jobLogger: Logger,
): Promise<void> {
  const { count: total, error: totalError } = await client
    .from("cf_transactions")
    .select("*", { count: "exact", head: true })
    .eq("transaction_entity_id", job.source_id);

  if (totalError) {
    throw new Error(`Failed to count donor transactions: ${totalError.message}`);
  }

  const { count: hits, error: hitsError } = await client
    .from("cf_transactions")
    .select("*", { count: "exact", head: true })
    .eq("transaction_entity_id", job.source_id)
    .eq("transaction_type_disposition_id", config.targetDispositionId);

  if (hitsError) {
    throw new Error(`Failed to count donor disposition hits: ${hitsError.message}`);
  }

  const totalCount = total ?? 0;
  const hitCount = hits ?? 0;

  if (totalCount === 0) {
    jobLogger.info("Skipping donor: no transactions available");
    return;
  }

  const ratio = hitCount / totalCount;
  if (ratio <= 0.5) {
    jobLogger.info("Skipping donor: majority rule not met", {
      ratio,
      hits: hitCount,
      total: totalCount,
      target_disposition: config.targetDispositionId,
    });
    return;
  }

  const { data: entity, error: entityError } = await client
    .from("cf_transaction_entities")
    .select("entity_id, entity_name")
    .eq("entity_id", job.source_id)
    .maybeSingle();

  if (entityError) {
    throw new Error(`Failed to load donor entity: ${entityError.message}`);
  }
  if (!entity) {
    throw new Error(`Donor entity ${job.source_id} not found`);
  }

  const { data: donorDetails, error: donorDetailsError } = await client
    .from("cf_transactions")
    .select("transaction_employer, transaction_occupation")
    .eq("transaction_entity_id", job.source_id)
    .limit(1000);

  if (donorDetailsError) {
    throw new Error(`Failed to load donor details: ${donorDetailsError.message}`);
  }

  const employers = donorDetails?.map((row) => row.transaction_employer) ?? [];
  const occupations = donorDetails?.map((row) => row.transaction_occupation) ?? [];

  const rawName = entity.entity_name?.trim();
  const donorName = rawName && rawName.length > 0 ? rawName : `Entity ${job.source_id}`;
  const display = selectDonorDisplayParts(donorName, employers, occupations);
  const content = buildDonorContent(display);

  if (!content || content.length < config.minContentChars) {
    jobLogger.warn("Skipping donor: insufficient content", { length: content.length });
    return;
  }

  const vector = await embeddingClient.embedOne(content);
  const { error: upsertError } = await client.from("donor_embeddings").upsert(
    {
      transaction_entity_id: job.source_id,
      content,
      embedding: vector,
    },
    { onConflict: "transaction_entity_id" },
  );

  if (upsertError) {
    throw new Error(`Failed to upsert donor embedding: ${upsertError.message}`);
  }

  jobLogger.info("Donor embedding stored", {
    ratio,
    hits: hitCount,
    total: totalCount,
  });
}
