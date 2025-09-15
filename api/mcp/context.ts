import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_shared';
import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
  try {
    // Try to read local context
    let context = '';
    try {
      context = readFileSync(join(process.cwd(), 'mcp-server', 'QUERY_CONTEXT.md'), 'utf-8');
    } catch {}

    let schemaText = '';
    try {
      // Prefer repo root copy if present in this project
      schemaText = readFileSync(join(process.cwd(), 'woke_palantir_schema.md'), 'utf-8');
    } catch {
      try {
        schemaText = readFileSync(join(process.cwd(), 'mcp-server', '..', 'woke_palantir_schema.md'), 'utf-8');
      } catch {}
    }

    const combined = `${context}\n\n---\nIMPORTANT: Before writing any SQL, review the database schema below and use only read-only queries (SELECT/CTE).\n\n${schemaText ? `Database Schema (for context only):\n${schemaText}` : ''}`.trim();

    return json(res, 200, {
      context: combined,
      instructions: 'Use the provided tools. Always consult the schema in context before crafting SQL.'
    });
  } catch (e: any) {
    return json(res, 200, {
      context: '',
      instructions: 'MCP tools are available for querying the database.'
    });
  }
}

