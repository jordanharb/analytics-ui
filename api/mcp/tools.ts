import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ensureServerExports, json } from './_shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  try {
    const { tools } = ensureServerExports();
    return json(res, 200, { tools });
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to load tools' });
  }
}

