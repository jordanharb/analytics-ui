import type { EmailReportPrompt } from '../types/emailReports';

interface PromptPayload {
  prompt_type: EmailReportPrompt['prompt_type'];
  name: string;
  description?: string;
  prompt_template: string;
  set_default?: boolean;
}

const promptsApi = {
  async list(promptType?: EmailReportPrompt['prompt_type']): Promise<EmailReportPrompt[]> {
    return window.api.listEmailReportPrompts(promptType) as Promise<EmailReportPrompt[]>;
  },

  async create(payload: PromptPayload): Promise<EmailReportPrompt> {
    return window.api.createEmailReportPrompt(payload) as Promise<EmailReportPrompt>;
  },

  async update(id: string, payload: Partial<PromptPayload>): Promise<EmailReportPrompt> {
    return window.api.updateEmailReportPrompt({ id, ...payload }) as Promise<EmailReportPrompt>;
  }
};

export default promptsApi;
