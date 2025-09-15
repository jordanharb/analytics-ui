# RAG AI Chatbot Implementation Plan
## Universal Backend Components & Woke Palantir Integration

---

## Architecture Overview

### Universal Components (Reusable Across All Apps)
1. **FastAPI Backend Service** - Core API server for all chatbot operations
2. **Redis Vector Store** - Universal vector database for embeddings and chat history
3. **OpenAI Integration Layer** - Standardized interface for embeddings and GPT-4o
4. **SSE Streaming Module** - Real-time response streaming infrastructure
5. **Base RAG Pipeline** - Abstract retrieval and generation framework
6. **Authentication Middleware** - JWT/API key validation system
7. **Rate Limiting Module** - Request throttling and quota management
8. **Logging & Monitoring** - Centralized observability layer

### Woke Palantir-Specific Components
1. **Event Data RAG Module** - Specialized retrieval for events, actors, posts
2. **Network Analysis Tools** - Actor connection and relationship queries
3. **Temporal Analytics Tools** - Time-series and trend analysis functions
4. **Metadata Enrichment Pipeline** - Dynamic tag resolution and entity expansion
5. **Custom Query Translators** - Natural language to SQL/RPC conversion

---

## Phase 1: Infrastructure Setup

### 1.1 Environment Configuration
- Create `.env.chatbot` file with required variables:
  ```
  OPENAI_API_KEY=
  REDIS_URL=
  REDIS_PASSWORD=
  SUPABASE_URL=
  SUPABASE_ANON_KEY=
  SUPABASE_SERVICE_KEY=
  CHATBOT_JWT_SECRET=
  RATE_LIMIT_REQUESTS_PER_MINUTE=
  VECTOR_EMBEDDING_MODEL=text-embedding-3-small
  CHAT_MODEL=gpt-4o
  MAX_CONTEXT_TOKENS=128000
  ```

### 1.2 Docker Compose Setup
- Create `docker-compose.chatbot.yml`:
  - Redis Stack with RedisSearch and RedisJSON modules
  - PostgreSQL with pgvector extension (if not using Supabase pgvector)
  - FastAPI service container
  - Nginx reverse proxy with SSL termination

### 1.3 Python Virtual Environment
- Create dedicated venv: `python -m venv .venv-chatbot`
- Create `requirements-chatbot.txt`:
  ```
  fastapi==0.104.1
  uvicorn[standard]==0.24.0
  redis==5.0.1
  openai==1.3.5
  supabase==2.3.0
  pydantic==2.5.2
  python-dotenv==1.0.0
  httpx==0.25.2
  sse-starlette==1.8.2
  tenacity==8.2.3
  prometheus-client==0.19.0
  structlog==23.2.0
  python-jose[cryptography]==3.3.0
  passlib[bcrypt]==1.7.4
  python-multipart==0.0.6
  aiofiles==23.2.1
  numpy==1.26.2
  scikit-learn==1.3.2
  tiktoken==0.5.2
  ```

---

## Phase 2: Universal Backend Core

