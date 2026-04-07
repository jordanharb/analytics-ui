/**
 * Embedding service using Google's text-embedding-005 model (768 dimensions).
 * Matches the backend pipeline which stores embeddings in embedding_768 column.
 */

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-005';
const EMBEDDING_DIMENSIONS = 768;

export class EmbeddingService {
  private static instance: EmbeddingService;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Generate embedding for a search query using Google's text-embedding-005.
   * Uses RETRIEVAL_QUERY task type for search queries (vs RETRIEVAL_DOCUMENT for indexed content).
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!GOOGLE_API_KEY) {
      console.warn('Google API key not configured. Set VITE_GOOGLE_API_KEY. Falling back to text-only search.');
      throw new Error('Google API key not configured.');
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBEDDING_MODEL}`,
          content: { parts: [{ text: query }] },
          taskType: 'RETRIEVAL_QUERY',
          outputDimensionality: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        console.error('Google embedding API error:', error);

        if (response.status === 429) {
          throw new Error('Google API rate limit exceeded.');
        }
        throw new Error(`Embedding error: ${error?.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const embedding = data?.embedding?.values;

      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response from Google API.');
      }

      console.log(`Generated Google embedding (${embedding.length} dims) for query: "${query.slice(0, 50)}..."`);
      return embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      if (error instanceof Error) throw error;
      throw new Error('Unknown error generating embedding.');
    }
  }

  formatForPgVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}

export const embeddingService = EmbeddingService.getInstance();
