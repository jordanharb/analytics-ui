/**
 * Service for generating embeddings using OpenAI's API
 * Uses text-embedding-3-small model to generate 1536-dimension vectors.
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIEmbeddingResponse {
  object: 'list';
  data: {
    object: 'embedding';
    embedding: number[];
    index: number;
  }[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

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
   * Generate embedding for a search query using OpenAI's text-embedding-3-small model.
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!OPENAI_API_KEY) {
      console.error('OpenAI API key not configured. Set VITE_OPENAI_API_KEY.');
      throw new Error('OpenAI API key not configured.');
    }
    
    try {
      console.log('Generating OpenAI embedding for query:', query);
      
      const response = await fetch(`${OPENAI_API_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: query,
          dimensions: 1536,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error('OpenAI API error:', error);
        
        if (response.status === 429) {
          throw new Error('OpenAI rate limit exceeded. Please check your plan and billing details.');
        } else if (response.status === 401) {
          throw new Error('Invalid OpenAI API key.');
        }
        
        throw new Error(`Failed to generate embedding: ${error.message || response.statusText}`);
      }
      
      const data: OpenAIEmbeddingResponse = await response.json();
      
      const embedding = data?.data?.[0]?.embedding;
      if (!embedding) {
        console.error('Invalid embedding response from OpenAI:', data);
        throw new Error('Invalid embedding response from OpenAI.');
      }
      
      console.log('Generated OpenAI embedding with dimension:', embedding.length);
      return embedding;
      
    } catch (error) {
      console.error('Error generating OpenAI embedding:', error);
      
      if (error instanceof Error) {
        throw error;
      }
      
      throw new Error('An unknown error occurred while generating the embedding.');
    }
  }
  
  /**
   * Format embedding as pgvector string literal for PostgreSQL
   * Format: "[v1,v2,v3,...]"
   */
  formatForPgVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}

export const embeddingService = EmbeddingService.getInstance();