### 2.1 Project Structure Creation
```
chatbot/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app initialization
│   ├── config.py                # Configuration management
│   ├── dependencies.py          # Dependency injection
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── redis_client.py     # Redis connection manager
│   │   ├── openai_client.py    # OpenAI API wrapper
│   │   ├── supabase_client.py  # Supabase connection
│   │   ├── auth.py             # Authentication logic
│   │   ├── rate_limiter.py     # Rate limiting
│   │   ├── logging.py          # Structured logging
│   │   └── exceptions.py       # Custom exceptions
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── chat.py             # Chat message models
│   │   ├── embeddings.py       # Embedding models
│   │   ├── tools.py            # Tool calling models
│   │   └── responses.py        # API response models
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── embedding_service.py    # Text embedding generation
│   │   ├── vector_service.py       # Vector store operations
│   │   ├── chat_service.py         # Chat orchestration
│   │   ├── streaming_service.py    # SSE streaming
│   │   └── context_service.py      # Context window management
│   │
│   ├── rag/
│   │   ├── __init__.py
│   │   ├── base_retriever.py       # Abstract retriever
│   │   ├── base_generator.py       # Abstract generator
│   │   ├── pipeline.py             # RAG pipeline orchestrator
│   │   ├── chunking.py             # Text chunking strategies
│   │   └── reranking.py            # Result reranking
│   │
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── base_tool.py            # Abstract tool interface
│   │   ├── knowledge_base_tool.py  # Generic KB query tool
│   │   └── registry.py             # Tool registration system
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── chat.py             # Chat endpoints
│   │   │   ├── embeddings.py       # Embedding endpoints
│   │   │   ├── health.py           # Health checks
│   │   │   └── admin.py            # Admin endpoints
│   │   └── middleware.py           # API middleware
│   │
│   └── utils/
│       ├── __init__.py
│       ├── text_processing.py      # Text utilities
│       ├── token_counter.py        # Token counting
│       └── validators.py           # Input validation
│
├── woke_palantir/                  # Woke Palantir specific
│   ├── __init__.py
│   ├── retrievers/
│   │   ├── __init__.py
│   │   ├── event_retriever.py     # Event data retrieval
│   │   ├── actor_retriever.py     # Actor data retrieval
│   │   ├── post_retriever.py      # Social post retrieval
│   │   └── network_retriever.py   # Network analysis
│   │
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── event_analytics.py     # Event analysis tools
│   │   ├── actor_analytics.py     # Actor analysis tools
│   │   ├── trend_analytics.py     # Trend detection tools
│   │   ├── network_analytics.py   # Network analysis tools
│   │   └── tag_resolver.py        # Dynamic tag resolution
│   │
│   ├── processors/
│   │   ├── __init__.py
│   │   ├── query_translator.py    # NL to SQL/RPC
│   │   ├── result_formatter.py    # Format DB results
│   │   └── metadata_enricher.py   # Enrich with metadata
│   │
│   └── config.py                   # WP-specific config
│
├── scripts/
│   ├── setup_redis_indexes.py     # Initialize Redis indexes
│   ├── populate_vector_store.py   # Initial data population
│   ├── migrate_supabase_vectors.py # Migrate existing data
│   └── test_rag_pipeline.py       # Pipeline testing
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
└── docs/
    ├── API.md
    ├── DEPLOYMENT.md
    └── CONFIGURATION.md
```

### 2.2 Core Redis Client Implementation
- Implement `app/core/redis_client.py`:
  - Connection pool management with retry logic
  - Vector index creation and management
  - Document storage with TTL support
  - Chat history storage with pagination
  - Implement methods:
    - `create_vector_index(index_name, dimension, distance_metric)`
    - `store_embedding(key, vector, metadata, ttl)`
    - `search_similar(index, query_vector, k, filters)`
    - `store_chat_message(session_id, message)`
    - `get_chat_history(session_id, limit, offset)`

### 2.3 OpenAI Client Wrapper
- Implement `app/core/openai_client.py`:
  - Singleton pattern for client instance
  - Automatic retry with exponential backoff
  - Token counting before requests
  - Response caching for identical queries
  - Methods:
    - `generate_embedding(text, model) -> List[float]`
    - `generate_embeddings_batch(texts, model) -> List[List[float]]`
    - `chat_completion(messages, tools, stream) -> Union[str, AsyncGenerator]`
    - `count_tokens(text, model) -> int`

### 2.4 Supabase Integration Layer
- Implement `app/core/supabase_client.py`:
  - Connection pooling for PostgREST calls
  - RPC function wrapper with error handling
  - Realtime subscription support (future)
  - Methods:
    - `rpc(function_name, params) -> Any`
    - `select(table, columns, filters) -> List[Dict]`
    - `insert_vector(table, embedding, metadata) -> UUID`

