import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Attempt to re-use the server implementation to avoid code drift
// These exports come from mcp-server/src/http-adapter.ts
// It creates its own Supabase client internally from env vars
// so we only need to ensure envs are set in Vercel.
// If import fails (e.g. path changes), we gracefully handle it below.
let serverExports: any = null;
try {
  // No extension so the bundler can resolve TS
  // @ts-ignore
  serverExports = await import('../../mcp-server/src/http-adapter');
} catch (e) {
  // Fallback to null; endpoints will respond with meaningful error
  serverExports = null;
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase env not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or their VITE_ equivalents).');
  }
  return createClient(url, key);
}

export function ensureServerExports() {
  if (!serverExports || !serverExports.tools || !serverExports.executeTool) {
    throw new Error('MCP server modules not available in API. Ensure mcp-server/src/http-adapter.ts exports { tools, executeTool } and paths are correct.');
  }
  return serverExports as { tools: any[]; executeTool: (name: string, args: any) => Promise<any> };
}

export function json(res: VercelResponse, status: number, body: any) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}
