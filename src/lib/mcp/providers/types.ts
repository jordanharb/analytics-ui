export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_result' | 'error';
  content?: string;
  tool?: {
    id: string;
    name: string;
    arguments?: any;
  };
  error?: string;
}

export interface LLMProvider {
  name: string;
  processQuery(query: string, tools?: MCPTool[], toolExecutor?: (name: string, args: any) => Promise<any>): AsyncIterable<StreamChunk>;
  isAvailable(): boolean;
  getAvailableModels(): ModelInfo[];
  setModel(modelId: string): void;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  contextWindow?: number;
  costPer1kTokens?: {
    input: number;
    output: number;
  };
}

export type ProviderType = 'claude' | 'gemini';

export interface ProviderConfig {
  type: ProviderType;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}