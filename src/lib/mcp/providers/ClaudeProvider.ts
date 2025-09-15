import { Anthropic } from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages/messages.js';
import type { LLMProvider, MCPTool, StreamChunk, ModelInfo } from './types';
import { contextManager } from './ContextManager';

export class ClaudeProvider implements LLMProvider {
  name = 'Claude';
  private anthropic: Anthropic;
  private currentModel: string = 'claude-sonnet-4-20250514';
  private messages: MessageParam[] = [];

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Claude API key is required');
    }

    this.anthropic = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  async *processQuery(query: string, tools?: MCPTool[], toolExecutor?: (name: string, args: any) => Promise<any>): AsyncIterable<StreamChunk> {
    // Initialize with system message if this is the first message
    if (this.messages.length === 0) {
      this.messages.push({
        role: 'assistant',
        content: contextManager.getSystemPrompt()
      });
    }

    // Add user message to history
    this.messages.push({
      role: 'user',
      content: query
    });

    try {
      // Convert MCP tools to Anthropic tool format
      const anthropicTools = tools?.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        input_schema: tool.inputSchema || {
          type: 'object',
          properties: {},
          required: []
        }
      }));

      const stream = await this.anthropic.messages.create({
        model: this.currentModel,
        max_tokens: 1000,
        messages: this.messages,
        tools: anthropicTools,
        stream: true
      });

      let accumulatedText = '';

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          accumulatedText += chunk.delta.text;
          yield {
            type: 'text',
            content: chunk.delta.text
          };
        } else if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
          yield {
            type: 'tool_start',
            tool: {
              id: chunk.content_block.id,
              name: chunk.content_block.name
            }
          };
        } else if (chunk.type === 'message_stop') {
          // Add assistant response to history
          this.messages.push({
            role: 'assistant',
            content: accumulatedText
          });
        }
      }
    } catch (error: any) {
      yield {
        type: 'error',
        error: error.message || 'Failed to process query with Claude'
      };
    }
  }

  isAvailable(): boolean {
    return true;
  }

  getAvailableModels(): ModelInfo[] {
    return [
      {
        id: 'claude-opus-4-1-20250805',
        name: 'Claude Opus 4.1',
        description: 'Most advanced reasoning with extended thinking',
        contextWindow: 200000,
        costPer1kTokens: {
          input: 0.015,
          output: 0.075
        }
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: 'Balanced capability and performance',
        contextWindow: 200000,
        costPer1kTokens: {
          input: 0.003,
          output: 0.015
        }
      },
      {
        id: 'claude-3-7-sonnet-20250224',
        name: 'Claude 3.7 Sonnet',
        description: 'Hybrid reasoning with step-by-step thinking',
        contextWindow: 200000,
        costPer1kTokens: {
          input: 0.003,
          output: 0.015
        }
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet (Legacy)',
        description: 'Previous generation balanced model',
        contextWindow: 200000,
        costPer1kTokens: {
          input: 0.003,
          output: 0.015
        }
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        description: 'Fast and efficient for simple tasks',
        contextWindow: 200000,
        costPer1kTokens: {
          input: 0.001,
          output: 0.005
        }
      }
    ];
  }

  setModel(modelId: string): void {
    this.currentModel = modelId;
  }

  clearHistory(): void {
    this.messages = [];
  }
}