### 2.5 Authentication System
- Implement `app/core/auth.py`:
  - JWT token generation and validation
  - API key management
  - Role-based access control (RBAC)
  - Session management
  - Methods:
    - `create_access_token(user_id, roles) -> str`
    - `verify_token(token) -> Dict`
    - `check_api_key(key) -> bool`
    - `get_current_user(token) -> User`

### 2.6 Rate Limiting Module
- Implement `app/core/rate_limiter.py`:
  - Token bucket algorithm implementation
  - Per-user and per-IP rate limits
  - Different limits for different endpoints
  - Redis-backed distributed rate limiting
  - Methods:
    - `check_rate_limit(identifier, limit, window) -> bool`
    - `get_remaining_quota(identifier) -> int`
    - `reset_quota(identifier)`

---

## Phase 3: RAG Pipeline Framework

### 3.1 Base Retriever Implementation
- Implement `app/rag/base_retriever.py`:
  ```python
  class BaseRetriever(ABC):
      @abstractmethod
      async def retrieve(self, query: str, k: int, filters: Dict) -> List[Document]:
          pass
      
      @abstractmethod
      async def preprocess_query(self, query: str) -> str:
          pass
      
      @abstractmethod
      async def postprocess_results(self, results: List[Document]) -> List[Document]:
          pass
  ```

### 3.2 Base Generator Implementation
- Implement `app/rag/base_generator.py`:
  ```python
  class BaseGenerator(ABC):
      @abstractmethod
      async def generate(self, query: str, context: List[Document], stream: bool) -> Union[str, AsyncGenerator]:
          pass
      
      @abstractmethod
      async def format_prompt(self, query: str, context: List[Document]) -> str:
          pass
  ```

### 3.3 RAG Pipeline Orchestrator
- Implement `app/rag/pipeline.py`:
  - Query expansion with synonyms
  - Multi-stage retrieval (coarse + fine)
  - Context deduplication
  - Relevance scoring
  - Response generation with citations
  - Methods:
    - `execute(query, retriever, generator, config) -> Response`
    - `expand_query(query) -> List[str]`
    - `deduplicate_context(documents) -> List[Document]`
    - `add_citations(response, documents) -> str`

### 3.4 Text Chunking Strategies
- Implement `app/rag/chunking.py`:
  - Sentence-based chunking
  - Semantic chunking with embeddings
  - Sliding window chunking
  - Hierarchical chunking
  - Methods:
    - `chunk_by_sentences(text, max_tokens, overlap) -> List[str]`
    - `chunk_semantically(text, max_tokens, similarity_threshold) -> List[str]`
    - `chunk_hierarchically(text, levels) -> Dict[str, List[str]]`

### 3.5 Result Reranking
- Implement `app/rag/reranking.py`:
  - Cross-encoder reranking
  - Diversity-based reranking (MMR)
  - Recency weighting for time-sensitive data
  - Methods:
    - `rerank_by_relevance(query, documents, model) -> List[Document]`
    - `rerank_by_diversity(documents, lambda_param) -> List[Document]`
    - `apply_temporal_decay(documents, half_life_days) -> List[Document]`

---

## Phase 4: Woke Palantir RAG Implementation

### 4.1 Event Data Retriever
- Implement `woke_palantir/retrievers/event_retriever.py`:
  - Query parsing for event-specific terms
  - Date range extraction from natural language
  - Location-based filtering
  - Tag and category filtering
  - Methods:
    - `retrieve_events(query, date_range, locations, tags) -> List[Event]`
    - `extract_temporal_context(query) -> DateRange`
    - `extract_location_context(query) -> List[Location]`
    - `extract_tag_context(query) -> List[Tag]`

### 4.2 Actor Network Retriever
- Implement `woke_palantir/retrievers/network_retriever.py`:
  - Actor relationship traversal
  - Network centrality calculations
  - Connection strength scoring
  - Temporal network analysis
  - Methods:
    - `get_actor_network(actor_id, depth, min_strength) -> NetworkGraph`
    - `find_connections(actor_a, actor_b, max_hops) -> List[Path]`
    - `calculate_influence_score(actor_id, timeframe) -> float`
    - `get_network_communities() -> List[Community]`

