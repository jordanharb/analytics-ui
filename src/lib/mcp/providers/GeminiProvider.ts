import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type { LLMProvider, MCPTool, StreamChunk, ModelInfo } from './types';
import { contextManager } from './ContextManager';

export class GeminiProvider implements LLMProvider {
  name = 'Gemini';
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private currentModelId: string = 'gemini-2.5-flash';
  private chatHistory: Array<{ role: string; parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }> }> = [];
  private processedCallKeys = new Set<string>();
  private toolCounter = 0;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: this.currentModelId });
  }

  async *processQuery(query: string, tools?: MCPTool[], toolExecutor?: (name: string, args: any) => Promise<any>): AsyncIterable<StreamChunk> {
    try {
      console.log('Using Gemini model:', this.currentModelId);

      // Reset processed call keys per query
      this.processedCallKeys.clear();

      // Convert MCP tools to Gemini function declarations
      const functionDeclarations = tools?.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || {
          type: 'object',
          properties: {},
          required: []
        }
      }));

      console.log('Available tools:', functionDeclarations?.map(t => t.name));

      // Update model with tools if provided
      if (functionDeclarations && functionDeclarations.length > 0) {
        this.model = this.genAI.getGenerativeModel({
          model: this.currentModelId,
          tools: [{
            functionDeclarations
          }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
          }
        });
      } else {
        this.model = this.genAI.getGenerativeModel({
          model: this.currentModelId,
          generationConfig: {
            temperature: 0.7,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
          }
        });
      }

      // Initialize with system context if this is the first message
      const systemPrompt = contextManager.getSystemPrompt();

      // Start chat session with history
      const chat = this.model.startChat({
        history: this.chatHistory.length === 0
          ? [{ role: 'user', parts: [{ text: systemPrompt }] } as any,
             { role: 'model', parts: [{ text: 'Understood. I have access to MCP tools and will help you with your queries.' }] } as any]
          : this.chatHistory as any
      });

      // Send the initial message and handle the response
      const result = await this.sendMessageWithRetry(chat, query);
      const response = result.response;

      // Check if we have function calls
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        console.log('Function calls detected:', functionCalls.length);

        // Store function responses to send back to Gemini
        const functionResponses: any[] = [];

        for (let i = 0; i < functionCalls.length; i++) {
          const call = functionCalls[i];
          const callKey = JSON.stringify({ name: call.name, args: call.args });
          const toolId = `tool-${++this.toolCounter}`;

          // Skip if this exact call was already processed
          if (this.processedCallKeys.has(callKey)) {
            console.warn('Skipping duplicate function call:', call.name);
            continue;
          }
          this.processedCallKeys.add(callKey);

          // Yield tool start event
          yield {
            type: 'tool_start',
            tool: {
              id: toolId,
              name: call.name,
              arguments: call.args
            }
          };

          // Execute the tool if executor is provided
          if (toolExecutor) {
            try {
              console.log(`Executing tool ${call.name} with args:`, call.args);
              const toolResult = await toolExecutor(call.name, call.args);

              // Yield tool result event
              yield {
                type: 'tool_result',
                content: JSON.stringify(toolResult)
              };

              // Store the function response to send back to Gemini
              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  response: toolResult
                }
              });
            } catch (error) {
              console.error(`Tool execution failed for ${call.name}:`, error);

              yield {
                type: 'tool_result',
                content: `Error executing ${call.name}: ${error}`
              };

              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { error: String(error) }
                }
              });
            }
          } else {
            yield {
              type: 'tool_result',
              content: `Tool ${call.name} would be executed (no executor provided)`
            };
          }
        }

        // Send function responses back to Gemini to get the final answer
        if (functionResponses.length > 0) {
          console.log('Sending function responses back to Gemini for final answer');

          try {
            // Send all function responses back to Gemini
            const finalResult = await this.sendMessageWithRetry(chat, functionResponses);
            const finalResponse = finalResult.response;

            // Get the final text response
            let finalText = '';
            try {
              finalText = finalResponse.text();
            } catch (e) {
              console.log('No text in final response');
            }

            if (finalText && finalText.trim()) {
              yield {
                type: 'text',
                content: finalText
              };
            } else {
              yield {
                type: 'text',
                content: 'I\'ve analyzed the results from the tools.'
              };
            }

            // Update history with the complete exchange
            this.chatHistory.push(
              { role: 'user', parts: [{ text: query }] },
              { role: 'model', parts: functionCalls.map((fc: any) => ({ functionCall: fc })) },
              { role: 'user', parts: functionResponses },
              { role: 'model', parts: [{ text: finalText || 'Processed successfully' }] }
            );
          } catch (error) {
            console.error('Failed to get final response after function execution:', error);
            yield {
              type: 'text',
              content: 'I executed the tools but encountered an issue generating a final response. Please try again.'
            };
          }
        }
      } else {
        // No function calls, just get the text response
        let text = '';
        try {
          text = response.text();
        } catch (e) {
          console.log('No text content in response');
        }

        if (text && text.trim()) {
          yield {
            type: 'text',
            content: text
          };

          // Store in history
          this.chatHistory.push(
            { role: 'user', parts: [{ text: query }] },
            { role: 'model', parts: [{ text }] }
          );
        } else {
          yield {
            type: 'text',
            content: 'I\'m not sure how to respond to that. Could you please rephrase your question?'
          };
        }
      }

    } catch (error: any) {
      console.error('Gemini API Error:', error);
      console.error('Error details:', {
        message: error.message,
        statusCode: error.statusCode,
        statusText: error.statusText
      });

      yield {
        type: 'error',
        error: `Gemini API Error: ${error.message || 'Failed to process query'}. Try switching to a different model or checking your API key.`
      };
    }
  }

  private async sendMessageWithRetry(chat: any, message: any, maxRetries: number = 3): Promise<any> {
    let retries = 0;
    let lastError: any;

    while (retries < maxRetries) {
      try {
        return await chat.sendMessage(message);
      } catch (error: any) {
        lastError = error;

        // Check if it's a 503 error (overloaded)
        if (error.message?.includes('503') || error.message?.includes('overloaded')) {
          retries++;
          if (retries < maxRetries) {
            console.log(`Gemini overloaded, retrying in ${retries * 2} seconds... (attempt ${retries + 1}/${maxRetries})`);
            // Wait before retrying with exponential backoff
            await new Promise(resolve => setTimeout(resolve, retries * 2000));
            continue;
          }
        }

        // For other errors or max retries reached, throw immediately
        throw error;
      }
    }

    // If we get here, we've exhausted retries
    throw lastError || new Error('Failed to get response from Gemini after retries');
  }

  isAvailable(): boolean {
    return true;
  }

  getAvailableModels(): ModelInfo[] {
    return [
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Best price/performance ratio with thinking capabilities',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.000075,
          output: 0.0003
        }
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Most advanced reasoning with adaptive thinking',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.00125,
          output: 0.00375
        }
      },
      {
        id: 'gemini-2.5-flash-lite-preview-06-17',
        name: 'Gemini 2.5 Flash Lite',
        description: 'Low-cost, high-performance variant',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.00005,
          output: 0.0002
        }
      },
      {
        id: 'gemini-2.0-flash-exp',
        name: 'Gemini 2.0 Flash (Experimental)',
        description: 'Previous generation experimental model',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.00,
          output: 0.00
        }
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        description: 'Legacy model with 2M token context',
        contextWindow: 2097152, // 2M tokens
        costPer1kTokens: {
          input: 0.00125,
          output: 0.00375
        }
      },
      {
        id: 'gemini-1.5-flash',
        name: 'Gemini 1.5 Flash',
        description: 'Legacy fast and efficient model',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.000075,
          output: 0.0003
        }
      },
      {
        id: 'gemini-1.5-flash-8b',
        name: 'Gemini 1.5 Flash-8B',
        description: 'Smallest and fastest legacy model',
        contextWindow: 1048576, // 1M tokens
        costPer1kTokens: {
          input: 0.0000375,
          output: 0.00015
        }
      }
    ];
  }

  setModel(modelId: string): void {
    this.currentModelId = modelId;
    this.model = this.genAI.getGenerativeModel({ model: modelId });
  }

  clearHistory(): void {
    this.chatHistory = [];
    this.processedCallKeys.clear();
  }
}
