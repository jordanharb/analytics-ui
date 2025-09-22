import type { VercelRequest, VercelResponse } from '@vercel/node';
import { json } from './_shared.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });
  return json(res, 200, { status: 'healthy', server: 'mcp-vercel-functions' });
}

