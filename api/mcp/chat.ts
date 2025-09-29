import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from '@ai-sdk/google';
import { streamText, convertToCoreMessages, Message } from 'ai';
import { z } from 'zod';
import { Readable } from 'node:stream';

import { withMcpClient } from './_client';

const DEFAULT_MODEL = process.env.GOOGLE_GEMINI_MODEL ?? 'gemini-1.5-pro-002';

const baseSystemPrompt = `You are the Woke Palantir analytics assistant. You use the Model Context Protocol to call investigative tools.

Guidelines:
- Use the \"callMcpTool\" function whenever you need structured data.
- Always choose the most relevant tool for the question and pass precise arguments.
- Provide concise natural-language summaries that cite tool outputs.
- If a tool errors, acknowledge it and suggest alternative follow-ups.
- Never fabricate data; rely only on tool results or the conversation history.
`;

function formatToolList(tools: Array<{ name: string; description?: string }>) {
  if (!tools.length) return 'No MCP tools are currently available.';
  return tools
    .map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`)
    .join('\n');
}

function normalizeToolResult(result: any) {
  if (!result) return null;
  if (result.structuredContent) {
    return result.structuredContent;
  }
  if (Array.isArray(result.content) && result.content.length > 0) {
    const textChunks = result.content
      .filter((item: any) => item.type === 'text' && item.text)
      .map((item: any) => item.text as string);
    if (textChunks.length > 0) {
      return textChunks.join('\n');
    }
  }
  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body: { id?: string; messages?: Message[] } = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch (error) {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];

  let availableTools: Array<{ name: string; description?: string }> = [];
  try {
    availableTools = await withMcpClient(async (client) => {
      const result = await client.listTools({});
      return result.tools.map((tool) => ({ name: tool.name, description: tool.description ?? undefined }));
    });
  } catch (error) {
    console.error('Failed to fetch MCP tools', error);
  }

  const toolListText = formatToolList(availableTools);

  try {
    const result = await streamText({
      model: google(DEFAULT_MODEL),
      system: `${baseSystemPrompt}\nAvailable MCP tools:\n${toolListText}`,
      messages: convertToCoreMessages(messages),
      maxSteps: 8,
      temperature: 0.4,
      tools: {
        callMcpTool: {
          description:
            'Call a remote MCP tool by name. Choose a tool from the provided list and pass the correct JSON arguments.',
          parameters: z.object({
            name: z.string().describe('Tool name. Must be one of the MCP tools listed in the prompt.'),
            arguments: z.record(z.any()).optional().describe('Arguments to forward to the MCP tool.'),
          }),
          execute: async ({ name, arguments: args }) => {
            try {
              const callResult = await withMcpClient(async (client) => {
                return client.callTool({ name, arguments: args ?? {} });
              });
              return normalizeToolResult(callResult);
            } catch (error) {
              console.error(`MCP tool ${name} failed`, error);
              return {
                error: error instanceof Error ? error.message : 'Tool execution failed.',
              };
            }
          },
        },
      },
    });

    const response = result.toDataStreamResponse();

    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(response.body as unknown as ReadableStream);
    nodeStream.pipe(res);
  } catch (error) {
    console.error('Chat streaming failed', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
}
