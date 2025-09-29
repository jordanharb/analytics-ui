import { ClaudeProvider } from './providers/ClaudeProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { contextManager } from './providers/ContextManager';
import { getClaudeKey, getGeminiKey } from '../aiKeyStore';
import type { LLMProvider, MCPTool, StreamChunk, ProviderType, ModelInfo } from './providers/types';

export class MCPClient {
  private currentProvider: LLMProvider | null = null;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private tools: MCPTool[] = [];
  private isConnected: boolean = false;
  private apiBaseUrl: string;

  constructor(apiBaseUrl: string = '') {
    // Prefer explicit arg, else env var, else same-origin
    const envBase = (import.meta as any).env?.VITE_MCP_API_BASE_URL || '';
    this.apiBaseUrl = apiBaseUrl || envBase || '';
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize Claude if API key exists (env or local override)
    const claudeKey = getClaudeKey() || import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (claudeKey) {
      try {
        const claudeProvider = new ClaudeProvider(claudeKey);
        this.providers.set('claude', claudeProvider);

        // Set Claude as default if no provider is set
        if (!this.currentProvider) {
          this.currentProvider = claudeProvider;
        }
      } catch (error) {
        console.warn('Failed to initialize Claude provider:', error);
      }
    }

    // Initialize Gemini if API key exists (env or local override)
    const geminiKey = getGeminiKey() || import.meta.env.VITE_GOOGLE_API_KEY;
    if (geminiKey) {
      try {
        const geminiProvider = new GeminiProvider(geminiKey);
        this.providers.set('gemini', geminiProvider);

        // Set Gemini as default if Claude isn't available
        if (!this.currentProvider) {
          this.currentProvider = geminiProvider;
        }
      } catch (error) {
        console.warn('Failed to initialize Gemini provider:', error);
      }
    }

    // Load saved provider preference
    const savedProvider = localStorage.getItem('preferredProvider') as ProviderType;
    if (savedProvider && this.providers.has(savedProvider)) {
      this.currentProvider = this.providers.get(savedProvider)!;
    }
  }

  async connectToServer(): Promise<void> {
    try {
      console.log('Connecting to MCP server via HTTP...');

      // Fetch available tools from the server
      const response = await fetch(`${this.apiBaseUrl}/api/mcp/tools`);
      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.statusText}`);
      }

      const data = await response.json();
      this.tools = data.tools || [];
      this.isConnected = true;

      // Fetch and set context
      try {
        const contextResponse = await fetch(`${this.apiBaseUrl}/api/mcp/context`);
        if (contextResponse.ok) {
          const contextData = await contextResponse.json();
          // Store context for providers to use
          if (contextData.context) {
            this.setContextForProviders(contextData.context);
          }
        }
      } catch (error) {
        console.warn('Failed to fetch context:', error);
      }

      console.log('Connected with tools:', this.tools.map(t => t.name));
    } catch (error) {
      console.error('Failed to connect to MCP server:', error);
      this.isConnected = false;
      throw error;
    }
  }

  private setContextForProviders(context: string): void {
    contextManager.setMCPContext(context);
  }

  async executeTool(toolName: string, args: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Not connected to MCP server');
    }

    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`);
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/mcp/tools/${toolName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(args)
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed to execute tool ${toolName}`);
      }

      return data.result;
    } catch (error) {
      console.error(`Failed to execute tool ${toolName}:`, error);
      throw error;
    }
  }

  async processQuery(query: string): Promise<AsyncIterable<StreamChunk>> {
    if (!this.currentProvider) {
      throw new Error('No LLM provider available. Please configure API keys.');
    }

    // Create a wrapper that handles tool execution
    const toolExecutor = async (toolName: string, args: any) => {
      return this.executeTool(toolName, args);
    };

    // Pass both tools and executor to the provider
    return this.currentProvider.processQuery(query, this.tools, toolExecutor);
  }

  setProvider(providerType: ProviderType): boolean {
    const provider = this.providers.get(providerType);
    if (provider) {
      this.currentProvider = provider;
      localStorage.setItem('preferredProvider', providerType);
      return true;
    }
    return false;
  }

  getCurrentProvider(): ProviderType | null {
    if (!this.currentProvider) return null;

    for (const [type, provider] of this.providers.entries()) {
      if (provider === this.currentProvider) {
        return type;
      }
    }
    return null;
  }

  getAvailableProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  getAvailableModels(): ModelInfo[] {
    if (!this.currentProvider) return [];
    return this.currentProvider.getAvailableModels();
  }

  setModel(modelId: string): void {
    if (this.currentProvider) {
      this.currentProvider.setModel(modelId);
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.tools = [];
  }

  clearHistory(): void {
    if (this.currentProvider && typeof this.currentProvider.clearHistory === 'function') {
      this.currentProvider.clearHistory();
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  isServerConnected(): boolean {
    return this.isConnected;
  }

  hasProvider(): boolean {
    return this.currentProvider !== null;
  }
}
