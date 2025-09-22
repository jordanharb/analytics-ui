import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type JobDomain = "bill" | "rts" | "donor";

export interface EmbedJob {
  id: string;
  domain: JobDomain;
  source_id: number;
  status: string;
  created_at: string;
  updated_at: string | null;
}

let cachedClient: SupabaseClient | null = null;

function requireEnv(primary: string, fallbacks: string[] = []): string {
  const keys = [primary, ...fallbacks];
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: ${keys.join(" | ")}`);
}

export function getServiceClient(): SupabaseClient {
  if (cachedClient) {
    return cachedClient;
  }

  const url = requireEnv("SUPABASE_URL", ["EDGE_SUPABASE_URL", "SERVICE_SUPABASE_URL"]);
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY", ["SERVICE_ROLE_KEY", "EDGE_SUPABASE_SERVICE_ROLE_KEY"]);

  cachedClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "embedder-edge-function",
      },
    },
  });

  return cachedClient;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function fetchQueuedJobs(client: SupabaseClient, limit: number): Promise<EmbedJob[]> {
  const { data, error } = await client
    .from("embed_jobs")
    .select("id, domain, source_id, status, created_at, updated_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch jobs: ${error.message}`);
  }

  return data ?? [];
}

export async function markJob(
  client: SupabaseClient,
  id: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    status,
    updated_at: nowIso(),
  };

  if (errorMessage) {
    payload.error = errorMessage.slice(0, 500);
  } else {
    payload.error = null;
  }

  const { error } = await client.from("embed_jobs").update(payload).eq("id", id);
  if (error) {
    throw new Error(`Failed to update job ${id}: ${error.message}`);
  }
}

export async function markJobProcessing(client: SupabaseClient, id: string): Promise<void> {
  await markJob(client, id, "processing");
}

export async function markJobDone(client: SupabaseClient, id: string): Promise<void> {
  await markJob(client, id, "done");
}

export async function markJobErrored(client: SupabaseClient, id: string, errorMessage: string): Promise<void> {
  await markJob(client, id, "error", errorMessage);
}
