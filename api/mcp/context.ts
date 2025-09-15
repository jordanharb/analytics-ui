import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      // Read the QUERY_CONTEXT.md file from MCP server
      const contextPath = join(__dirname, '../../mcp-server/QUERY_CONTEXT.md');
      const context = readFileSync(contextPath, 'utf-8');
      return res.status(200).json({
        context,
        instructions: 'Use the provided tools to query the database. Follow the context guidelines for optimal results.'
      });
    } catch (error) {
      // Fallback if file not found
      return res.status(200).json({
        context: '',
        instructions: 'MCP tools are available for querying the database.'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}