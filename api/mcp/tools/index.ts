import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withMcpClient } from '../_client';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const tools = await withMcpClient(async (client, _transport) => {
      const list = await client.listTools({});
      return list.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      }));
    });

    return res.status(200).json({ tools });
  } catch (error) {
    console.error('Failed to list MCP tools', error);
    return res.status(502).json({ error: 'Failed to fetch MCP tools' });
  }
}
