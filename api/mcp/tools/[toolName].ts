import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withMcpClient } from '../_client';

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

type ToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

function normalizeToolResult(result: ToolCallResult | undefined) {
  if (!result) return null;

  if (result.structuredContent) {
    return result.structuredContent;
  }

  if (Array.isArray(result.content) && result.content.length > 0) {
    const text = result.content
      .map((item) => {
        if (item.type === 'text') {
          return item.text ?? '';
        }
        return JSON.stringify(item);
      })
      .join('\n');

    return text.trim() || result.content;
  }

  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const toolNameParam = req.query.toolName;
  const toolName = Array.isArray(toolNameParam) ? toolNameParam[0] : toolNameParam;

  if (!toolName) {
    return res.status(400).json({ success: false, error: 'Tool name is required' });
  }

  let args: Record<string, unknown> = {};
  try {
    if (typeof req.body === 'string') {
      args = JSON.parse(req.body);
    } else if (req.body) {
      args = req.body;
    }
  } catch (error) {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
  }

  try {
    const callResult = await withMcpClient(async (client, _transport) => {
      return client.callTool({
        name: toolName,
        arguments: args,
      });
    });

    const normalized = normalizeToolResult(callResult);

    return res.status(200).json({
      success: true,
      result: normalized,
      raw: callResult,
    });
  } catch (error) {
    console.error(`Failed to execute MCP tool ${toolName}`, error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to execute MCP tool',
    });
  }
}
