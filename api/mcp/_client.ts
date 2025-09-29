import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const DEFAULT_SERVER_URL = 'https://woke-palantir-mcp.vercel.app/mcp';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || DEFAULT_SERVER_URL;

if (!MCP_SERVER_URL) {
  throw new Error('MCP_SERVER_URL is not configured.');
}

interface CreateClientOptions {
  /** Optional session identifier to reuse MCP session */
  sessionId?: string;
  /** Optional fetch implementation override */
  fetchImpl?: typeof fetch;
}

export async function createMcpClient(options: CreateClientOptions = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    fetch: options.fetchImpl,
    sessionId: options.sessionId,
  });

  const client = new Client(
    { name: 'analytics-ui', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } }
  );

  await client.connect(transport);

  return { client, transport };
}

export async function withMcpClient<T>(handler: (client: Client, transport: StreamableHTTPClientTransport) => Promise<T>) {
  const { client, transport } = await createMcpClient();

  try {
    return await handler(client, transport);
  } finally {
    try {
      await transport.close();
    } catch (error) {
      console.warn('Failed to close MCP transport', error);
    }
    client.close();
  }
}
