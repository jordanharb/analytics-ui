/**
 * Chat History Manager - Handles persistent storage of chat sessions
 * Uses localStorage for persistence across browser sessions
 */

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  provider?: string;
  model?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tools?: any[];
}

const MAX_SESSIONS = 50; // Limit to prevent localStorage bloat
const DEFAULT_NAMESPACE = 'woke_palantir';

export class ChatHistoryManager {
  private sessions: Map<string, ChatSession>;
  private currentSessionId: string | null;
  private storageKey: string;
  private currentSessionKey: string;

  constructor(namespace: string = DEFAULT_NAMESPACE) {
    this.sessions = new Map();
    this.currentSessionId = null;
    this.storageKey = `${namespace}_chat_sessions`;
    this.currentSessionKey = `${namespace}_current_session`;
    this.loadFromStorage();
  }

  /**
   * Load sessions from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        Object.entries(data).forEach(([id, session]) => {
          this.sessions.set(id, session as ChatSession);
        });
      }

      // Load current session ID
      const currentId = localStorage.getItem(this.currentSessionKey);
      if (currentId && this.sessions.has(currentId)) {
        this.currentSessionId = currentId;
      }
    } catch (error) {
      console.error('Failed to load chat history:', error);
    }
  }

  /**
   * Save sessions to localStorage
   */
  private saveToStorage(): void {
    try {
      // Convert Map to object for storage
      const data: Record<string, ChatSession> = {};
      this.sessions.forEach((session, id) => {
        data[id] = session;
      });

      localStorage.setItem(this.storageKey, JSON.stringify(data));

      if (this.currentSessionId) {
        localStorage.setItem(this.currentSessionKey, this.currentSessionId);
      }
    } catch (error) {
      console.error('Failed to save chat history:', error);

      // If localStorage is full, remove oldest sessions
      if (error instanceof DOMException && error.code === 22) {
        this.pruneOldSessions();
        this.saveToStorage(); // Retry after pruning
      }
    }
  }

  /**
   * Remove oldest sessions if we hit the limit
   */
  private pruneOldSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) {
      return;
    }

    // Sort sessions by updatedAt and remove oldest
    const sorted = Array.from(this.sessions.entries())
      .sort((a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime());

    const toRemove = sorted.slice(0, this.sessions.size - MAX_SESSIONS + 10); // Remove 10 extra
    toRemove.forEach(([id]) => {
      this.sessions.delete(id);
    });
  }

  /**
   * Create a new chat session
   */
  createSession(title?: string): ChatSession {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const session: ChatSession = {
      id,
      title: title || `Chat ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);
    this.currentSessionId = id;
    this.pruneOldSessions();
    this.saveToStorage();

    return session;
  }

  /**
   * Get current session (creates one if none exists)
   */
  getCurrentSession(): ChatSession {
    if (!this.currentSessionId || !this.sessions.has(this.currentSessionId)) {
      return this.createSession();
    }
    return this.sessions.get(this.currentSessionId)!;
  }

  /**
   * Set current session
   */
  setCurrentSession(sessionId: string): boolean {
    if (this.sessions.has(sessionId)) {
      this.currentSessionId = sessionId;
      this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Get all sessions sorted by last update
   */
  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Get a specific session
   */
  getSession(sessionId: string): ChatSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Add a message to the current session
   */
  addMessage(message: Message): void {
    const session = this.getCurrentSession();
    session.messages.push(message);
    session.updatedAt = new Date().toISOString();

    // Auto-title from first user message if needed
    if (session.messages.length === 1 && message.role === 'user' && session.title.startsWith('Chat ')) {
      session.title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    }

    this.saveToStorage();
  }

  /**
   * Update session metadata
   */
  updateSession(sessionId: string, updates: Partial<ChatSession>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    Object.assign(session, updates, {
      updatedAt: new Date().toISOString()
    });

    this.saveToStorage();
    return true;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    if (this.sessions.delete(sessionId)) {
      // If deleting current session, create a new one
      if (this.currentSessionId === sessionId) {
        this.createSession();
      }
      this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.currentSessionId = null;
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.currentSessionKey);
    this.createSession(); // Create a fresh session
  }

  /**
   * Export sessions as JSON
   */
  exportSessions(): string {
    const data: Record<string, ChatSession> = {};
    this.sessions.forEach((session, id) => {
      data[id] = session;
    });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import sessions from JSON
   */
  importSessions(jsonData: string): boolean {
    try {
      const data = JSON.parse(jsonData);
      Object.entries(data).forEach(([id, session]) => {
        this.sessions.set(id, session as ChatSession);
      });
      this.saveToStorage();
      return true;
    } catch (error) {
      console.error('Failed to import sessions:', error);
      return false;
    }
  }

  /**
   * Search messages across all sessions
   */
  searchMessages(query: string): Array<{session: ChatSession; message: Message}> {
    const results: Array<{session: ChatSession; message: Message}> = [];
    const searchTerm = query.toLowerCase();

    this.sessions.forEach(session => {
      session.messages.forEach(message => {
        if (message.content.toLowerCase().includes(searchTerm)) {
          results.push({ session, message });
        }
      });
    });

    return results;
  }
}
