import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeTool } from '../../../mcp-server/dist/http-adapter.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { toolName } = req.query;

    if (!toolName || typeof toolName !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Tool name is required'
      });
    }

    try {
      const result = await executeTool(toolName, req.body);
      return res.status(200).json({
        success: true,
        result
      });
    } catch (error: any) {
      console.error(`Tool execution error for ${toolName}:`, error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to execute tool'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}