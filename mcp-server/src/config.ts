import dotenv from 'dotenv';
dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL!,
    anonKey: process.env.SUPABASE_ANON_KEY!,
    serviceKey: process.env.SUPABASE_SERVICE_KEY!,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  },
  server: {
    port: parseInt(process.env.MCP_SERVER_PORT || '3000'),
    name: process.env.MCP_SERVER_NAME || 'woke-palantir-mcp',
  },
  database: {
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD!,
  },
  vectorSearch: {
    similarityThreshold: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD || '0.7'),
  },
  queryLimits: {
    maxResults: parseInt(process.env.MAX_QUERY_RESULTS || '1000'),
    defaultLimit: parseInt(process.env.DEFAULT_QUERY_LIMIT || '100'),
  },
};