### 4.3 Event Analytics Tools
- Implement `woke_palantir/tools/event_analytics.py`:
  ```python
  class EventAnalyticsTool(BaseTool):
      name = "analyze_events"
      description = "Analyze event patterns and trends"
      
      async def execute(self, parameters: Dict) -> Dict:
          # Implementation for event analysis
          pass
  ```
  - Functions:
    - `get_event_frequency(filters, time_bucket) -> TimeSeries`
    - `detect_event_clusters(filters, algorithm) -> List[Cluster]`
    - `find_correlated_events(event_id, correlation_threshold) -> List[Event]`
    - `predict_future_events(historical_data, model) -> List[Prediction]`

### 4.4 Actor Analytics Tools
- Implement `woke_palantir/tools/actor_analytics.py`:
  - Actor activity analysis
  - Influence measurement
  - Collaboration detection
  - Behavioral pattern analysis
  - Functions:
    - `get_actor_activity_timeline(actor_id) -> Timeline`
    - `measure_actor_influence(actor_id, metric) -> float`
    - `find_frequent_collaborators(actor_id, min_events) -> List[Actor]`
    - `detect_behavior_changes(actor_id, window_size) -> List[Change]`

### 4.5 Trend Detection Tools
- Implement `woke_palantir/tools/trend_analytics.py`:
  - Time series analysis
  - Anomaly detection
  - Emerging topic identification
  - Sentiment trend analysis
  - Functions:
    - `detect_trending_topics(timeframe, min_growth_rate) -> List[Topic]`
    - `find_anomalous_patterns(data, sensitivity) -> List[Anomaly]`
    - `forecast_trend(topic, horizon_days) -> Forecast`
    - `analyze_sentiment_shift(entity, timeframe) -> SentimentTrend`

### 4.6 Query Translator
- Implement `woke_palantir/processors/query_translator.py`:
  - Natural language to SQL conversion
  - Intent classification
  - Entity extraction
  - Query optimization
  - Methods:
    - `translate_to_sql(nl_query) -> str`
    - `classify_intent(query) -> Intent`
    - `extract_entities(query) -> List[Entity]`
    - `optimize_query_plan(sql) -> str`

### 4.7 Dynamic Tag Resolver
- Implement `woke_palantir/tools/tag_resolver.py`:
  - Resolve dynamic slug tags (e.g., "School:harvard")
  - Expand tag hierarchies
  - Find related tags
  - Tag similarity matching
  - Methods:
    - `resolve_dynamic_tag(tag_string) -> List[Tag]`
    - `expand_tag_hierarchy(tag) -> List[Tag]`
    - `find_similar_tags(tag, threshold) -> List[Tag]`

---

## Phase 5: API Endpoints Implementation

### 5.1 Chat Endpoints
- Implement `app/api/v1/chat.py`:
  ```python
  @router.post("/chat")
  async def chat(request: ChatRequest, user: User = Depends(get_current_user)):
      # Process chat request
      pass
  
  @router.get("/chat/stream")
  async def chat_stream(request: ChatRequest):
      # SSE streaming endpoint
      pass
  
  @router.get("/chat/history/{session_id}")
  async def get_history(session_id: str, limit: int = 50):
      # Retrieve chat history
      pass
  ```

### 5.2 Embedding Management Endpoints
- Implement `app/api/v1/embeddings.py`:
  - Create embeddings for documents
  - Bulk embedding generation
  - Embedding search
  - Index management

### 5.3 Admin Endpoints
- Implement `app/api/v1/admin.py`:
  - Vector store statistics
  - Index rebuilding
  - Cache management
  - User management
  - System health metrics

---

## Phase 6: Vector Store Population

