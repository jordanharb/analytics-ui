import { serve } from "https://deno.land/std@0.220.1/http/server.ts";

import { createEmbeddingClient, type EmbeddingClient } from "../_shared/embeddings.ts";
import { createLogger } from "../_shared/log.ts";

const logger = createLogger({ scope: "embed_query" });

interface Config {
  embeddingModel: string;
  vectorDim: number;
  batchSize: number;
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
    embeddingModel: Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-3-small",
    vectorDim: numberEnv("VECTOR_DIM", 1536),
    batchSize: numberEnv("BATCH_SIZE", 16),
    openAIApiKey: requireEnv("OPENAI_API_KEY"),
  };
}

let cachedClient: EmbeddingClient | null = null;

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      return new Response(JSON.stringify({ error: "Text is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!cachedClient) {
      const config = loadConfig();
      cachedClient = createEmbeddingClient({
        apiKey: config.openAIApiKey,
        model: config.embeddingModel,
        vectorDim: config.vectorDim,
        batchSize: config.batchSize,
      });
    }

    const vector = await cachedClient.embedOne(text);
    return new Response(JSON.stringify({ vector }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to embed query", { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
