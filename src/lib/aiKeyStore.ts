// Simple client-side key store using localStorage

const CLAUDE_KEY = 'ai.claude.apiKey';
const GEMINI_KEY = 'ai.gemini.apiKey';

export function getClaudeKey(): string | null {
  try {
    return localStorage.getItem(CLAUDE_KEY);
  } catch {
    return null;
  }
}

export function setClaudeKey(key: string | null): void {
  try {
    if (key && key.trim()) localStorage.setItem(CLAUDE_KEY, key.trim());
    else localStorage.removeItem(CLAUDE_KEY);
  } catch {}
}

export function getGeminiKey(): string | null {
  try {
    return localStorage.getItem(GEMINI_KEY);
  } catch {
    return null;
  }
}

export function setGeminiKey(key: string | null): void {
  try {
    if (key && key.trim()) localStorage.setItem(GEMINI_KEY, key.trim());
    else localStorage.removeItem(GEMINI_KEY);
  } catch {}
}


