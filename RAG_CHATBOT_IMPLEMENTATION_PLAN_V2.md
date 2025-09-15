# RAG AI Chatbot Implementation Plan V2
## Integrated Analytics-UI Architecture with GPT-5

---

## Overview
This implementation integrates a RAG chatbot directly into the existing analytics-ui React application as a new tab, using GPT-5 models and sharing the main .env configuration.

---

## Architecture Changes from V1

### Key Adaptations:
1. **Frontend Integration**: New tab in Woke Palantir navigation instead of separate app
2. **GPT-5 Models**: Using `gpt-5-nano` for embeddings, `gpt-5` for chat completion
3. **Shared Configuration**: Uses existing `.env` file with additional OpenAI keys
4. **Backend Structure**: Python FastAPI service alongside existing Flask API
5. **Unified Database**: Leverages existing Supabase with pgvector extension

---

## Phase 1: Environment Setup

### 1.1 Update Main .env File
Add to `/Users/jordanharb/Documents/tpusa-social-monitoring/.env`:
```bash
# OpenAI Configuration (GPT-5)
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...
VECTOR_EMBEDDING_MODEL=text-embedding-3-small  # Still use this for cost efficiency
CHAT_MODEL=gpt-5  # Main GPT-5 model
CHAT_MODEL_MINI=gpt-5-mini  # For faster responses
CHAT_MODEL_NANO=gpt-5-nano  # For low-latency operations
GPT5_REASONING_EFFORT=medium  # low, medium, high
GPT5_VERBOSITY=medium  # low, medium, high
MAX_CONTEXT_TOKENS=400000  # GPT-5 supports 400K
MAX_OUTPUT_TOKENS=128000  # GPT-5 max output

# Chatbot Settings
CHATBOT_ENABLED=true
CHATBOT_PORT=8001  # Different from main API port
CHATBOT_RATE_LIMIT_PER_MINUTE=60
CHATBOT_CACHE_TTL=3600
```

### 1.2 Project Structure Within analytics-ui
```
web/analytics-ui/
├── src/
│   ├── views/
│   │   ├── ChatView/            # NEW: Chat interface
│   │   │   ├── ChatView.tsx
│   │   │   ├── ChatView.css
│   │   │   └── components/
│   │   │       ├── ChatInput.tsx
│   │   │       ├── ChatMessage.tsx
│   │   │       ├── ChatHistory.tsx
│   │   │       └── ToolExecution.tsx
│   │   ├── MapView/
│   │   ├── DirectoryView/
│   │   └── EntityView/
│   │
│   ├── api/
│   │   ├── chatClient.ts        # NEW: Chat API client
│   │   └── analyticsClient.ts
│   │
│   ├── components/
│   │   └── Header/
│   │       └── Header.tsx       # UPDATE: Add Chat tab
│   │
│   └── App.tsx                  # UPDATE: Add chat route
│
├── chatbot/                      # NEW: Python backend
│   ├── __init__.py
│   ├── main.py                  # FastAPI app
│   ├── config.py                # Load from main .env
│   ├── models.py                # Pydantic models
│   ├── services/
│   │   ├── __init__.py
│   │   ├── gpt5_service.py      # GPT-5 integration
│   │   ├── embedding_service.py # Embeddings
│   │   ├── rag_service.py       # RAG pipeline
│   │   └── supabase_service.py  # DB integration
│   │
│   ├── tools/                   # GPT-5 custom tools
│   │   ├── __init__.py
│   │   ├── event_search.py
│   │   ├── actor_analysis.py
│   │   ├── network_graph.py
│   │   └── trend_detection.py
│   │
│   └── requirements.txt
│
└── package.json                  # UPDATE: Add chat deps
```

### 1.3 Python Dependencies for Chatbot
Create `web/analytics-ui/chatbot/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.32.0
openai==1.55.0  # Latest with GPT-5 support
supabase==2.10.0
redis==5.2.0
pydantic==2.9.0
python-dotenv==1.0.1
httpx==0.27.0
sse-starlette==2.1.0
tiktoken==0.8.0
numpy==1.26.4
scikit-learn==1.5.2
asyncpg==0.30.0  # For direct Postgres access
pgvector==0.3.0  # PostgreSQL vector support
tenacity==9.0.0
structlog==24.4.0
prometheus-client==0.21.0
```

---

## Phase 2: Frontend Integration

