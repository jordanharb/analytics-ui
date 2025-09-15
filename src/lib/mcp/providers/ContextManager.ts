/**
 * Manages context and system prompts for all LLM providers
 * Ensures consistent context across Claude and Gemini
 */

export class ContextManager {
  private systemContext: string = '';
  private projectContext: string = '';
  private mcpContext: string = '';

  constructor() {
    this.loadProjectContext();
  }

  private async loadProjectContext() {
    try {
      // Optionally load a project context file if configured
      const url = (import.meta as any).env?.VITE_PROJECT_CONTEXT_URL;
      if (!url) return;
      const response = await fetch(url);
      if (response.ok) this.projectContext = await response.text();
    } catch (error) {
      // Silent: optional context
    }
  }

  setMCPContext(context: string) {
    this.mcpContext = context;
    console.log('MCP context loaded:', context.substring(0, 200) + '...');
  }

  getSystemPrompt(): string {
    // Get current date and time information
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return `You are an AI assistant with access to MCP (Model Context Protocol) tools.
You can execute tools to search data, analyze trends, and interact with the system.

Current Date and Time: ${dateStr}, ${timeStr}
Timezone: ${timezone}
ISO Date: ${now.toISOString()}

${this.mcpContext ? `Database Query Context:\n${this.mcpContext}\n\n` : ''}
${this.projectContext ? `Project Context:\n${this.projectContext}\n\n` : ''}

When users ask questions, use the available tools when appropriate to provide accurate, data-driven responses.
Before crafting any SQL, review the schema included in the context and prefer read-only queries (SELECT/CTE).
Always explain what tools you're using and why.
When dealing with date-related queries, use the current date provided above as your reference point.`;
  }

  setProjectContext(context: string) {
    this.projectContext = context;
  }

  getProjectContext(): string {
    return this.projectContext;
  }

  updateSystemContext(context: string) {
    this.systemContext = context;
  }

  getFullContext(): string {
    return `${this.getSystemPrompt()}\n\n${this.systemContext}`;
  }
}

export const contextManager = new ContextManager();
