export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  vectorDim: number;
  batchSize: number;
  maxAttempts?: number;
}

export interface EmbeddingClient {
  embedOne: (text: string) => Promise<number[]>;
  embedMany: (texts: string[]) => Promise<number[][]>;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 100;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createEmbeddingClient(config: EmbeddingConfig): EmbeddingClient {
  const { apiKey, model, vectorDim, batchSize } = config;
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (!apiKey) {
    throw new Error("Missing OpenAI API key");
  }
  if (!model) {
    throw new Error("Missing embedding model");
  }

  async function requestBatch(inputs: string[]): Promise<number[][]> {
    const payload = {
      model,
      input: inputs,
    };

    let attempt = 0;
    while (true) {
      try {
        attempt += 1;
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errorText = await res.text();
          if ((res.status >= 500 || res.status === 429) && attempt < maxAttempts) {
            await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
            continue;
          }
          throw new Error(`OpenAI embeddings error (${res.status}): ${errorText}`);
        }

        const json = await res.json();
        if (!json?.data || !Array.isArray(json.data)) {
          throw new Error("Invalid embeddings response payload");
        }

        const vectors = json.data.map((entry: { embedding: number[] }) => entry.embedding);
        for (const vector of vectors) {
          if (!Array.isArray(vector) || vector.length !== vectorDim) {
            throw new Error(`Unexpected embedding length (expected ${vectorDim}, got ${vector?.length ?? "unknown"})`);
          }
        }

        return vectors;
      } catch (err) {
        if (attempt >= maxAttempts) {
          throw err;
        }
        await sleep(BASE_DELAY_MS * 2 ** attempt);
      }
    }
  }

  async function embedMany(texts: string[]): Promise<number[][]> {
    const filtered = texts.map((text) => text ?? "");
    const results: number[][] = [];
    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize);
      const vectors = await requestBatch(batch);
      results.push(...vectors);
    }
    return results;
  }

  async function embedOne(text: string): Promise<number[]> {
    const [vector] = await embedMany([text]);
    return vector;
  }

  return { embedMany, embedOne };
}