### 2.1 Update Header Component
Update `src/components/Header/Header.tsx`:
```typescript
import React from 'react';
import { NavLink } from 'react-router-dom';
import './Header.css';

export const Header: React.FC = () => {
  return (
    <header className="woke-palantir-nav">
      <div className="brand-section">
        <div className="live-indicator"></div>
        <span>WOKE PALANTIR</span>
      </div>
      
      <div className="nav-tabs">
        <NavLink to="/map" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          Map View
        </NavLink>
        <NavLink to="/directory" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          List View
        </NavLink>
        <NavLink to="/chat" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
          AI Assistant
        </NavLink>
      </div>
      
      <div className="nav-actions">
        <span className="text-sm text-gray-500">Real-time Event Monitoring</span>
      </div>
    </header>
  );
};
```

### 2.2 Update App.tsx Routes
Add to `src/App.tsx`:
```typescript
import { ChatView } from './views/ChatView/ChatView';

// In Routes component:
<Route path="/chat" element={<ChatView />} />
```

### 2.3 Create Chat View Component
Create `src/views/ChatView/ChatView.tsx`:
```typescript
import React, { useState, useEffect, useRef } from 'react';
import { chatClient } from '../../api/chatClient';
import { useFiltersStore } from '../../state/filtersStore';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { ChatHistory } from './components/ChatHistory';
import './ChatView.css';

export const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { appliedFilters } = useFiltersStore();

  useEffect(() => {
    // Initialize session
    const initSession = async () => {
      const id = await chatClient.createSession();
      setSessionId(id);
      // Load history if exists
      const history = await chatClient.getHistory(id);
      setMessages(history);
    };
    initSession();
  }, []);

  const handleSendMessage = async (content: string) => {
    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    setIsStreaming(true);

    // Stream GPT-5 response
    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      tools: []
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const stream = await chatClient.streamChat({
        message: content,
        sessionId,
        context: {
          filters: appliedFilters,
          viewContext: window.location.pathname
        },
        model: 'gpt-5',  // Use GPT-5
        reasoning_effort: 'medium',
        verbosity: 'medium'
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content') {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1].content += chunk.content;
            return updated;
          });
        } else if (chunk.type === 'tool_call') {
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1].tools?.push(chunk.tool);
            return updated;
          });
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-container">
        <div className="chat-sidebar">
          <ChatHistory sessionId={sessionId} onSelectSession={setSessionId} />
        </div>
        
        <div className="chat-main">
          <div className="chat-messages">
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isStreaming && (
              <div className="streaming-indicator">
                <span className="typing-dots"></span>
                GPT-5 is thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <ChatInput 
            onSend={handleSendMessage} 
            disabled={isStreaming}
            placeholder="Ask about events, actors, trends, or connections..."
          />
        </div>
      </div>
    </div>
  );
};
```

### 2.4 Create Chat API Client
Create `src/api/chatClient.ts`:
```typescript
interface ChatRequest {
  message: string;
  sessionId: string;
  context?: any;
  model?: 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  verbosity?: 'low' | 'medium' | 'high';
}

class ChatClient {
  private baseUrl = import.meta.env.VITE_CHATBOT_URL || 'http://localhost:8001';

  async createSession(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json();
    return data.session_id;
  }

  async streamChat(request: ChatRequest): AsyncIterableIterator<ChatChunk> {
    const response = await fetch(`${this.baseUrl}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          yield data;
        }
      }
    }
  }

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const response = await fetch(`${this.baseUrl}/api/v1/sessions/${sessionId}/history`);
    const data = await response.json();
    return data.messages;
  }
}

export const chatClient = new ChatClient();
```

---

## Phase 3: Backend Implementation with GPT-5

### 3.1 FastAPI Main Application
Create `web/analytics-ui/chatbot/main.py`:
```python
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import os
from dotenv import load_dotenv
import asyncio
from typing import AsyncGenerator

from .models import ChatRequest, ChatResponse, SessionCreate
from .services.gpt5_service import GPT5Service
from .services.rag_service import RAGService
from .services.supabase_service import SupabaseService
from .tools import get_available_tools

# Load main .env file
load_dotenv(dotenv_path="../../../.env")

app = FastAPI(title="Woke Palantir AI Assistant")

# CORS for analytics-ui
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
gpt5_service = GPT5Service()
rag_service = RAGService()
supabase_service = SupabaseService()