### 6.1 Initial Data Extraction Script
- Implement `scripts/populate_vector_store.py`:
  - Extract all events from Supabase
  - Extract all actor profiles and bios
  - Extract all posts and content
  - Extract all tags and categories
  - Process in batches to avoid memory issues
  - Track progress with checkpoint system

### 6.2 Embedding Generation Pipeline
- Generate embeddings for:
  - Event descriptions and summaries
  - Actor biographies and profiles
  - Post content and comments
  - Tag descriptions
  - Location descriptions
  - Implement batch processing with rate limiting
  - Store embeddings with metadata in Redis

### 6.3 Index Creation and Optimization
- Create specialized indexes:
  - Event index with temporal and spatial dimensions
  - Actor index with network features
  - Content index with topic clustering
  - Tag index with hierarchical structure
  - Optimize index parameters for query patterns

### 6.4 Incremental Update System
- Implement real-time updates:
  - Listen to Supabase changes via webhooks
  - Process new/updated records
  - Update embeddings incrementally
  - Maintain index consistency

---

## Phase 7: Streaming and Real-time Features

### 7.1 SSE Implementation
- Implement `app/services/streaming_service.py`:
  - Token-by-token streaming
  - Heartbeat mechanism
  - Connection management
  - Error recovery
  - Methods:
    - `stream_response(generator, session_id) -> EventSourceResponse`
    - `send_heartbeat(session_id)`
    - `handle_disconnect(session_id)`

### 7.2 WebSocket Alternative
- Implement WebSocket support for bidirectional communication:
  - Real-time query refinement
  - Interactive clarification requests
  - Live data updates
  - Collaborative sessions

### 7.3 Progress Indicators
- Implement progress tracking:
  - Query processing stages
  - Retrieval progress
  - Generation progress
  - Tool execution status

---

## Phase 8: Tool Calling Integration

### 8.1 Tool Registry System
- Implement `app/tools/registry.py`:
  - Dynamic tool registration
  - Tool discovery mechanism
  - Permission management
  - Tool versioning
  - Methods:
    - `register_tool(tool_class)`
    - `get_available_tools(user) -> List[Tool]`
    - `execute_tool(tool_name, parameters) -> Result`

### 8.2 Woke Palantir Tool Suite
- Register all WP-specific tools:
  - EventSearchTool
  - ActorLookupTool
  - NetworkAnalysisTool
  - TrendDetectionTool
  - TagResolutionTool
  - TimeSeriesAnalysisTool
  - LocationAnalysisTool

### 8.3 Tool Execution Pipeline
- Implement safe execution:
  - Parameter validation
  - Timeout management
  - Resource limits
  - Result caching
  - Error handling with fallbacks

---

## Phase 9: Frontend Integration

### 9.1 React Chat Component
- Create `web/analytics-ui/src/components/Chat/ChatInterface.tsx`:
  ```typescript
  interface ChatInterfaceProps {
    apiEndpoint: string;
    authToken: string;
    initialContext?: any;
  }
  
  const ChatInterface: React.FC<ChatInterfaceProps> = ({ ... }) => {
    // Chat UI implementation
  };
  ```

### 9.2 API Client Library
- Create `web/analytics-ui/src/api/chatClient.ts`:
  - WebSocket/SSE connection management
  - Message queuing
  - Automatic reconnection
  - Response parsing
  - Error handling

### 9.3 UI Features
- Implement chat features:
  - Message input with markdown support
  - Response rendering with citations
  - Tool execution visualization
  - Loading states and progress bars
  - Error messages and retry options
  - Chat history navigation
  - Export functionality

### 9.4 Integration Points
- Add chat to existing views:
  - Map view context-aware queries
  - Filter panel natural language input
  - Event details augmentation
  - Actor profile insights

---

## Phase 10: Testing Strategy

### 10.1 Unit Tests
- Test individual components:
  - Retriever accuracy tests
  - Generator prompt tests
  - Tool execution tests
  - Authentication tests
  - Rate limiting tests

### 10.2 Integration Tests
- Test component interactions:
  - RAG pipeline end-to-end
  - Database query accuracy
  - Vector search relevance
  - Tool chain execution
  - Streaming functionality

