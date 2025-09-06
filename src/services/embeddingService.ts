/**
 * Service for generating embeddings using Google's Generative AI API
 * Uses the same text-embedding-004 model as the backend
 */

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004';
const GOOGLE_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface EmbeddingResponse {
  embedding: {
    values: number[];
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
   * Generate embedding for a search query using Google's text-embedding-004 model
   * This matches the model used for the existing event embeddings
   */
  async generateQueryEmbedding(query: string): Promise<number[]> {
    if (!GOOGLE_API_KEY) {
      console.error('Google API key not configured');
      return [];
    }
    
    try {
      console.log('Generating embedding for query:', query);
      
      // Call Google's embedding API
      const response = await fetch(
        `${GOOGLE_AI_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: {
              parts: [{
                text: query
              }]
            },
            taskType: 'RETRIEVAL_QUERY' // Use RETRIEVAL_QUERY for search queries
          })
        }
      );
      
      if (!response.ok) {
        const error = await response.text();
        console.error('Google AI API error:', error);
        
        // Check for specific errors
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again in a moment.');
        } else if (response.status === 403) {
          throw new Error('API key invalid or not authorized for embeddings.');
        }
        
        throw new Error(`Failed to generate embedding: ${response.status}`);
      }
      
      const data: EmbeddingResponse = await response.json();
      
      if (!data.embedding?.values) {
        console.error('Invalid embedding response:', data);
        return [];
      }
      
      console.log('Generated embedding with dimension:', data.embedding.values.length);
      return data.embedding.values;
      
    } catch (error) {
      console.error('Error generating embedding:', error);
      
      // Show user-friendly error message
      if (error instanceof Error) {
        if (error.message.includes('Rate limit')) {
          // Could implement retry logic here
          console.warn('Rate limited - consider implementing retry logic');
        }
      }
      
      return [];
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