@app.post("/api/v1/chat/stream")
async def stream_chat(request: ChatRequest):
    """Stream chat responses using GPT-5 with RAG"""
    
    async def generate() -> AsyncGenerator[str, None]:
        try:
            # Retrieve relevant context using RAG
            context = await rag_service.retrieve_context(
                query=request.message,
                filters=request.context.get("filters") if request.context else None
            )
            
            # Get available tools based on query
            tools = get_available_tools(request.message)
            
            # Stream GPT-5 response
            async for chunk in gpt5_service.stream_completion(
                messages=[
                    {
                        "role": "system",
                        "content": f"""You are an AI assistant for Woke Palantir, a system that tracks political and social events, actor networks, and trends.
                        
                        Context from database:
                        {context}
                        
                        Current filters: {request.context.get('filters') if request.context else 'None'}
                        
                        You have access to tools for searching events, analyzing actors, detecting trends, and exploring networks.
                        Always cite your sources when using retrieved information."""
                    },
                    {"role": "user", "content": request.message}
                ],
                model=request.model or "gpt-5",
                tools=tools,
                reasoning_effort=request.reasoning_effort or "medium",
                verbosity=request.verbosity or "medium",
                stream=True
            ):
                yield f"data: {chunk}\n\n"
                
        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/v1/sessions")
async def create_session(session: SessionCreate):
    """Create a new chat session"""
    session_id = await supabase_service.create_session(session.metadata)
    return {"session_id": session_id}

@app.get("/api/v1/sessions/{session_id}/history")
async def get_session_history(session_id: str):
    """Get chat history for a session"""
    messages = await supabase_service.get_session_history(session_id)
    return {"messages": messages}
```

### 3.2 GPT-5 Service Implementation
Create `web/analytics-ui/chatbot/services/gpt5_service.py`:
```python
import os
from openai import AsyncOpenAI
from typing import List, Dict, Any, AsyncGenerator
import json