### 10.3 Performance Tests
- Benchmark critical paths:
  - Embedding generation speed
  - Vector search latency
  - Response generation time
  - Concurrent user handling
  - Memory usage patterns

### 10.4 Accuracy Tests
- Evaluate RAG quality:
  - Retrieval precision/recall
  - Answer correctness
  - Citation accuracy
  - Hallucination detection
  - Context relevance

---

## Phase 11: Deployment and DevOps

### 11.1 Docker Configuration
- Create production Dockerfile:
  - Multi-stage build
  - Security hardening
  - Health checks
  - Resource limits

### 11.2 Kubernetes Deployment
- Create K8s manifests:
  - Deployment with autoscaling
  - Service and ingress
  - ConfigMaps and secrets
  - Persistent volume claims
  - Network policies

### 11.3 CI/CD Pipeline
- GitHub Actions workflow:
  - Automated testing
  - Docker image building
  - Security scanning
  - Deployment to staging
  - Production release gates

### 11.4 Monitoring Setup
- Implement observability:
  - Prometheus metrics
  - Grafana dashboards
  - Log aggregation (ELK)
  - Distributed tracing
  - Alert rules

---

## Phase 12: Security and Compliance

### 12.1 Security Hardening
- Implement security measures:
  - Input sanitization
  - SQL injection prevention
  - XSS protection
  - CORS configuration
  - Rate limiting per IP
  - DDoS protection

### 12.2 Data Privacy
- Ensure compliance:
  - PII detection and masking
  - Audit logging
  - Data retention policies
  - User consent management
  - GDPR compliance

### 12.3 Access Control
- Implement fine-grained permissions:
  - Role-based access (RBAC)
  - Resource-level permissions
  - API key scoping
  - Session management
  - MFA support

---

## Phase 13: Performance Optimization

### 13.1 Caching Strategy
- Implement multi-level caching:
  - Embedding cache in Redis
  - Response cache with TTL
  - Query result cache
  - Tool execution cache
  - CDN for static assets

### 13.2 Query Optimization
- Optimize database queries:
  - Index optimization
  - Query plan analysis
  - Materialized views
  - Connection pooling
  - Batch processing

### 13.3 Vector Search Optimization
- Improve search performance:
  - Index partitioning
  - Approximate algorithms (HNSW)
  - Quantization techniques
  - GPU acceleration (if available)
  - Distributed search

### 13.4 Model Optimization
- Optimize AI models:
  - Model quantization
  - Batch inference
  - Response streaming
  - Token optimization
  - Fallback to smaller models

---

## Phase 14: Documentation and Training

### 14.1 API Documentation
- Create comprehensive docs:
  - OpenAPI/Swagger spec
  - Authentication guide
  - Rate limit documentation
  - Error code reference
  - SDK documentation

### 14.2 User Guides
- Write user documentation:
  - Getting started guide
  - Query syntax guide
  - Best practices
  - Troubleshooting guide
  - FAQ

### 14.3 Developer Documentation
- Technical documentation:
  - Architecture overview
  - Extension guide
  - Tool development guide
  - Deployment guide
  - Contributing guidelines

### 14.4 Training Materials
- Create training resources:
  - Video tutorials
  - Interactive examples
  - Query templates
  - Use case studies

---

## Phase 15: Maintenance and Evolution

### 15.1 Feedback Loop Implementation
- User feedback system:
  - Response rating
  - Feedback collection
  - Issue reporting
  - Feature requests
  - Analytics dashboard

### 15.2 Continuous Improvement
- Regular updates:
  - Model fine-tuning
  - Prompt engineering
  - Index rebalancing
  - Performance tuning
  - Bug fixes

### 15.3 Feature Expansion
- Planned enhancements:
  - Multi-modal support (images)
  - Voice input/output
  - Multi-language support
  - Custom model training
  - Plugin system

