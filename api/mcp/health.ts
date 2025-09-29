import type { VercelRequest, VercelResponse } from '@vercel/node';
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.status(405).send(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  res.status(200).send(JSON.stringify({ status: 'healthy', server: 'mcp-http-proxy' }));
}
