import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureServerExports, json } from '../_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const toolName = req.query.toolName as string;
  if (!toolName) return json(res, 400, { success: false, error: 'Missing toolName' });

  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method Not Allowed' });
  }

  try {
    const { executeTool } = ensureServerExports();
    const args = req.body || {};
    const result = await executeTool(toolName, args);
    return json(res, 200, { success: true, result });
  } catch (e: any) {
    return json(res, 500, { success: false, error: e?.message || 'Tool execution failed' });
  }
}