### 15.4 Scaling Strategy
- Prepare for growth:
  - Horizontal scaling plan
  - Database sharding
  - Geographic distribution
  - Load balancing
  - Disaster recovery

---

## Configuration Files

### Supabase to OpenAI Integration Setup

#### 1. Enable pgvector in Supabase
```sql
-- Run in Supabase SQL editor
CREATE EXTENSION IF NOT EXISTS vector;

-- Create embeddings table
CREATE TABLE IF NOT EXISTS embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX embeddings_embedding_idx ON embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create function for similarity search
CREATE OR REPLACE FUNCTION match_embeddings(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    embeddings.id,
    embeddings.content,
    embeddings.metadata,
    1 - (embeddings.embedding <=> query_embedding) AS similarity
  FROM embeddings
  WHERE 1 - (embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY embeddings.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

#### 2. Redis Configuration
```yaml
# redis.conf additions
maxmemory 4gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
```

#### 3. Environment Variables Template
```bash
# .env.chatbot
# OpenAI Configuration
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...
VECTOR_EMBEDDING_MODEL=text-embedding-3-small
CHAT_MODEL=gpt-4o
MAX_TOKENS=4096
TEMPERATURE=0.7

# Supabase Configuration
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_SSL=false

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
API_PREFIX=/api/v1
CORS_ORIGINS=["http://localhost:3000"]

# Authentication
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=1000

# Monitoring
PROMETHEUS_ENABLED=true
METRICS_PORT=9090
LOG_LEVEL=INFO
LOG_FORMAT=json
```

---

## Implementation Priority Order

### Critical Path (Must Have - Week 1-2)
1. Environment setup and configuration
2. Core Redis and OpenAI clients
3. Basic RAG pipeline
4. Simple chat endpoint
5. Woke Palantir event retriever
6. Basic frontend integration

### High Priority (Should Have - Week 3-4)
1. Authentication system
2. Rate limiting
3. Actor and network retrievers
4. Tool calling framework
5. SSE streaming
6. Advanced frontend features

### Medium Priority (Nice to Have - Week 5-6)
1. Advanced analytics tools
2. Query translation
3. Caching layer
4. Monitoring setup
5. Performance optimization
6. Testing suite

### Low Priority (Future Enhancements)
1. WebSocket support
2. Voice features
3. Multi-language support
4. Custom model training
5. Plugin system

---

## Success Metrics

### Technical Metrics
- Response latency < 2 seconds for 95th percentile
- Retrieval accuracy > 85%
- System uptime > 99.9%
- Concurrent users > 100
- Token efficiency > 70%

### Business Metrics
- User engagement rate
- Query success rate
- Feature adoption rate
- User satisfaction score
- Cost per query

### Quality Metrics
- Answer relevance score
- Citation accuracy
- Hallucination rate < 5%
- Context utilization rate
- Tool execution success rate

---

## Risk Mitigation

### Technical Risks
1. **OpenAI API Downtime**
   - Mitigation: Implement fallback to alternative models
   - Cache frequent queries
   - Graceful degradation

2. **Vector Store Scalability**
   - Mitigation: Implement sharding strategy
   - Use approximate algorithms
   - Regular index optimization

3. **Data Consistency**
   - Mitigation: Implement transaction logs
   - Regular consistency checks
   - Backup and recovery procedures

### Security Risks
1. **Prompt Injection**
   - Mitigation: Input sanitization
   - Prompt templates
   - Output validation

2. **Data Leakage**
   - Mitigation: Access control
   - PII detection
   - Audit logging

### Operational Risks
1. **Cost Overrun**
   - Mitigation: Usage monitoring
   - Budget alerts
   - Tiered service levels

2. **Performance Degradation**
   - Mitigation: Load testing
   - Auto-scaling
   - Performance monitoring

---

## Appendix: Code Examples

### Example: Event Retriever Implementation
```python
# woke_palantir/retrievers/event_retriever.py
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import re