class GPT5Service:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.default_model = os.getenv("CHAT_MODEL", "gpt-5")
        
    async def stream_completion(
        self,
        messages: List[Dict[str, str]],
        model: str = None,
        tools: List[Dict] = None,
        reasoning_effort: str = "medium",
        verbosity: str = "medium",
        stream: bool = True
    ) -> AsyncGenerator[str, None]:
        """Stream completion from GPT-5 with new parameters"""
        
        model = model or self.default_model
        
        # Build request with GPT-5 specific parameters
        request_params = {
            "model": model,
            "messages": messages,
            "stream": stream,
            "temperature": 0.7,
            "max_tokens": 128000 if model == "gpt-5" else 64000,
            # GPT-5 specific parameters
            "reasoning_effort": reasoning_effort,  # New in GPT-5
            "verbosity": verbosity,  # New in GPT-5
        }
        
        # Add custom tools if provided (GPT-5 feature)
        if tools:
            request_params["tools"] = tools
            request_params["tool_choice"] = "auto"
            # GPT-5 supports custom tools with plaintext
            request_params["custom_tools"] = True
        
        try:
            response = await self.client.chat.completions.create(**request_params)
            
            if stream:
                async for chunk in response:
                    if chunk.choices[0].delta.content:
                        yield json.dumps({
                            "type": "content",
                            "content": chunk.choices[0].delta.content
                        })
                    elif chunk.choices[0].delta.tool_calls:
                        for tool_call in chunk.choices[0].delta.tool_calls:
                            yield json.dumps({
                                "type": "tool_call",
                                "tool": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments
                                }
                            })
            else:
                yield json.dumps({
                    "type": "complete",
                    "content": response.choices[0].message.content
                })
                
        except Exception as e:
            yield json.dumps({"type": "error", "error": str(e)})

    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding using text-embedding-3-small for cost efficiency"""
        response = await self.client.embeddings.create(
            model=os.getenv("VECTOR_EMBEDDING_MODEL", "text-embedding-3-small"),
            input=text
        )
        return response.data[0].embedding
```

### 3.3 RAG Service with Supabase pgvector
Create `web/analytics-ui/chatbot/services/rag_service.py`:
```python
import os
from typing import List, Dict, Any, Optional
from .gpt5_service import GPT5Service
from .supabase_service import SupabaseService
import asyncpg
import numpy as np

class RAGService:
    def __init__(self):
        self.gpt5 = GPT5Service()
        self.supabase = SupabaseService()
        self.db_url = os.getenv("SUPABASE_URL").replace("https://", "postgresql://postgres:") + "@db." + os.getenv("SUPABASE_URL").split("//")[1].split(".")[0] + ".supabase.co:5432/postgres"
        
    async def retrieve_context(
        self, 
        query: str, 
        filters: Optional[Dict] = None,
        k: int = 10
    ) -> str:
        """Retrieve relevant context using hybrid search"""
        
        # Generate query embedding
        query_embedding = await self.gpt5.generate_embedding(query)
        
        # Connect to Supabase directly for pgvector operations
        conn = await asyncpg.connect(self.db_url)
        
        try:
            # Hybrid search: Vector similarity + keyword matching
            
            # 1. Vector similarity search on events
            vector_results = await conn.fetch("""
                SELECT 
                    e.id,
                    e.name,
                    e.description,
                    e.event_date,
                    e.location_json,
                    1 - (e.embedding <=> $1::vector) as similarity
                FROM v2_events e
                WHERE e.embedding IS NOT NULL
                    AND ($2::date IS NULL OR e.event_date >= $2)
                    AND ($3::date IS NULL OR e.event_date <= $3)
                ORDER BY e.embedding <=> $1::vector
                LIMIT $4
            """, 
            query_embedding,
            filters.get('date_range', {}).get('start') if filters else None,
            filters.get('date_range', {}).get('end') if filters else None,
            k)
            
            # 2. Keyword search on actors
            actor_results = await conn.fetch("""
                SELECT 
                    a.id,
                    a.name,
                    a.bio,
                    a.actor_type,
                    ts_rank(
                        to_tsvector('english', coalesce(a.name, '') || ' ' || coalesce(a.bio, '')),
                        plainto_tsquery('english', $1)
                    ) as rank
                FROM v2_actors a
                WHERE to_tsvector('english', coalesce(a.name, '') || ' ' || coalesce(a.bio, ''))
                    @@ plainto_tsquery('english', $1)
                ORDER BY rank DESC
                LIMIT $2
            """, query, k // 2)
            
            # 3. Get recent trending topics if relevant
            trend_results = await self.supabase.client.rpc(
                'get_trending_tags',
                {'days_back': 7, 'limit_count': 5}
            ).execute()
            
            # Format context
            context_parts = []
            
            if vector_results:
                context_parts.append("Relevant Events:")
                for event in vector_results[:5]:
                    context_parts.append(
                        f"- {event['name']} ({event['event_date']}): {event['description'][:200]}..."
                    )
            
            if actor_results:
                context_parts.append("\nRelevant Actors:")
                for actor in actor_results[:3]:
                    context_parts.append(
                        f"- {actor['name']} ({actor['actor_type']}): {actor['bio'][:150] if actor['bio'] else 'No bio available'}..."
                    )
            
            if trend_results.data:
                context_parts.append("\nCurrent Trends:")
                for trend in trend_results.data[:3]:
                    context_parts.append(f"- {trend['tag']}: {trend['count']} events")
            
            return "\n".join(context_parts)
            
        finally:
            await conn.close()
```

### 3.4 Woke Palantir Tools for GPT-5
Create `web/analytics-ui/chatbot/tools/event_search.py`:
```python
from typing import Dict, Any, List
import json

class EventSearchTool:
    """Tool for searching and analyzing events"""
    
    name = "search_events"
    description = "Search for events by date, location, tags, or keywords"
    
    # GPT-5 custom tool definition with grammar constraints
    schema = {
        "type": "function",
        "function": {
            "name": "search_events",
            "description": "Search for events in the Woke Palantir database",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "date_start": {"type": "string", "format": "date"},
                    "date_end": {"type": "string", "format": "date"},
                    "states": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "limit": {"type": "integer", "default": 10}
                },
                "required": ["query"]
            }
        }
    }
    
    async def execute(self, params: Dict[str, Any], supabase_client) -> Dict[str, Any]:
        """Execute event search"""
        
        # Build filters
        filters = {
            "date_range": {
                "start": params.get("date_start"),
                "end": params.get("date_end")
            } if params.get("date_start") or params.get("date_end") else None,
            "states": params.get("states"),
            "tags": params.get("tags")
        }
        
        # Remove None values
        filters = {k: v for k, v in filters.items() if v is not None}
        
        # Call Supabase RPC function
        result = await supabase_client.rpc(
            'analytics_city_events_keyset',
            {
                **filters,
                "limit_count": params.get("limit", 10)
            }
        ).execute()
        
        return {
            "events": result.data,
            "count": len(result.data),
            "query": params["query"],
            "filters_applied": filters
        }
```

---

## Phase 4: Database Setup

### 4.1 Enable pgvector and Create Tables
Run in Supabase SQL Editor:
```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to events table
ALTER TABLE v2_events 
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Add embedding column to actors table  
ALTER TABLE v2_actors
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create indexes for similarity search
CREATE INDEX IF NOT EXISTS events_embedding_idx 
ON v2_events USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS actors_embedding_idx
ON v2_actors USING ivfflat (embedding vector_cosine_ops)  
WITH (lists = 100);

-- Create chat sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB,
    user_id TEXT
);

-- Create chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_chat_messages_session 
ON chat_messages(session_id, created_at DESC);

-- Function to search similar events
CREATE OR REPLACE FUNCTION search_similar_events(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    date_start date DEFAULT NULL,
    date_end date DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    description TEXT,
    event_date DATE,
    similarity float
)
LANGUAGE sql STABLE
AS $$
    SELECT
        e.id,
        e.name,
        e.description,
        e.event_date,
        1 - (e.embedding <=> query_embedding) AS similarity
    FROM v2_events e
    WHERE e.embedding IS NOT NULL
        AND 1 - (e.embedding <=> query_embedding) > match_threshold
        AND (date_start IS NULL OR e.event_date >= date_start)
        AND (date_end IS NULL OR e.event_date <= date_end)
    ORDER BY e.embedding <=> query_embedding
    LIMIT match_count;
$$;
```

### 4.2 Populate Initial Embeddings
Create `web/analytics-ui/chatbot/scripts/populate_embeddings.py`:
```python
import asyncio
import os
from supabase import create_client
from openai import AsyncOpenAI
from tqdm import tqdm
import numpy as np

async def generate_embeddings():
    """Generate embeddings for existing events and actors"""
    
    # Initialize clients
    supabase = create_client(
        os.getenv("SUPABASE_URL"),
        os.getenv("SUPABASE_SERVICE_KEY")
    )
    openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    
    print("Generating embeddings for events...")
    
    # Get events without embeddings
    events = supabase.table('v2_events')\
        .select('id, name, description')\
        .is_('embedding', None)\
        .limit(1000)\
        .execute()
    
    for event in tqdm(events.data):
        # Create text for embedding
        text = f"{event['name']} {event['description'] or ''}"[:8000]
        
        # Generate embedding
        response = await openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        embedding = response.data[0].embedding
        
        # Update database
        supabase.table('v2_events')\
            .update({'embedding': embedding})\
            .eq('id', event['id'])\
            .execute()
    
    print("Generating embeddings for actors...")
    
    # Get actors without embeddings
    actors = supabase.table('v2_actors')\
        .select('id, name, bio')\
        .is_('embedding', None)\
        .limit(1000)\
        .execute()
    
    for actor in tqdm(actors.data):
        # Create text for embedding
        text = f"{actor['name']} {actor['bio'] or ''}"[:8000]
        
        # Generate embedding
        response = await openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        embedding = response.data[0].embedding
        
        # Update database
        supabase.table('v2_actors')\
            .update({'embedding': embedding})\
            .eq('id', actor['id'])\
            .execute()
    
    print("Embeddings generated successfully!")

if __name__ == "__main__":
    asyncio.run(generate_embeddings())
```

---

## Phase 5: Deployment

### 5.1 Development Setup
```bash
# From analytics-ui directory
cd web/analytics-ui

# Install Python dependencies
cd chatbot
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run FastAPI backend
uvicorn main:app --reload --port 8001

# In another terminal, run React dev server
cd ..
npm install
npm run dev
```

### 5.2 Production Deployment
Create `web/analytics-ui/chatbot/Dockerfile`:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Use main .env from parent directory
ENV PYTHONPATH=/app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### 5.3 Update package.json Scripts
Add to `web/analytics-ui/package.json`:
```json
{
  "scripts": {
    "dev": "vite",
    "dev:full": "concurrently \"npm run dev\" \"npm run chatbot:dev\"",
    "chatbot:dev": "cd chatbot && uvicorn main:app --reload --port 8001",
    "chatbot:setup": "cd chatbot && python -m venv venv && . venv/bin/activate && pip install -r requirements.txt",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

---

## Phase 6: Testing & Monitoring

### 6.1 Test GPT-5 Integration
Create `web/analytics-ui/chatbot/tests/test_gpt5.py`:
```python
import pytest
import asyncio
from services.gpt5_service import GPT5Service

@pytest.mark.asyncio
async def test_gpt5_completion():
    """Test GPT-5 completion with new parameters"""
    service = GPT5Service()
    
    # Test with different reasoning efforts
    for effort in ["minimal", "low", "medium", "high"]:
        response = ""
        async for chunk in service.stream_completion(
            messages=[{"role": "user", "content": "What events happened in 2024?"}],
            model="gpt-5-nano",  # Use nano for testing (cheaper)
            reasoning_effort=effort,
            verbosity="low"
        ):
            response += chunk
        
        assert len(response) > 0
        print(f"Reasoning effort {effort}: {len(response)} chars")

@pytest.mark.asyncio
async def test_gpt5_tools():
    """Test GPT-5 custom tools"""
    service = GPT5Service()
    
    tools = [{
        "type": "function",
        "function": {
            "name": "search_events",
            "description": "Search events",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                }
            }
        }
    }]
    
    async for chunk in service.stream_completion(
        messages=[{"role": "user", "content": "Find TPUSA events in Texas"}],
        model="gpt-5",
        tools=tools,
        custom_tools=True  # GPT-5 feature
    ):
        # Should trigger tool call
        assert "tool_call" in chunk or "content" in chunk
```

### 6.2 Add Monitoring
Create `web/analytics-ui/chatbot/monitoring.py`:
```python
from prometheus_client import Counter, Histogram, Gauge
import time

# Metrics
chat_requests = Counter('chat_requests_total', 'Total chat requests')
chat_errors = Counter('chat_errors_total', 'Total chat errors')
response_time = Histogram('chat_response_seconds', 'Response time')
active_sessions = Gauge('active_sessions', 'Number of active sessions')
token_usage = Counter('token_usage_total', 'Total tokens used', ['model'])

# GPT-5 specific metrics
reasoning_effort_usage = Counter('reasoning_effort', 'Reasoning effort usage', ['level'])
verbosity_usage = Counter('verbosity', 'Verbosity usage', ['level'])
model_usage = Counter('model_usage', 'Model usage', ['model'])
```

---

## Implementation Timeline

### Week 1: Core Setup
- [ ] Add OpenAI keys to .env
- [ ] Set up chatbot Python backend structure
- [ ] Create ChatView component in React
- [ ] Add Chat tab to navigation
- [ ] Set up pgvector in Supabase

### Week 2: GPT-5 Integration
- [ ] Implement GPT5Service with new parameters
- [ ] Create RAG pipeline with hybrid search
- [ ] Build initial tools (event search, actor lookup)
- [ ] Test streaming responses
- [ ] Generate initial embeddings

### Week 3: Frontend Polish
- [ ] Complete chat UI with message rendering
- [ ] Add tool execution visualization
- [ ] Implement chat history
- [ ] Add context awareness from current view
- [ ] Style matching existing UI

### Week 4: Advanced Features
- [ ] Add remaining tools (trends, network analysis)
- [ ] Implement caching layer
- [ ] Add export functionality
- [ ] Set up monitoring
- [ ] Performance optimization

### Week 5: Testing & Documentation
- [ ] Comprehensive testing suite
- [ ] User documentation
- [ ] API documentation
- [ ] Deployment guide
- [ ] Performance benchmarks

---

## Key Differences from V1

1. **Integrated Architecture**: Lives within analytics-ui instead of separate service
2. **GPT-5 Features**: Uses new reasoning_effort, verbosity, and custom_tools
3. **Shared Configuration**: Uses main .env file, no separate config
4. **Unified Frontend**: New tab in existing navigation, consistent styling
5. **Simplified Deployment**: One repository, one deployment
6. **Cost Optimization**: Mix of GPT-5, GPT-5-mini, and GPT-5-nano based on use case
7. **Context Awareness**: Inherits current filters and view context

---

## Success Metrics

- Response latency < 1.5s with GPT-5-nano
- Streaming starts < 500ms
- Context retrieval accuracy > 90%
- Tool execution success rate > 95%
- User engagement rate > 60%
- Query success rate > 85%

---

## Notes

- GPT-5 supports 400K context window vs 128K in GPT-4o
- Use GPT-5-nano for embeddings and quick responses
- Use GPT-5 for complex reasoning tasks
- Use GPT-5-mini for balance of speed and capability
- Custom tools in GPT-5 support plaintext instead of JSON
- Reasoning effort parameter significantly affects response time and quality