class EventRetriever(BaseRetriever):
    def __init__(self, supabase_client, embedding_service, vector_service):
        self.supabase = supabase_client
        self.embedder = embedding_service
        self.vector_store = vector_service
    
    async def retrieve(
        self, 
        query: str, 
        k: int = 10, 
        filters: Optional[Dict] = None
    ) -> List[Document]:
        # Extract temporal context
        date_range = self.extract_temporal_context(query)
        
        # Extract location context
        locations = self.extract_location_context(query)
        
        # Extract tags
        tags = self.extract_tag_context(query)
        
        # Generate embedding for semantic search
        query_embedding = await self.embedder.generate_embedding(query)
        
        # Perform hybrid search
        vector_results = await self.vector_store.search_similar(
            index="events",
            query_vector=query_embedding,
            k=k * 2,  # Over-fetch for reranking
            filters={
                "date_range": date_range,
                "locations": locations,
                "tags": tags,
                **(filters or {})
            }
        )
        
        # Get additional results from SQL search
        sql_results = await self.supabase.rpc(
            "analytics_city_events_keyset",
            {
                "city_filter": locations[0] if locations else None,
                "date_start": date_range["start"],
                "date_end": date_range["end"],
                "tag_filters": tags,
                "limit_count": k
            }
        )
        
        # Merge and deduplicate results
        merged_results = self.merge_results(vector_results, sql_results)
        
        # Rerank by relevance
        reranked = await self.rerank_results(query, merged_results)
        
        return reranked[:k]
    
    def extract_temporal_context(self, query: str) -> Dict:
        # Pattern matching for date expressions
        patterns = {
            r"last (\d+) days?": lambda m: {
                "start": datetime.now() - timedelta(days=int(m.group(1))),
                "end": datetime.now()
            },
            r"in (\d{4})": lambda m: {
                "start": datetime(int(m.group(1)), 1, 1),
                "end": datetime(int(m.group(1)), 12, 31)
            },
            # Add more patterns
        }
        
        for pattern, handler in patterns.items():
            match = re.search(pattern, query, re.IGNORECASE)
            if match:
                return handler(match)
        
        # Default to last 30 days
        return {
            "start": datetime.now() - timedelta(days=30),
            "end": datetime.now()
        }
```

### Example: Tool Implementation
```python
# woke_palantir/tools/trend_analytics.py
from typing import Dict, List, Any
from app.tools.base_tool import BaseTool

class TrendAnalyticsTool(BaseTool):
    name = "analyze_trends"
    description = "Analyze trends in event data over time"
    parameters = {
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "Topic to analyze"},
            "timeframe": {"type": "string", "description": "Time period"},
            "granularity": {"type": "string", "enum": ["day", "week", "month"]}
        },
        "required": ["topic", "timeframe"]
    }
    
    async def execute(self, parameters: Dict) -> Dict[str, Any]:
        topic = parameters["topic"]
        timeframe = parameters["timeframe"]
        granularity = parameters.get("granularity", "week")
        
        # Parse timeframe
        date_range = self.parse_timeframe(timeframe)
        
        # Get events related to topic
        events = await self.supabase.rpc(
            "get_events_by_topic",
            {
                "topic": topic,
                "start_date": date_range["start"],
                "end_date": date_range["end"]
            }
        )
        
        # Aggregate by time bucket
        time_series = self.aggregate_time_series(
            events, 
            granularity
        )
        
        # Detect trend
        trend = self.detect_trend(time_series)
        
        # Find related topics
        related = await self.find_related_topics(topic, events)
        
        return {
            "topic": topic,
            "timeframe": timeframe,
            "trend": trend,
            "time_series": time_series,
            "related_topics": related,
            "total_events": len(events),
            "summary": self.generate_summary(trend, time_series)
        }
```

---

This plan provides an exhaustive, step-by-step roadmap for implementing the RAG AI chatbot with both universal components and Woke Palantir-specific features. Each phase builds upon the previous one, ensuring a systematic and thorough implementation process.