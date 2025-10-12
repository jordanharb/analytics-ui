"""
Standalone Event Processor - Extract events from social media posts using Gemini AI
Runs as independent process with database-based communication
"""
import pandas as pd
import os
import sys
import json
import uuid
import signal
import argparse
from datetime import datetime, timezone
from collections import defaultdict
import time
import re
import requests
from PIL import Image
import io
from pydantic import BaseModel, Field, ValidationError
from typing import List, Optional, Union
from collections import defaultdict
from postgrest.base_request_builder import ReturnMethod
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
import hashlib
from pathlib import Path

import google.generativeai as genai
from google.generativeai import types

# Ensure repo + analytics-ui directories are available on sys.path
CURRENT_FILE = Path(__file__).resolve()
PROCESSORS_DIR = CURRENT_FILE.parent
AUTOMATION_DIR = PROCESSORS_DIR.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

for candidate in (REPO_ROOT, WEB_DIR, ANALYTICS_UI_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from utils.database import get_supabase, SupabaseRateLimiter
from utils.embeddings import generate_event_embedding
from config.settings import (
    DEBUG, TEST_MODE,
    TEST_BATCH_LIMIT, POSTS_PER_BATCH, MAX_RETRIES, OUTPUT_DIR,
    USE_V2_SCHEMA, DEFAULT_PROJECT_ID, MAX_TOKENS_PER_BATCH, AVERAGE_TOKENS_PER_POST,
    AVERAGE_TOKENS_PER_IMAGE, SYSTEM_PROMPT_TOKENS, DATE_CLUSTERING_ENABLED,
    MAX_DATE_RANGE_DAYS, PRIORITIZE_RECENT_POSTS, MAX_POSTS_PER_BATCH, SUPABASE_RPS
)

# Override MODEL_NAME for Flash version
MODEL_NAME = 'gemini-2.5-flash'


class MissingSourceIdsError(RuntimeError):
    """Raised when the model returns events without usable SourceIDs."""


class Event(BaseModel):
    # Accept both Date and EventDate for backwards compatibility
    EventDate: Optional[str] = None
    Date: Optional[str] = None
    EventName: str
    EventDescription: str
    CategoryTags: List[str]
    Location: Optional[str] = ""
    City: Optional[str] = ""
    State: Optional[str] = ""
    Participants: str = ""
    ConfidenceScore: float = Field(ge=0.0, le=1.0, description="Confidence score between 0.0 and 1.0")
    Justification: str
    SourceIDs: List[str]
    InstagramHandles: Optional[List[str]] = Field(default_factory=list)
    TwitterHandles: Optional[List[str]] = Field(default_factory=list)
    
    @property
    def event_date(self):
        """Get the event date from either EventDate or Date field"""
        return self.EventDate or self.Date

class EventList(BaseModel):
    events: List[Event]

class SimpleSlugManager:
    """Simple slug management for dynamic tags"""

    def __init__(self, supabase):
        self.supabase = supabase
        self.existing_slugs = {}
        self._lock = threading.Lock()
        self.last_reload_time = 0  # Track when slugs were last reloaded
        # Valid parent tags for dynamic slugs
        self.parent_tags = {'Institution', 'BallotMeasure', 'Recall', 'LobbyingTopic', 'Event', 'Location', 'Candidate'}

    def load_existing_slugs(self, force_reload=False):
        """Load existing slugs to show Gemini"""
        with self._lock:
            # Skip reload if it was done recently (within 30 seconds) unless forced
            current_time = time.time()
            if not force_reload and (current_time - self.last_reload_time) < 30:
                return

            try:
                result = self.supabase.table('dynamic_slugs').select(
                    'parent_tag, full_slug'
                ).execute()

                # Clear existing slugs and reload fresh
                self.existing_slugs = {}
                for row in result.data:
                    parent = row['parent_tag']
                    if parent not in self.existing_slugs:
                        self.existing_slugs[parent] = []
                    self.existing_slugs[parent].append(row['full_slug'])

                self.last_reload_time = current_time
                print(f"📋 Loaded existing slugs: {sum(len(slugs) for slugs in self.existing_slugs.values())} total")
            except Exception as e:
                print(f"⚠️ Could not load existing slugs: {e}")
                self.existing_slugs = {}

    def normalize_slug_identifier(self, identifier):
        """Normalize slug identifier for consistent matching"""
        # Convert to lowercase and replace spaces with underscores
        normalized = identifier.lower().strip()
        normalized = normalized.replace(' ', '_')
        normalized = normalized.replace('-', '_')
        # Remove any double underscores
        while '__' in normalized:
            normalized = normalized.replace('__', '_')
        return normalized
    
    def get_or_create_slug(self, parent_tag, slug_identifier):
        """Get an existing slug or create a new one if it doesn't exist"""
        # Normalize the identifier for consistent matching
        normalized_identifier = self.normalize_slug_identifier(slug_identifier)
        full_slug = f"{parent_tag}:{normalized_identifier}"
        
        # Check if slug already exists in cache (case-insensitive)
        with self._lock:
            if parent_tag in self.existing_slugs:
                # Check for case-insensitive match
                for existing_slug in self.existing_slugs[parent_tag]:
                    if existing_slug.lower() == full_slug.lower():
                        return existing_slug  # Return the existing version
        
        # If not in cache, save it as new (normalized version)
        self.save_new_slug(full_slug)
        return full_slug
    
    def save_new_slug(self, full_slug):
        """Save a new slug if it should be cached (thread-safe)"""
        if ':' not in full_slug:
            return

        parent, identifier = full_slug.split(':', 1)
        
        # Normalize the identifier
        normalized_identifier = self.normalize_slug_identifier(identifier)
        normalized_full_slug = f"{parent}:{normalized_identifier}"

        # Cache all dynamic slugs including institutions, churches and conferences
        cacheable_parents = ['BallotMeasure', 'Recall', 'Primary', 'GeneralElection', 'LobbyingTopic', 'Institution', 'Church', 'Conference']

        if parent in cacheable_parents:
            # First check if it already exists (case-insensitive)
            with self._lock:
                if parent in self.existing_slugs:
                    for existing_slug in self.existing_slugs[parent]:
                        if existing_slug.lower() == normalized_full_slug.lower():
                            # Already exists, no need to save
                            return
            
            try:
                with self._lock:
                    self.supabase.table('dynamic_slugs').insert({
                        'parent_tag': parent,
                        'slug_identifier': normalized_identifier,
                        'full_slug': normalized_full_slug
                    }).execute()

                    # Add to local cache
                    if parent not in self.existing_slugs:
                        self.existing_slugs[parent] = []
                    if normalized_full_slug not in self.existing_slugs[parent]:
                        self.existing_slugs[parent].append(normalized_full_slug)

                print(f"  💾 Cached new slug: {normalized_full_slug}")
            except Exception as e:
                # Probably already exists, that's fine
                if "duplicate" not in str(e).lower() and "unique constraint" not in str(e).lower():
                    print(f"  ⚠️ Could not cache slug {normalized_full_slug}: {e}")

class APIKeyManager:
    """
    Manages multiple API keys for concurrent processing

    Worker limit priority (highest to lowest):
    1. Explicit max_workers parameter
    2. MAX_WORKERS environment variable
    3. Use all available API keys (default)
    """

    def __init__(self, max_workers=None, cooldown_seconds: float | None = None):
        self.api_keys = []
        self.workers = []
        # Allow override of per-key cooldown (seconds between requests)
        try:
            env_cooldown = float(os.getenv('API_WORKER_COOLDOWN_SECONDS', '0') or '0')
        except Exception:
            env_cooldown = 0.0
        self.min_delay = float(cooldown_seconds) if cooldown_seconds is not None else (env_cooldown if env_cooldown > 0 else 60.0)

        # If max_workers not specified, check environment variable
        if max_workers is None:
            env_max_workers = os.getenv('MAX_WORKERS')
            if env_max_workers:
                try:
                    max_workers = int(env_max_workers)
                    print(f"🔧 Using MAX_WORKERS from .env: {max_workers}")
                except ValueError:
                    print(f"⚠️ Invalid MAX_WORKERS value in .env: {env_max_workers}. Using all available workers.")

        # Validate max_workers parameter
        if max_workers is not None and max_workers < 1:
            raise ValueError("max_workers must be at least 1")

        self.max_workers = max_workers  # Allow limiting number of workers
        try:
            self._load_api_keys()
        except Exception as e:
            print(f"Error during APIKeyManager initialization: {e}")
            raise e

    def _load_api_keys(self):
        """Load all available API keys from environment"""
        # Load numbered API keys first (preferred)
        for i in range(1, 7):  # Support up to 6 API keys total
            key = os.getenv(f'GOOGLE_AI_API_KEY_{i}')
            if key:
                self.api_keys.append(key)

        # Fall back to primary API key only if no numbered keys found
        if not self.api_keys:
            primary_key = os.getenv('GOOGLE_API_KEY')
            if primary_key:
                self.api_keys.append(primary_key)

        if not self.api_keys:
            raise ValueError("No Google API keys found in environment variables")

        print(f"🔧 Loaded {len(self.api_keys)} API keys for concurrent processing")

        # Determine how many workers to create
        workers_to_create = len(self.api_keys)
        if self.max_workers is not None:
            workers_to_create = min(self.max_workers, len(self.api_keys))
            if self.max_workers < len(self.api_keys):
                print(f"🔧 Limiting to {self.max_workers} workers (out of {len(self.api_keys)} available API keys)")

        # Initialize workers
        for i in range(workers_to_create):
            api_key = self.api_keys[i]
            try:
                worker_info = {
                    'worker_id': f'worker_{i+1}',
                    'api_key': api_key,
                    'model': None,  # Will be initialized when needed
                    'requests_made': 0,
                    'last_request_time': 0,
                    'generation_config': types.GenerationConfig(
                        response_mime_type="application/json",
                        max_output_tokens=1000000,
                        temperature=0.2
                    )
                }
                self.workers.append(worker_info)
                print(f"  ✅ Worker {i+1} initialized with API key: ...{api_key[-8:]}")
            except Exception as e:
                print(f"  Error creating worker {i+1}: {e}")
                raise e

    def get_worker(self, worker_index):
        """Get a worker and initialize its model if needed"""
        if worker_index >= len(self.workers):
            print(f"Error: Requested worker index {worker_index} but only have {len(self.workers)} workers")
            print(f"Available workers: {[w.get('worker_id', 'unknown') for w in self.workers]}")
            return None

        worker = self.workers[worker_index]

        # Initialize model if not already done
        if worker['model'] is None:
            genai.configure(api_key=worker['api_key'])
            worker['model'] = genai.GenerativeModel(MODEL_NAME)

        return worker

    def rate_limit_delay(self, worker):
        """Implement rate limiting per API key (1 request per minute)"""
        current_time = time.time()
        time_since_last = current_time - worker['last_request_time']

        # Default: 1 request per minute per API key (overridable)
        if time_since_last < self.min_delay:
            delay = self.min_delay - time_since_last
            print(f"  ⏱️ Worker {worker['worker_id']}: Waiting {delay:.1f}s before next API call...")
            time.sleep(delay)

        worker['last_request_time'] = time.time()
        worker['requests_made'] += 1

class EventProcessor:
    def __init__(self, job_id=None, cancellation_callback=None, stats_callback=None, max_workers=None, cooldown_seconds: float | None = None):
        # Initialize API key manager with optional worker limit and cooldown override
        self.api_manager = APIKeyManager(max_workers=max_workers, cooldown_seconds=cooldown_seconds)

        self.supabase = get_supabase()
        self.db_limiter = SupabaseRateLimiter(SUPABASE_RPS)
        self.failed_log_file = os.path.join(OUTPUT_DIR, 'gemini_failed_groups.log')
        
        # Initialize rate limiter for non-worker database operations
        self.db_limiter = SupabaseRateLimiter(SUPABASE_RPS)

        # Verify schema configuration
        self.verify_schema_configuration()

        # Initialize slug manager
        self.slug_manager = SimpleSlugManager(self.supabase)

        # Job tracking and cancellation support
        self.job_id = job_id
        self.cancellation_callback = cancellation_callback
        self.stats_callback = stats_callback
        self.is_cancelled = False
        self.batches_completed_before_cancellation = 0
        
        # Cache for actor directory - will be loaded on demand
        self._actor_dir = None
        self._actor_dir_loaded = False

        # Statistics tracking (thread-safe)
        self.stats = {
            'events_processed': 0,
            'events_created': 0,  # New events created
            'posts_linked_to_existing': 0,  # Posts linked to existing events
            'event_unknown_actor_links_created': 0,
            'unknown_actors_linked_to_events': 0,
            'batches_processed': 0,
            'batches_failed': 0,
            'total_processing_time': 0,
            'posts_processed': 0
        }
        self.stats_lock = threading.Lock()

        # Track last batch status message time (for reducing console spam)
        self.last_batch_status_time = 0
        self.batch_status_interval = 60  # Show batch status every 60 seconds

        # Cache for unknown actors lookup
        self.unknown_actors_lookup = {}

        # No longer need institution context - using search_dynamic_slugs function instead

        # Image processing settings
        self.max_image_size = (1024, 1024)  # Resize large images
        self.supported_formats = {'jpg', 'jpeg', 'png', 'gif', 'webp'}

        # Create logs directory
        os.makedirs(os.path.dirname(self.failed_log_file), exist_ok=True)

        # Load context data at startup
        # Institution context no longer needed - using search_dynamic_slugs function
        
        # Initialize Gemini function tools for dynamic context retrieval
        self._initialize_function_tools()
        
        # Track current batch mapping for post ID lookups
        self.current_batch_post_mapping = {}

    def _initialize_function_tools(self):
        """Initialize Gemini function tool definitions"""
        
        # Tool 1: Search actors by handles
        self.search_actors_function = types.FunctionDeclaration(
            name="search_actors",
            description="Look up actor information by handles/usernames. Returns bio, affiliations, location, and all metadata currently used for context.",
            parameters={
                "type": "object",
                "properties": {
                    "actors": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "platform": {"type": "string", "enum": ["twitter", "instagram", "facebook", "tiktok"]},
                                "handle": {"type": "string"},
                            },
                            "required": ["platform", "handle"]
                        },
                        "description": "Array of actors to look up"
                    }
                },
                "required": ["actors"]
            }
        )

        # Tool 2: Search dynamic slugs with all variations
        self.search_dynamic_slugs_function = types.FunctionDeclaration(
            name="search_dynamic_slugs",
            description="Search for existing dynamic slugs. Returns ALL matching slugs regardless of parent_tag type (School, Church, Election, LobbyingTopic, BallotMeasure, Conference) to help identify the correct slug type.",
            parameters={
                "type": "object",
                "properties": {
                    "search_term": {"type": "string", "description": "Term to search for in slug identifiers (e.g., 'Julie_Spilsbury', 'ASU', 'Mesa')"},
                    "parent_tag_filter": {
                        "type": "string", 
                        "description": "Optional: filter by specific parent tag type",
                        "enum": ["Institution", "BallotMeasure", "Recall", "Conference", "LobbyingTopic", "Primary", "GeneralElection"]
                    }
                },
                "required": ["search_term"]
            }
        )
        
        # Tool 3: Link posts to existing event
        self.link_posts_to_event_function = types.FunctionDeclaration(
            name="link_posts_to_existing_event",
            description="Link one or more posts to an existing event instead of creating a duplicate. Use when you find an exact match. Automatically migrates actor links from posts to event.",
            parameters={
                "type": "object",
                "properties": {
                    "event_id": {"type": "string", "description": "UUID of the existing event"},
                    "post_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Array of post IDs to link to this event"
                    },
                    "reason": {"type": "string", "description": "Brief explanation of why these posts belong to this existing event"}
                },
                "required": ["event_id", "post_ids", "reason"]
            }
        )

        # Combine all tools (removed search_similar_events - redundant with deduplication script)
        self.all_function_tools = [types.Tool(function_declarations=[
            self.search_actors_function,
            self.search_dynamic_slugs_function,
            self.link_posts_to_event_function
        ])]

    def verify_schema_configuration(self):
        """Verify schema configuration matches database state"""
        print(f"\n🔍 Verifying schema configuration...")
        print(f"   USE_V2_SCHEMA setting: {USE_V2_SCHEMA}")

        # Check which tables exist
        try:
            # Try to query v2 tables
            v2_test = self.supabase.table('v2_events').select('id').limit(1).execute()
            v2_exists = True
            print(f"   ✅ V2 tables exist")
        except:
            v2_exists = False
            print(f"   ❌ V2 tables NOT found")

        try:
            # Try to query v1 tables
            v1_test = self.supabase.table('events').select('id').limit(1).execute()
            v1_exists = True
            print(f"   ✅ V1 tables exist")
        except:
            v1_exists = False
            print(f"   ❌ V1 tables NOT found")

        # Verify configuration matches reality
        if USE_V2_SCHEMA and not v2_exists:
            print(f"\n⚠️  WARNING: USE_V2_SCHEMA=True but V2 tables not found!")
            print(f"   This will cause errors. Please check your database.")
        elif not USE_V2_SCHEMA and not v1_exists:
            print(f"\n⚠️  WARNING: USE_V2_SCHEMA=False but V1 tables not found!")
            print(f"   This will cause errors. Please check your configuration.")
        else:
            print(f"   ✅ Schema configuration verified")

        # Count actors in the appropriate table
        actor_table = 'v2_actor_usernames' if USE_V2_SCHEMA else 'actor_usernames'
        try:
            actor_count = self.supabase.table(actor_table).select('id', count='exact').limit(1).execute()
            print(f"   📊 {actor_table} has {actor_count.count} records")
        except Exception as e:
            print(f"   ❌ Could not query {actor_table}: {e}")

        print()  # Empty line for readability


    def handle_search_actors(self, actors_list):
        """Handle bulk actor search - returns EXACT same format as current actor bio context"""
        try:
            # Collect all handles
            handles = [actor.get('handle', '') for actor in actors_list if actor.get('handle')]
            
            if not handles:
                return []
            
            # Use existing get_actor_bio_info method to get full context
            actor_bio = self.get_actor_bio_info(handles)
            
            # Format response matching current context structure
            results = []
            for actor in actors_list:
                handle = actor.get('handle', '')
                platform = actor.get('platform', 'unknown')
                
                if handle in actor_bio:
                    info = actor_bio[handle]
                    
                    # Return exact same fields as build_system_prompt currently provides
                    if info.get('type') == 'person':
                        results.append({
                            'handle': handle,
                            'platform': platform,
                            'type': 'person',
                            'full_name': info.get('full_name', info.get('name', '')),
                            'primary_role': info.get('present_role', info.get('primary_role', '')),
                            'organizations': info.get('organizations', []),
                            'location': info.get('location') or f"{info.get('city', '')}, {info.get('state', '')}".strip(', '),
                            'about': info.get('about', ''),
                            'usernames': info.get('usernames', []),
                            'is_tpusa_staff': info.get('is_tpusa_staff', False),
                            'is_tpusa_affiliated': info.get('is_tpusa_affiliated', False)
                        })
                    elif info.get('type') == 'chapter':
                        results.append({
                            'handle': handle,
                            'platform': platform,
                            'type': 'chapter',
                            'name': info.get('name', ''),
                            'school_type': info.get('school_type', ''),
                            'location': info.get('location') or f"{info.get('city', '')}, {info.get('state', '')}".strip(', '),
                            'about': info.get('about', ''),
                            'usernames': info.get('usernames', [])
                        })
                    elif info.get('type') == 'organization':
                        results.append({
                            'handle': handle,
                            'platform': platform,
                            'type': 'organization',
                            'name': info.get('name', ''),
                            'about': info.get('about', info.get('summary_focus', '')),
                            'location': info.get('location', ''),
                            'usernames': info.get('usernames', []),
                            'region_scope': info.get('region_scope', '')
                        })
                    elif info.get('type') == 'unknown':
                        results.append({
                            'handle': handle,
                            'platform': platform,
                            'type': 'unknown',
                            'display_name': info.get('display_name', ''),
                            'bio': info.get('bio', ''),
                            'location': info.get('location', '')
                        })
                else:
                    # Handle not found
                    results.append({
                        'handle': handle,
                        'platform': platform,
                        'type': 'not_found'
                    })
            
            print(f"      🔍 Resolved {len(results)} actors")
            return results
            
        except Exception as e:
            print(f"      ❌ Error in handle_search_actors: {e}")
            return []

    # Removed handle_search_similar_events and fallback_with_enhanced_context
    # These are redundant with the standalone deduplication script

    def _format_with_match_reasons(self, events, query_text, date, city, state, search_type):
        """Format events with match reasons for better Gemini reasoning"""
        formatted_results = []
        for r in events:
            reasons = []
            score = r.get('similarity', 0.5) if search_type == 'vector' else 0.5
            
            # Check name similarity
            if r.get('event_name'):
                event_name_lower = r['event_name'].lower()
                query_lower = query_text.lower()
                if event_name_lower == query_lower:
                    reasons.append("Exact name match")
                    score = min(score + 0.2, 1.0)
                elif query_lower in event_name_lower or event_name_lower in query_lower:
                    reasons.append("Strong name similarity")
                    score = min(score + 0.1, 1.0)
            
            # Check date proximity
            if date and r.get('event_date'):
                try:
                    from datetime import datetime
                    event_date = datetime.fromisoformat(r['event_date'])
                    query_date = datetime.fromisoformat(date)
                    days_diff = abs((event_date - query_date).days)
                    if days_diff == 0:
                        reasons.append("Same date")
                        score = min(score + 0.15, 1.0)
                    elif days_diff == 1:
                        reasons.append("1 day apart")
                        score = min(score + 0.1, 1.0)
                    elif days_diff == 2:
                        reasons.append("2 days apart")
                        score = min(score + 0.05, 1.0)
                except:
                    pass
            
            # Check location
            if city and r.get('city') and city.lower() in r['city'].lower():
                reasons.append("Same city")
                score = min(score + 0.1, 1.0)
            if state and r.get('state') and state.upper() == r['state'].upper():
                reasons.append("Same state")
                score = min(score + 0.05, 1.0)
            
            if not reasons:
                reasons = ["Content similarity" if search_type == 'vector' else "Keyword match"]
            
            formatted_results.append({
                'event_id': r.get('id'),
                'event_name': r.get('event_name'),
                'event_date': r.get('event_date'),
                'score': score,
                'city': r.get('city'),
                'state': r.get('state'),
                'event_description': r.get('event_description', '')[:500],
                'match_reasons': reasons,
                'search_type': search_type
            })
        
        # Sort by score
        formatted_results.sort(key=lambda x: x['score'], reverse=True)
        return formatted_results
    
    def fallback_text_search_events(self, query_text, date=None, city=None, state=None, limit=10):
        """Fallback text-based event search if vector search fails"""
        try:
            table_name = 'v2_events' if USE_V2_SCHEMA else 'events'
            query = self.supabase.table(table_name).select(
                'id, event_name, event_date, city, state, location, category_tags, participants, event_description'
            )
            
            # Add filters if provided
            if date:
                query = query.eq('event_date', date)
            if city:
                query = query.ilike('city', f'%{city}%')
            if state:
                query = query.eq('state', state)
            
            # Text search in event name and description
            query = query.or_(f"event_name.ilike.%{query_text}%,event_description.ilike.%{query_text}%")
            query = query.limit(limit)
            
            result = query.execute()
            
            if not result.data:
                return []
            
            # Use enhanced formatting with match reasons
            return self._format_with_match_reasons(result.data, query_text, date, city, state, 'text')
            
        except Exception as e:
            print(f"      ❌ Error in fallback text search: {e}")
            return []

    def handle_search_dynamic_slugs(self, search_term, parent_tag_filter=None):
        """Search ALL dynamic slugs, showing all parent_tag types for disambiguation"""
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                grouped = {}
                
                # Search in dynamic_slugs table
                query = self.supabase.table('dynamic_slugs').select(
                    'parent_tag, slug_identifier, full_slug'
                )
                
                # Escape special characters for PostgreSQL ilike operator
                # Escape % and _ which are wildcards in SQL LIKE/ILIKE
                escaped_term = search_term.replace('%', '\\%').replace('_', '\\_')
                
                # Try different search strategies based on retry count
                if retry_count == 0:
                    # First try: wildcard search (most flexible)
                    query = query.ilike('slug_identifier', f'%{escaped_term}%')
                elif retry_count == 1:
                    # Second try: prefix search (less flexible, more reliable)
                    query = query.ilike('slug_identifier', f'{escaped_term}%')
                else:
                    # Final try: exact match (most reliable)
                    query = query.ilike('slug_identifier', escaped_term)
                
                # Optional filter by parent_tag
                if parent_tag_filter:
                    query = query.eq('parent_tag', parent_tag_filter)
                
                result = query.execute()
                
                # If we get here, the query succeeded, break out of retry loop
                break
                
            except Exception as e:
                retry_count += 1
                error_msg = str(e).lower()
                
                # Check for Cloudflare errors or server issues  
                if ('cloudflare' in error_msg or 
                    'worker threw exception' in error_msg or 
                    'json could not be generated' in error_msg or
                    'server disconnected' in error_msg or 
                    'connection' in error_msg):
                    
                    if retry_count < max_retries:
                        print(f"      ⚠️ Cloudflare/connection error in handle_search_dynamic_slugs (attempt {retry_count}/{max_retries}), trying simpler query...")
                        time.sleep(1 + retry_count)  # Brief backoff
                        
                        continue
                    else:
                        print(f"      ⚠️ Cloudflare errors prevent slug search for '{search_term}' - continuing without dynamic slug matches")
                        return {}
                else:
                    print(f"      ❌ Error in handle_search_dynamic_slugs: {e}")
                    return {}
        
        try:
            # Group results by slug_identifier to show all parent_tag variations
            for row in result.data or []:
                identifier = row['slug_identifier']
                if identifier not in grouped:
                    grouped[identifier] = []
                grouped[identifier].append({
                    'parent_tag': row['parent_tag'],
                    'full_slug': row['full_slug']
                })
            
            # No longer need to search institution_slugs table since Schools and Churches 
            # are now in dynamic_slugs with parent_tag='School' or 'Church'
            
            print(f"      🔍 Found {len(grouped)} unique slug identifiers with {sum(len(v) for v in grouped.values())} total variations")
            return grouped
            
        except Exception as e:
            print(f"      ❌ Error in handle_search_dynamic_slugs: {e}")
            return {}

    def handle_link_posts_to_event(self, event_id, post_ids, reason):
        """Link posts to existing event and automatically migrate actor links"""
        try:
            # Map post_ids to UUIDs using current batch mapping
            post_uuids = []
            for post_id in post_ids:
                if post_id in self.current_batch_post_mapping:
                    post_uuids.append(self.current_batch_post_mapping[post_id])
                else:
                    print(f"      ⚠️ Post ID {post_id} not found in current batch")
            
            if not post_uuids:
                return {'success': False, 'message': 'No valid post IDs found in current batch'}
            
            # Create event-post links
            self.create_event_post_links(event_id, post_uuids)
            
            # Automatically migrate post-actor links to event-actor links
            # This includes both known and unknown actors
            instagram_handles, twitter_handles = self.migrate_post_actor_links_to_event(event_id, post_uuids)
            
            # Also link any unknown actors from posts
            self.link_event_to_post_unknown_actors(event_id, post_uuids)
            
            # Update stats
            self.update_stats('posts_linked_to_existing', len(post_uuids))
            
            # Log the linking
            print(f"      ✅ Linked {len(post_uuids)} posts to existing event {event_id}")
            print(f"         Reason: {reason}")
            if instagram_handles or twitter_handles:
                print(f"         Migrated actors: {len(instagram_handles)} Instagram, {len(twitter_handles)} Twitter")
            
            return {
                'success': True,
                'linked_posts': len(post_uuids),
                'event_id': event_id,
                'migrated_actors': {
                    'instagram': list(instagram_handles),
                    'twitter': list(twitter_handles)
                }
            }
            
        except Exception as e:
            print(f"      ❌ Error in handle_link_posts_to_event: {e}")
            return {'success': False, 'message': str(e)}

    def generate_embedding_for_text(self, text):
        """Generate embedding vector for text using Gemini's embedding model"""
        try:
            # Configure API key for embedding model
            from config.settings import GOOGLE_API_KEY
            genai.configure(api_key=GOOGLE_API_KEY)
            
            # Use Gemini's text embedding model (correct API)
            result = genai.embed_content(
                model='models/text-embedding-004',
                content=text,
                task_type="retrieval_document",
                title="Event search"
            )
            
            # Get the embedding vector
            if result and 'embedding' in result:
                return result['embedding']
            else:
                return None
                
        except Exception as e:
            print(f"      ⚠️ Error generating embedding: {e}")
            # Return None to trigger fallback text search
            return None

    def _extract_json_from_response(self, response_text: str) -> Optional[dict]:
        """
        Extracts a JSON object from a model's response text, even if it's
        wrapped in markdown or other text. Required for models like Flash.
        """
        if not response_text:
            return None

        # 1. Look for a JSON markdown block first (most reliable)
        # Handles ```json ... ```
        match = re.search(r"```json\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                # Fall through to the next method if this fails
                pass

        # 2. If no markdown, find the first '{' and the last '}'
        # This handles cases where JSON is just embedded in text.
        try:
            start_index = response_text.find('{')
            end_index = response_text.rfind('}')
            if start_index != -1 and end_index != -1 and end_index > start_index:
                potential_json = response_text[start_index:end_index + 1]
                return json.loads(potential_json)
        except json.JSONDecodeError:
            pass

        # 3. If it's a list, find the first '[' and last ']'
        try:
            start_index = response_text.find('[')
            end_index = response_text.rfind(']')
            if start_index != -1 and end_index != -1 and end_index > start_index:
                potential_json = response_text[start_index:end_index + 1]
                # The schema expects a dict, so wrap a list if found
                return {"events": json.loads(potential_json)}
        except json.JSONDecodeError:
            pass
        
        # 4. If nothing else works, return None
        print("   ⚠️  _extract_json_from_response: Could not find a valid JSON object in the response.")
        return None

    def check_cancellation(self):
        """Check if job should be cancelled and update internal state"""
        if not self.is_cancelled and self.cancellation_callback and self.cancellation_callback():
            self.is_cancelled = True
            print(f"🛑 Cancellation detected for job {self.job_id}")
            return True
        return self.is_cancelled

    def database_operation_with_retry(self, operation_func, operation_name, max_retries=10, base_delay=1.0):
        """Execute a database operation with retry logic for server disconnects"""
        for attempt in range(max_retries):
            # Check for cancellation before each retry attempt
            if self.check_cancellation():
                print(f"  🛑 {operation_name} cancelled during retry attempt {attempt + 1}")
                raise Exception("Job cancelled during database operation retry")
            self.db_limiter.wait()
            try:
                result = operation_func()
                # Ensure we return a valid result object
                if result is None:
                    raise Exception(f"{operation_name} returned None result")
                return result
            except Exception as e:
                error_str = str(e).lower()
                error_msg = str(e)
                
                # Don't retry on duplicate key errors - these are expected
                if "duplicate key" in error_str or "unique constraint" in error_str or "23505" in error_msg:
                    # This is not an error we should retry - it means the data already exists
                    print(f"  ℹ️ {operation_name} - duplicate key (data already exists): {str(e)[:100]}")
                    # Return a mock successful response for duplicates
                    class MockResult:
                        def __init__(self):
                            self.data = []
                    return MockResult()
                
                if ("server disconnected" in error_str or 
                    "connection" in error_str or 
                    "timeout" in error_str) and attempt < max_retries - 1:
                    
                    delay = base_delay * (2 ** attempt)  # Exponential backoff
                    print(f"  ⚠️ {operation_name} failed (attempt {attempt + 1}/{max_retries}): {str(e)}")
                    print(f"  🔄 Retrying in {delay:.1f}s...")
                    time.sleep(delay)
                    continue
                else:
                    # Final attempt failed or non-retriable error
                    print(f"  ❌ {operation_name} failed permanently after {attempt + 1} attempts: {str(e)}")
                    raise e

        # This should never be reached, but just in case
        raise Exception(f"{operation_name} failed after all retry attempts")

    def get_cancellation_stats(self):
        """Get statistics about what was completed before cancellation"""
        with self.stats_lock:
            return {
                "batches_completed": self.batches_completed_before_cancellation,
                "events_processed": self.stats.get('events_processed', 0),
                "posts_processed": self.stats.get('posts_processed', 0),
                "was_cancelled": self.is_cancelled
            }
    
    def get_final_stats(self):
        """Get final statistics from the processor"""
        with self.stats_lock:
            return self.stats.copy()

    def update_stats(self, stat_name, increment=1, batch_info=None):
        """Thread-safe statistics update"""
        with self.stats_lock:
            self.stats[stat_name] = self.stats.get(stat_name, 0) + increment
            
            # Update batch info if provided
            if batch_info:
                self.stats['current_batch'] = batch_info.get('current_batch', 0)
                self.stats['total_batches'] = batch_info.get('total_batches', 0)

            # Call stats callback if provided
            if self.stats_callback:
                try:
                    self.stats_callback(self.stats.copy())
                except Exception as e:
                    print(f"⚠️ Error calling stats callback: {e}")

    def get_category_tags_from_supabase(self):
        """Load active category tags from database and existing slugs"""
        try:
            # Load only child tags (no parent tags for AI)
            result = self.supabase.table('category_tags').select(
                'tag_name, tag_rule, parent_tag'
            ).eq('is_active', True).execute()

            if not result.data:
                print("Warning: No active category tags found in Supabase")
                return [], {}

            allowed_tags = []
            tag_rules = {}

            for row in result.data:
                tag_name = row['tag_name'].strip()
                tag_rule = row.get('tag_rule', '').strip()
                parent_tag = row.get('parent_tag')

                # Only include child tags or tags without parents in the allowed list
                # Skip parent tags like 'Education', 'EventFormat', etc.
                if not parent_tag or parent_tag == tag_name:
                    # This is either a standalone tag or incorrectly self-referencing
                    allowed_tags.append(tag_name)
                    tag_rules[tag_name] = tag_rule
                elif parent_tag != tag_name:
                    # This is a child tag
                    allowed_tags.append(tag_name)
                    tag_rules[tag_name] = tag_rule

            # Load existing slugs
            self.slug_manager.load_existing_slugs(force_reload=True)

            print(f"Loaded {len(allowed_tags)} child category tags from Supabase")
            return allowed_tags, tag_rules

        except Exception as e:
            print(f"Error loading category tags from Supabase: {str(e)}")
            print("Using fallback tags...")
            return ['Meeting', 'Rally', 'Conference', 'College', 'High School'], {}

    def get_v2_actor_field_mappings(self):
        """Get field mappings for v2 actors based on TPUSA project configuration"""
        return {
            'person': {
                'present_role': 'custom_text_1',
                'role_category': 'custom_text_2',
                'primary_organization_id': 'custom_text_3',
                'is_tpusa_staff': 'custom_bool_1',
                'is_tpusa_affiliated': 'custom_bool_2'
            },
            'chapter': {
                'school_type': 'custom_text_1',
                'active': 'custom_bool_1',
                'founded_year': 'custom_numeric_1',
                'active_members': 'custom_numeric_2',
                'patriot_point_total': 'custom_numeric_3'
            },
            'organization': {
                # Organizations use standard fields mostly
            }
        }

    def get_actor_bio_info(self, handles_in_batch):
        """Fetch bio info for usernames from actor tables with retry logic"""
        if not handles_in_batch:
            return {}

        if USE_V2_SCHEMA:
            return self.get_v2_actor_bio_info(handles_in_batch)
        else:
            return self.get_v1_actor_bio_info(handles_in_batch)

    def get_v2_actor_bio_info(self, handles_in_batch):
        """V2 actor bio fetching using the comprehensive v2_actor_event_view"""
        actor_bio = {}
        
        # First, get info for any unknown actors in v2_unknown_actors
        unknown_table = 'v2_unknown_actors' if USE_V2_SCHEMA else 'unknown_actors'
        def fetch_unknown_actors():
            return self.supabase.table(unknown_table).select(
                'detected_username, profile_displayname, profile_bio, profile_location'
            ).in_('detected_username', list(handles_in_batch)).not_.eq('review_status', 'attached').execute()
        
        try:
            unknowns_res = self.database_operation_with_retry(
                fetch_unknown_actors, 
                "Fetch unknown actors bio info"
            )
            
            for u in unknowns_res.data or []:
                handle = u['detected_username']
                if handle:
                    actor_bio[handle] = {
                        'type': 'unknown',
                        'display_name': u.get('profile_displayname') or '',
                        'bio': u.get('profile_bio') or '',
                        'location': u.get('profile_location') or ''
                    }
        except Exception as e:
            print(f"⚠️ Warning: Could not fetch from unknown_actors after retries. {e}")

        # Query the comprehensive view for actor data
        # We'll fetch ALL actors from the view with the columns we need, then filter by handles
        def fetch_actors_from_view():
            return self.supabase.table('v2_actor_event_view').select(
                'actor_id, actor_type, name, city, state, location, about, '
                'social_bios, social_handles, organizations, primary_role'
            ).execute()
        
        try:
            actors_res = self.database_operation_with_retry(
                fetch_actors_from_view,
                "Fetch actors from event view"
            )
            
            # Create lookup of actors by their handles
            handles_lower = {h.lower() for h in handles_in_batch}
            
            for actor in actors_res.data or []:
                social_handles = actor.get('social_handles', {}) or {}
                
                # Check if this actor has any of the handles we're looking for
                matching_handles = []
                
                for platform, handle_data in social_handles.items():
                    if handle_data and isinstance(handle_data, dict):
                        username = handle_data.get('username', '')
                        if username and username.lower() in handles_lower:
                            matching_handles.append(username)
                
                # If we found matching handles, add this actor's info
                for handle in matching_handles:
                    actor_type = actor.get('actor_type', '')
                    organizations = actor.get('organizations', []) or []
                    social_bios = actor.get('social_bios', {}) or {}
                    
                    # Build organization summary string for context
                    org_summary = []
                    for org in organizations[:3]:  # Limit to first 3 orgs for brevity
                        org_name = org.get('organization_name', '')
                        role = org.get('role', '')
                        if org.get('is_primary'):
                            org_summary.append(f"{org_name} ({role}) [PRIMARY]")
                        else:
                            org_summary.append(f"{org_name} ({role})")
                    
                    # Get bio from social media profiles
                    profile_bio = social_bios.get('x_bio') or social_bios.get('instagram_bio') or ''
                    
                    # Build the bio data structure expected by the prompt builder
                    bio_data = {
                        'type': actor_type,
                        'name': actor.get('name', ''),
                        'city': actor.get('city', ''),
                        'state': actor.get('state', ''),
                        'location': actor.get('location', ''),
                        'about': actor.get('about', '') or profile_bio,
                        'primary_role': actor.get('primary_role', ''),
                        'organizations': org_summary,
                        'usernames': [handle]
                    }
                    
                    # Add type-specific fields for backward compatibility
                    if actor_type == 'person':
                        bio_data['full_name'] = actor.get('name', '')
                        bio_data['present_role'] = actor.get('primary_role', '')
                    
                    actor_bio[handle] = bio_data
        
        except Exception as e:
            print(f"⚠️ Warning: Could not fetch v2 actor bios from view: {e}")
        
        print(f"Loaded biographical info for {len(actor_bio)} actors in batch (v2 view)")
        return actor_bio

    def get_v1_actor_bio_info(self, handles_in_batch):
        """Legacy v1 actor bio fetching (original method)"""
        actor_bio = {}

        # First, get info for any 'unknown_actors' in the batch
        def fetch_unknown_actors():
            return self.supabase.table('unknown_actors').select(
                'detected_username, profile_displayname, profile_bio, profile_location'
            ).in_('detected_username', list(handles_in_batch)).not_.eq('review_status', 'attached').execute()

        try:
            unknowns_res = self.database_operation_with_retry(
                fetch_unknown_actors,
                "Fetch unknown actors bio info"
            )

            for u in unknowns_res.data or []:
                handle = u['detected_username']
                if handle:
                    if DEBUG:
                        bio_val = u.get('profile_bio')
                        location_val = u.get('profile_location')
                        print(f"[DEBUG] Unknown actor {handle}: bio={bio_val}, location={location_val}")
                    actor_bio[handle] = {
                        'type': 'unknown',
                        'display_name': u.get('profile_displayname') or '',
                        'bio': u.get('profile_bio') or '',
                        'location': u.get('profile_location') or ''
                    }
        except Exception as e:
            print(f"⚠️ Warning: Could not fetch from unknown_actors after retries. {e}")

        # Next, get info for known actors using v1 tables
        def fetch_actor_mappings():
            return self.supabase.table('actor_usernames').select(
                'username, actor_type, actor_id'
            ).in_('username', list(handles_in_batch)).execute()

        try:
            mapping_res = self.database_operation_with_retry(
                fetch_actor_mappings,
                "Fetch actor username mappings"
            )
            mapping = mapping_res.data or []

            # Split out IDs by type
            people_ids, chapter_ids, org_ids = [], [], []
            pid_to_usernames, cid_to_usernames, oid_to_usernames = defaultdict(list), defaultdict(list), defaultdict(list)

            for r in mapping:
                actor_id = r.get('actor_id')
                actor_type = r.get('actor_type')
                username = r.get('username')
                if not (actor_id and actor_type and username):
                    continue

                if actor_type == 'person':
                    pid_to_usernames[actor_id].append(username)
                    people_ids.append(actor_id)
                elif actor_type == 'chapter':
                    cid_to_usernames[actor_id].append(username)
                    chapter_ids.append(actor_id)
                elif actor_type == 'organization':
                    oid_to_usernames[actor_id].append(username)
                    org_ids.append(actor_id)

            # Fetch data for each type using v1 tables
            if people_ids:
                def fetch_people():
                    return self.supabase.table('people').select(
                        'id, full_name, city, state, about, present_role, role_category, primary_organization_id, is_tpusa_staff, is_tpusa_affiliated'
                    ).in_('id', list(set(people_ids))).execute()

                try:
                    people_res = self.database_operation_with_retry(
                        fetch_people,
                        "Fetch people bio data from people table"
                    )
                    for p in people_res.data or []:
                        for uname in pid_to_usernames.get(p['id'], []):
                            actor_bio[uname] = {
                                'type': 'person',
                                'full_name': p.get('full_name') or '',
                                'state': p.get('state') or '',
                                'city': p.get('city') or '',
                                'about': p.get('about') or '',
                                'present_role': p.get('present_role') or '',
                                'role_category': p.get('role_category') or '',
                                'primary_organization_id': p.get('primary_organization_id') or '',
                                'is_tpusa_staff': p.get('is_tpusa_staff') or False,
                                'is_tpusa_affiliated': p.get('is_tpusa_affiliated') or False,
                                'usernames': pid_to_usernames.get(p['id'], [])
                            }
                except Exception as e:
                    print(f"⚠️ Warning: Could not fetch people data after retries. {e}")

            if chapter_ids:
                def fetch_chapters():
                    return self.supabase.table('chapters').select(
                        'id, name, city, state, school_type'
                    ).in_('id', list(set(chapter_ids))).execute()

                try:
                    chapters_res = self.database_operation_with_retry(
                        fetch_chapters,
                        "Fetch chapters bio data from chapters table"
                    )
                    for c in chapters_res.data or []:
                        for uname in cid_to_usernames.get(c['id'], []):
                            actor_bio[uname] = {
                                'type': 'chapter',
                                'name': c.get('name') or '',
                                'school_type': c.get('school_type') or '',
                                'state': c.get('state') or '',
                                'city': c.get('city') or '',
                                'usernames': cid_to_usernames.get(c['id'], [])
                            }
                except Exception as e:
                    print(f"⚠️ Warning: Could not fetch chapters data after retries. {e}")

            if org_ids:
                def fetch_organizations():
                    return self.supabase.table('organizations').select(
                        'id, name, summary_focus, region_scope'
                    ).in_('id', list(set(org_ids))).execute()

                try:
                    orgs_res = self.database_operation_with_retry(
                        fetch_organizations,
                        "Fetch organizations bio data from organizations table"
                    )
                    for o in orgs_res.data or []:
                        for uname in oid_to_usernames.get(o['id'], []):
                            actor_bio[uname] = {
                                'type': 'organization',
                                'name': o.get('name') or '',
                                'summary_focus': o.get('summary_focus') or '',
                                'region_scope': o.get('region_scope') or '',
                                'usernames': oid_to_usernames.get(o['id'], [])
                            }
                except Exception as e:
                    print(f"⚠️ Warning: Could not fetch organizations data after retries. {e}")

        except Exception as e:
            print(f"⚠️ Warning: Could not fetch from actor_usernames or related tables. {e}")

        print(f"Loaded biographical info for {len(actor_bio)} actors in batch (v1 schema)")
        return actor_bio

    def generate_event_hash(self, event_data):
        """Generate unique hash for event deduplication including source post IDs"""
        # Normalize and combine key fields with None handling
        event_name = event_data.get('EventName') or ''
        location = event_data.get('Location') or ''
        city = event_data.get('City') or ''
        state = event_data.get('State') or ''
        
        hash_components = [
            event_name.lower().strip() if isinstance(event_name, str) else '',
            event_data.get('EventDate') or event_data.get('Date', ''),
            location.lower().strip() if isinstance(location, str) else '',
            city.lower().strip() if isinstance(city, str) else '',
            state.upper().strip() if isinstance(state, str) else '',
            # Include sorted source post IDs to ensure same posts = same event
            '|'.join(sorted(event_data.get('SourceIDs', [])))
        ]
        
        # Create consistent string representation
        hash_string = '|'.join(str(c) for c in hash_components)
        
        # Generate SHA256 hash (full 64 char hex)
        content_hash = hashlib.sha256(hash_string.encode()).hexdigest()
        
        if DEBUG:
            print(f"[DEBUG] Generated hash {content_hash[:8]}... for event: {event_data.get('EventName')}")
            print(f"[DEBUG] Hash components: {hash_components}")
        
        return content_hash

    def verify_posts_exist(self, post_uuids):
        """Return a set of post UUIDs that exist in the database"""
        if not post_uuids:
            return set()

        table_name = 'v2_social_media_posts' if USE_V2_SCHEMA else 'social_media_posts'

        unique_ids = list(set(pid for pid in post_uuids if pid))

        def fetch_posts():
            return (
                self.supabase
                .table(table_name)
                .select('id')
                .in_('id', unique_ids)
                .execute()
            )

        try:
            result = self.database_operation_with_retry(
                fetch_posts,
                f"Verify {len(unique_ids)} posts exist",
            )
            return set(row['id'] for row in (result.data or []))
        except Exception as e:
            print(f"⚠️ Warning: Could not verify posts after retries: {e}")
            return set()

    def save_event_to_supabase(self, event_data):
        """Save extracted event to database using content hash for deduplication"""
        try:
            # Generate content hash for deduplication
            content_hash = self.generate_event_hash(event_data)
            
            # Handle date formatting - check both EventDate and Date fields
            event_date = event_data.get('EventDate') or event_data.get('Date', '')
            if event_date and event_date.endswith('-00'):
                event_date = event_date.replace('-00', '-01')
                if DEBUG:
                    print(f"[DEBUG] Invalid date format {event_data.get('EventDate') or event_data.get('Date')} converted to {event_date}")
            elif not event_date:
                event_date = None

            # Choose table based on v2 schema setting
            table_name = 'v2_events' if USE_V2_SCHEMA else 'events'

            event_insert = {
                'event_name': event_data['EventName'],
                'event_date': event_date,
                'event_description': event_data.get('EventDescription', ''),
                'location': event_data.get('Location', ''),
                'city': event_data.get('City', ''),
                'state': event_data.get('State', ''),
                'participants': event_data.get('Participants', ''),
                'justification': event_data.get('Justification', ''),
                'category_tags': event_data.get('CategoryTags', []),
                'event_type': 'extracted',
                'source_post_ids': event_data.get('SourceIDs', []),
                'confidence_score': event_data.get('ConfidenceScore', 0.5),
                'instagram_handles': event_data.get('InstagramHandles', []),
                'twitter_handles': event_data.get('TwitterHandles', []),
                'extracted_by': f"{MODEL_NAME}_concurrent_{len(self.api_manager.workers)}workers",
                'extracted_at': datetime.now().isoformat(),
                'verified': False,
                'content_hash': content_hash  # Add content hash for deduplication
            }

            # Add project_id for v2 schema
            if USE_V2_SCHEMA:
                event_insert['project_id'] = DEFAULT_PROJECT_ID

            # Use UPSERT with content_hash as the conflict key
            # This will insert new events or update existing ones with same hash
            result = self.supabase.table(table_name).upsert(
                event_insert,
                on_conflict='content_hash'
            ).execute()
            
            if result.data:
                event_id = result.data[0]['id']
                is_new = result.data[0].get('created_at') == result.data[0].get('updated_at')
                
                if is_new:
                    print(f"  ✅ Saved NEW event: {event_data['EventName']} (ID: {event_id}, Hash: {content_hash[:8]}..., Confidence: {event_data.get('ConfidenceScore', 0.5):.2f})")
                else:
                    print(f"  ⚠️ Event already exists: {event_data['EventName']} (ID: {event_id}, Hash: {content_hash[:8]}...) - Skipping duplicate")

                # Cache any new slugs found in this event (only for new events)
                if is_new and event_data.get('CategoryTags'):
                    for tag in event_data['CategoryTags']:
                        if ':' in tag:
                            self.slug_manager.save_new_slug(tag)

                # Return event ID and whether it was new
                return {'event_id': event_id, 'is_new': is_new}
            else:
                print(f"  ❌ Failed to save/update event: {event_data['EventName']}")
                return None
        except Exception as e:
            # Check if the error is due to missing content_hash column
            if "content_hash" in str(e).lower() and "column" in str(e).lower():
                print(f"  ❌ ERROR: content_hash column missing! Please run the migration: add_content_hash_to_events.sql")
                print(f"     Full error: {str(e)}")
            else:
                print(f"  ❌ Error saving event to Supabase: {str(e)}")
            return None

    def save_events_batch_to_supabase(self, events_data):
        """Upsert multiple events in a single batch using content_hash for deduplication."""
        if not events_data:
            return {}

        table_name = 'v2_events' if USE_V2_SCHEMA else 'events'

        def upsert_events():
            return self.supabase.table(table_name).upsert(
                events_data,
                on_conflict='content_hash'
            ).execute()

        try:
            result = self.database_operation_with_retry(
                upsert_events,
                f"Upsert {len(events_data)} events batch"
            )

            mapping = {}
            if result.data:
                for row in result.data:
                    mapping[row['content_hash']] = {
                        'event_id': row['id'],
                        'is_new': row.get('created_at') == row.get('updated_at')
                    }
            else:
                print(f"  ⚠️ No data returned when upserting events batch")
            return mapping
        except Exception as e:
            print(f"  ❌ Error upserting events batch: {e}")
            return {}

    def create_event_post_links(self, event_id, post_uuids):
        """Create links between events and posts with retry logic using UPSERT"""
        existing_ids = self.verify_posts_exist(post_uuids)
        valid_post_uuids = [pid for pid in post_uuids if pid in existing_ids]
        for pid in post_uuids:
            if pid and pid not in existing_ids:
                print(f"  ⚠️ Warning: Post UUID {pid} does not exist in database, skipping")

        if not event_id or not valid_post_uuids:
            if DEBUG:
                print(f"[DEBUG] Skipping post links - event_id: {event_id}, valid posts: {len(valid_post_uuids)}")
            return

        # Choose table based on v2 schema setting
        table_name = 'v2_event_post_links' if USE_V2_SCHEMA else 'event_post_links'

        def create_links():
            links = [{'event_id': event_id, 'post_id': post_uuid} for post_uuid in valid_post_uuids]
            # Use upsert to handle duplicates gracefully
            # Don't return any columns since the table has no id column
            return self.supabase.table(table_name).upsert(
                links, 
                on_conflict='event_id,post_id',
                returning=ReturnMethod.minimal  # Don't return any data to avoid id column issues
            ).execute()

        try:
            if DEBUG:
                print(f"[DEBUG] Attempting to upsert {len(valid_post_uuids)} post links for verified posts")

            result = self.database_operation_with_retry(
                create_links,
                f"Upsert {len(valid_post_uuids)} event-post links"
            )

            # With returning='minimal', result.data will be None but that's OK
            print(f"  ✅ Upserted {len(valid_post_uuids)} event-post links (duplicates handled)")

        except Exception as e:
            # If upsert fails, fall back to individual inserts with ON CONFLICT handling
            print(f"  ⚠️ Upsert failed, trying individual inserts: {str(e)}")
            self._create_event_post_links_fallback(event_id, valid_post_uuids, table_name)

    def bulk_create_event_post_links(self, link_rows):
        """Upsert multiple event-post links in a single batch."""
        if not link_rows:
            return

        table_name = 'v2_event_post_links' if USE_V2_SCHEMA else 'event_post_links'

        def upsert_links():
            return self.supabase.table(table_name).upsert(
                link_rows,
                on_conflict='event_id,post_id',
                returning=ReturnMethod.minimal  # Don't return any data to avoid id column issues
            ).execute()

        try:
            result = self.database_operation_with_retry(
                upsert_links,
                f"Upsert {len(link_rows)} event-post links batch"
            )
            # With returning='minimal', result.data will be None but that's OK
            print(f"  ✅ Upserted {len(link_rows)} event-post links in batch")
        except Exception as e:
            print(f"  ❌ Error upserting event-post link batch: {e}")
            for link in link_rows:
                self._create_event_post_links_fallback(link['event_id'], [link['post_id']], table_name)

    def migrate_post_actor_links_to_event(self, event_id, post_ids):
        """Migrate post-actor links to event-actor links based on linked posts"""
        try:
            if not event_id or not post_ids:
                print(f"  ⚠️ No event_id or post_ids for actor link migration")
                return set(), set()  # Return empty sets for instagram and twitter handles
            
            print(f"  🔄 Migrating post-actor links from {len(post_ids)} posts to event {event_id}")
            
            # Query v2_post_actors for all linked posts
            post_actors = []
            for i in range(0, len(post_ids), 50):  # Batch to avoid query limits
                batch = post_ids[i:i+50]
                try:
                    result = self.supabase.table('v2_post_actors').select(
                        'actor_id, actor_type, relationship_type'
                    ).in_('post_id', batch).execute()
                    post_actors.extend(result.data or [])
                except Exception as e:
                    print(f"     ⚠️ Error fetching post actors for batch: {e}")
            
            if not post_actors:
                print(f"     ℹ️ No post-actor links found for these posts")
                return set(), set()
            
            print(f"     Found {len(post_actors)} post-actor relationships to migrate")
            
            # Get actor usernames for these actors
            unique_actor_ids = list(set(pa['actor_id'] for pa in post_actors))
            actor_usernames_map = {}
            
            for i in range(0, len(unique_actor_ids), 50):
                batch = unique_actor_ids[i:i+50]
                try:
                    result = self.supabase.table('v2_actor_usernames').select(
                        'actor_id, username, platform'
                    ).in_('actor_id', batch).execute()
                    
                    for au in result.data or []:
                        if au['actor_id'] not in actor_usernames_map:
                            actor_usernames_map[au['actor_id']] = []
                        actor_usernames_map[au['actor_id']].append({
                            'username': au['username'],
                            'platform': au['platform']
                        })
                except Exception as e:
                    print(f"     ⚠️ Error fetching actor usernames for batch: {e}")
            
            # Create event-actor links
            links_to_create = []
            instagram_handles = set()
            twitter_handles = set()
            
            for pa in post_actors:
                actor_id = pa['actor_id']
                actor_type = pa['actor_type']
                
                # Get all usernames for this actor
                usernames = actor_usernames_map.get(actor_id, [])
                
                for username_info in usernames:
                    username = username_info['username']
                    platform = username_info['platform']
                    
                    # Track handles by platform
                    if platform == 'instagram':
                        instagram_handles.add(username)
                    elif platform == 'twitter':
                        twitter_handles.add(username)
                    
                    # Create link record
                    links_to_create.append({
                        'event_id': event_id,
                        'actor_handle': username,
                        'actor_type': actor_type,
                        'platform': platform,
                        'actor_id': actor_id
                    })
            
            # Remove duplicates based on (event_id, actor_handle, platform)
            seen = set()
            unique_links = []
            for link in links_to_create:
                key = (link['event_id'], link['actor_handle'], link['platform'])
                if key not in seen:
                    seen.add(key)
                    unique_links.append(link)
            
            if unique_links:
                # Use upsert to handle any conflicts
                try:
                    result = self.supabase.table('v2_event_actor_links').upsert(
                        unique_links,
                        on_conflict='event_id,actor_handle,platform'
                    ).execute()
                    print(f"     ✅ Migrated {len(unique_links)} unique actor links from posts")
                    print(f"        Instagram: {len(instagram_handles)}, Twitter: {len(twitter_handles)}")
                except Exception as e:
                    print(f"     ⚠️ Error creating event-actor links: {e}")
                    # Try fallback one by one
                    created = 0
                    for link in unique_links:
                        try:
                            self.supabase.table('v2_event_actor_links').upsert(
                                link,
                                on_conflict='event_id,actor_handle,platform'
                            ).execute()
                            created += 1
                        except:
                            pass
                    print(f"     ✅ Migrated {created}/{len(unique_links)} actor links via fallback")
            
            return instagram_handles, twitter_handles
            
        except Exception as e:
            print(f"  ❌ Error in migrate_post_actor_links_to_event: {e}")
            return set(), set()

    def create_event_actor_links(self, event_id, instagram_handles, twitter_handles):
        """Create links between events and actors using a single bulk query for efficiency."""
        try:
            if not event_id:
                print(f"  ⚠️ No event_id provided for actor linking")
                return

            # Combine and get unique handles
            all_handles = list(set(instagram_handles) | set(twitter_handles))
            if not all_handles:
                print(f"  ⚠️ No handles provided for actor linking")
                return

            print(f"  🔗 Creating actor links for event {event_id}")
            print(f"     Instagram handles ({len(instagram_handles)}): {instagram_handles[:5]}{'...' if len(instagram_handles) > 5 else ''}")
            print(f"     Twitter handles ({len(twitter_handles)}): {twitter_handles[:5]}{'...' if len(twitter_handles) > 5 else ''}")
            print(f"     Total unique handles: {len(all_handles)}")

            actor_username_table = 'v2_actor_usernames' if USE_V2_SCHEMA else 'actor_usernames'
            print(f"     Using table: {actor_username_table}")

            # --- Bulk Lookup ---
            # We need to look up actors for both Instagram and Twitter handles separately
            # because the database stores platform-specific records
            known_actors_map = {}
            
            try:
                # Look up Instagram handles
                if instagram_handles:
                    def lookup_instagram_actors():
                        return self.supabase.table(actor_username_table).select(
                            'username, platform, actor_id, actor_type'
                        ).in_('username', list(instagram_handles)).eq('platform', 'instagram').execute()
                    
                    instagram_result = self.database_operation_with_retry(
                        lookup_instagram_actors,
                        f"Instagram actor lookup for {len(instagram_handles)} handles"
                    )
                    
                    if instagram_result.data:
                        for actor_data in instagram_result.data:
                            key = (actor_data['username'], actor_data['platform'])
                            known_actors_map[key] = actor_data
                
                # Look up Twitter handles
                if twitter_handles:
                    def lookup_twitter_actors():
                        return self.supabase.table(actor_username_table).select(
                            'username, platform, actor_id, actor_type'
                        ).in_('username', list(twitter_handles)).eq('platform', 'twitter').execute()
                    
                    twitter_result = self.database_operation_with_retry(
                        lookup_twitter_actors,
                        f"Twitter actor lookup for {len(twitter_handles)} handles"
                    )
                    
                    if twitter_result.data:
                        for actor_data in twitter_result.data:
                            key = (actor_data['username'], actor_data['platform'])
                            known_actors_map[key] = actor_data
                
                if known_actors_map:
                    print(f"       ✅ Found {len(known_actors_map)} known actors in platform-specific queries.")
                else:
                    print(f"       ℹ️ No known actors found in database for these handles")

            except Exception as lookup_error:
                print(f"       ⚠️ Bulk actor lookup failed after retries: {lookup_error}")
                # The process will continue, treating all actors as unknown

            # --- Link Creation ---
            links = []
            failed_lookups = []

            # Determine platform for each handle
            handle_to_platform = {handle: 'instagram' for handle in instagram_handles}
            handle_to_platform.update({handle: 'twitter' for handle in twitter_handles})

            for handle in all_handles:
                platform = handle_to_platform.get(handle)
                if not platform: continue # Should not happen

                key = (handle, platform)

                if key in known_actors_map:
                    actor_data = known_actors_map[key]
                    links.append({
                        'event_id': event_id,
                        'actor_handle': handle,
                        'actor_type': actor_data['actor_type'],
                        'platform': platform,
                        'actor_id': actor_data['actor_id']
                    })
                else:
                    # Handle is unknown
                    links.append({
                        'event_id': event_id,
                        'actor_handle': handle,
                        'actor_type': 'unknown',
                        'platform': platform,
                        'actor_id': None
                    })
                    failed_lookups.append(f"{handle}@{platform}")

            if failed_lookups:
                print(f"       ℹ️ {len(failed_lookups)} unknown actors will be linked: {', '.join(failed_lookups[:5])}{'...' if len(failed_lookups) > 5 else ''}")

            if links:
                event_actor_links_table = 'v2_event_actor_links' if USE_V2_SCHEMA else 'event_actor_links'

                def create_actor_links_bulk():
                    # Use upsert to handle duplicates gracefully
                    return self.supabase.table(event_actor_links_table).upsert(
                        links,
                        on_conflict='event_id,actor_handle,platform'
                    ).execute()

                try:
                    self.database_operation_with_retry(
                        create_actor_links_bulk,
                        f"Upsert {len(links)} event-actor links"
                    )
                    known_count = len(links) - len(failed_lookups)
                    unknown_count = len(failed_lookups)
                    print(f"  ✅ Upserted {len(links)} event-actor links ({known_count} known actors, {unknown_count} unknown actors)")
                    
                    # Check if unknown actors need to be created in v2_unknown_actors table
                    if unknown_count > 0 and USE_V2_SCHEMA:
                        self._ensure_unknown_actors_exist(failed_lookups, handle_to_platform)
                except Exception as e:
                    # If upsert fails, fall back to individual handling
                    print(f"  ⚠️ Upsert failed, trying fallback method: {str(e)}")
                    self._create_event_actor_links_fallback(event_id, links, event_actor_links_table, failed_lookups, handle_to_platform)

        except Exception as e:
            print(f"  ❌ Critical error in create_event_actor_links: {str(e)}")


    def _ensure_unknown_actors_exist(self, failed_lookups, handle_to_platform):
        """Ensure unknown actors exist in v2_unknown_actors table"""
        try:
            # Parse handles from failed_lookups (format: "handle@platform")
            unknown_actors_to_create = []
            
            for lookup in failed_lookups:
                if '@' in lookup:
                    handle, platform = lookup.split('@', 1)
                else:
                    handle = lookup
                    platform = handle_to_platform.get(handle, 'unknown')
                
                unknown_actors_to_create.append({
                    'detected_username': handle,
                    'platform': platform,
                    'first_seen_date': datetime.now().isoformat(),
                    'last_seen_date': datetime.now().isoformat(),
                    'mention_count': 1
                })
            
            if unknown_actors_to_create:
                try:
                    # Try to insert, ignoring duplicates
                    self.supabase.table('v2_unknown_actors').upsert(
                        unknown_actors_to_create,
                        on_conflict='detected_username,platform'
                    ).execute()
                    print(f"       ✅ Ensured {len(unknown_actors_to_create)} unknown actors exist in database")
                except Exception as e:
                    # It's okay if this fails - the actors might already exist
                    if "duplicate" not in str(e).lower():
                        print(f"       ⚠️ Could not ensure unknown actors exist: {e}")
        except Exception as e:
            print(f"       ⚠️ Error in _ensure_unknown_actors_exist: {e}")

    def _create_event_post_links_fallback(self, event_id, post_uuids, table_name):
        """Fallback method to create event-post links one by one, ignoring duplicates"""
        created_count = 0
        for post_uuid in post_uuids:
            try:
                def create_single_link():
                    return self.supabase.table(table_name).upsert(
                        {'event_id': event_id, 'post_id': post_uuid},
                        on_conflict='event_id,post_id',
                        returning=ReturnMethod.minimal  # Don't return any data to avoid id column issues
                    ).execute()
                
                result = self.database_operation_with_retry(
                    create_single_link,
                    f"Create single event-post link {event_id}->{post_uuid}"
                )
                # With returning='minimal', result.data will be None but that's OK
                created_count += 1
            except Exception as e:
                if "duplicate" in str(e).lower() or "unique constraint" in str(e).lower():
                    if DEBUG:
                        print(f"[DEBUG] Link {event_id}->{post_uuid} already exists, skipping")
                else:
                    print(f"  ⚠️ Failed to create link {event_id}->{post_uuid}: {e}")
        
        print(f"  ✅ Created {created_count}/{len(post_uuids)} event-post links (fallback method)")

    def _create_event_actor_links_fallback(self, event_id, links, table_name, failed_lookups, handle_to_platform):
        """Fallback method to create event-actor links one by one, ignoring duplicates"""
        created_count = 0
        for link in links:
            try:
                def create_single_link():
                    return self.supabase.table(table_name).insert(link).execute()
                
                result = self.database_operation_with_retry(
                    create_single_link,
                    f"Create single event-actor link {link['event_id']}->{link['actor_handle']}"
                )
                if result.data:
                    created_count += 1
            except Exception as e:
                if "duplicate" in str(e).lower() or "unique constraint" in str(e).lower():
                    if DEBUG:
                        print(f"[DEBUG] Link {link['event_id']}->{link['actor_handle']} already exists, skipping")
                else:
                    print(f"  ⚠️ Failed to create link {link['event_id']}->{link['actor_handle']}: {e}")
        
        print(f"  ✅ Created {created_count}/{len(links)} event-actor links (fallback method)")
        
        # Still ensure unknown actors exist
        if failed_lookups and USE_V2_SCHEMA:
            self._ensure_unknown_actors_exist(failed_lookups, handle_to_platform)

    def _create_event_unknown_actor_links_fallback(self, unique_links_list):
        """Fallback method to create event-unknown actor links one by one, ignoring duplicates"""
        created_count = 0
        # FIXED: Use v2_event_actor_links instead of non-existent v2_event_unknown_actors
        event_actor_links_table = 'v2_event_actor_links' if USE_V2_SCHEMA else 'event_actor_links'
        
        for link in unique_links_list:
            try:
                def create_single_unknown_link():
                    # Insert into event_actor_links with unknown_actor_id
                    # Structure needs adjustment for v2_event_actor_links
                    actor_link = {
                        'event_id': link['event_id'],
                        'actor_handle': link.get('actor_handle', f"unknown_{link.get('unknown_actor_id')}"),
                        'platform': link.get('platform', 'unknown'),
                        'actor_type': link.get('actor_type', 'unknown'),
                        'unknown_actor_id': link.get('unknown_actor_id')
                    }
                    return self.supabase.table(event_actor_links_table).insert(actor_link).execute()
                
                result = self.database_operation_with_retry(
                    create_single_unknown_link,
                    f"Create single event-unknown actor link {link['event_id']}->{link['unknown_actor_id']}"
                )
                if result.data:
                    created_count += 1
            except Exception as e:
                if "duplicate" in str(e).lower() or "unique constraint" in str(e).lower():
                    if DEBUG:
                        print(f"[DEBUG] Unknown actor link {link['event_id']}->{link['unknown_actor_id']} already exists, skipping")
                else:
                    print(f"  ⚠️ Failed to create unknown actor link {link['event_id']}->{link['unknown_actor_id']}: {e}")
        
        print(f"      ✅ Created {created_count}/{len(unique_links_list)} event-unknown actor links (fallback method)")
        if created_count > 0:
            self.update_stats('event_unknown_actor_links_created', created_count)
    
    def load_unknown_actors_lookup(self, specific_handles=None):
        """Load unknown actors for text matching
        
        Args:
            specific_handles: Optional list of handles to load. If None, loads all (expensive!)
        """
        try:
            # Choose unknown actors table based on v2 schema setting
            unknown_actors_table = 'v2_unknown_actors' if USE_V2_SCHEMA else 'unknown_actors'
            
            if not hasattr(self, 'unknown_actors_lookup'):
                self.unknown_actors_lookup = {}
            
            if specific_handles:
                # Optimize: Only fetch the unknown actors we need
                handles_lower = [h.lower() for h in specific_handles if h]
                if not handles_lower:
                    return
                    
                # Batch fetch in chunks of 100
                for i in range(0, len(handles_lower), 100):
                    batch = handles_lower[i:i+100]
                    try:
                        result = self.supabase.table(unknown_actors_table).select(
                            'id, detected_username, platform'
                        ).in_('detected_username', batch).execute()
                        
                        for record in result.data or []:
                            platform = record['platform']
                            username = record['detected_username'].lower()
                            key = f"{platform}:{username}"
                            self.unknown_actors_lookup[key] = record['id']
                    except Exception as e:
                        print(f"   ⚠️ Error fetching unknown actors batch: {e}")
                        
                print(f"📋 Loaded {len(self.unknown_actors_lookup)} unknown actors for specific handles")
            else:
                # Fall back to loading all (expensive!)
                print("   ⚠️ Loading ALL unknown actors (60k+ records) - this is slow!")
                from utils.database import fetch_all_rows
                query = self.supabase.table(unknown_actors_table).select('id, detected_username, platform')
                rows = fetch_all_rows(query)
                self.unknown_actors_lookup = {}
                for record in rows:
                    platform = record['platform']
                    username = record['detected_username'].lower()
                    key = f"{platform}:{username}"
                    self.unknown_actors_lookup[key] = record['id']
                print(f"📋 Loaded {len(self.unknown_actors_lookup)} unknown actors for event linking")

        except Exception as e:
            print(f"⚠️  Warning: Could not load unknown actors lookup: {e}")
            self.unknown_actors_lookup = {}

    def find_unknown_actor_by_username(self, username, platform):
        """Find unknown actor ID by username and platform"""
        try:
            if not self.unknown_actors_lookup:
                self.load_unknown_actors_lookup()

            lookup_key = f"{platform}:{username.lower()}"
            return self.unknown_actors_lookup.get(lookup_key)

        except Exception as e:
            print(f"   ⚠️  Error finding unknown actor {username}: {e}")
            return None

    def find_unknown_actors_in_text(self, text):
        """Find unknown actors mentioned in text using common patterns"""
        try:
            if not self.unknown_actors_lookup:
                self.load_unknown_actors_lookup()

            found_actor_ids = []
            text_lower = text.lower()

            # Look for @username patterns
            import re
            username_patterns = re.findall(r'@([a-zA-Z0-9_]+)', text_lower)
            for username in username_patterns:
                for platform in ['twitter', 'instagram']:
                    lookup_key = f"{platform}:{username}"
                    if lookup_key in self.unknown_actors_lookup:
                        found_actor_ids.append(self.unknown_actors_lookup[lookup_key])

            # Look for direct username mentions (without @)
            for lookup_key, actor_id in self.unknown_actors_lookup.items():
                platform, username = lookup_key.split(':', 1)
                if username in text_lower and len(username) > 3:  # Avoid short false matches
                    found_actor_ids.append(actor_id)

            return list(set(found_actor_ids))  # Remove duplicates

        except Exception as e:
            print(f"   ⚠️  Error finding unknown actors in text: {e}")
            return []

    def _load_actor_directory_map(self, specific_handles=None):
        """Map (platform, username)-> actor_uid/actor_id/actor_type from v_actor_directory
        
        Args:
            specific_handles: Optional list of handles to fetch. If None, loads all (expensive!).
        """
        by_key = {}
        
        if specific_handles:
            # Optimize: Only fetch the actors we need
            handles_lower = [h.lower() for h in specific_handles if h]
            if not handles_lower:
                return by_key
                
            # Batch fetch in chunks of 100 to avoid query size limits
            for i in range(0, len(handles_lower), 100):
                batch = handles_lower[i:i+100]
                try:
                    # Fetch all actors whose username is in our batch
                    result = self.supabase.table('v_actor_directory').select(
                        'actor_uid, actor_id, username, platform, actor_type'
                    ).in_('username', batch).execute()
                    
                    for r in result.data or []:
                        key = f"{(r['platform'] or '').lower()}:{(r['username'] or '').lower()}"
                        by_key[key] = {
                            'actor_uid': r['actor_uid'], 
                            'actor_id': r.get('actor_id'), 
                            'actor_type': r.get('actor_type')
                        }
                        
                except Exception as e:
                    print(f"   ⚠️ Error fetching actor directory batch: {e}")
        else:
            # Fall back to loading all (expensive!)
            print("   ⚠️ Loading entire actor directory (40k+ records) - this is slow!")
            from utils.database import fetch_all_rows
            rows = fetch_all_rows(self.supabase.table('v_actor_directory').select('actor_uid, actor_id, username, platform, actor_type'))
            for r in rows or []:
                key = f"{(r['platform'] or '').lower()}:{(r['username'] or '').lower()}"
                by_key[key] = {'actor_uid': r['actor_uid'], 'actor_id': r.get('actor_id'), 'actor_type': r.get('actor_type')}
        
        return by_key

    def _extract_handles_from_event_text(self, event_dict):
        """Scans Participants, EventDescription, Justification for @handles"""
        import re
        buckets = []
        for field in ('Participants','EventDescription','Justification'):
            txt = (event_dict.get(field) or '')
            if not isinstance(txt, str): 
                continue
            buckets.append(txt)

        text = '\n'.join(buckets).lower()
        at_handles = re.findall(r'@([a-z0-9_]{2,32})', text)
        return set(h.lower() for h in at_handles)

    def link_event_actors_unified(self, event_id, event_dict, event_post_ids):
        """
        One pass that:
          1) Migrates all known+unknown actors linked to posts of this event
          2) Adds any @mentioned usernames in event text that weren't tied to a post
        Writes only into v2_event_actor_links (for both known & unknown; unknown uses unknown_actor_id).
        """
        # 0) Collect all handles we need to look up first
        all_handles_needed = set()
        
        # Get handles from event text
        mentioned = self._extract_handles_from_event_text(event_dict)
        all_handles_needed.update(mentioned)
        
        # Get Instagram and Twitter handles from event
        instagram_handles = event_dict.get('InstagramHandles', [])
        twitter_handles = event_dict.get('TwitterHandles', [])
        all_handles_needed.update(instagram_handles)
        all_handles_needed.update(twitter_handles)
        
        # Load actor directory for just the handles we need (much faster!)
        if all_handles_needed:
            self._actor_dir = self._load_actor_directory_map(specific_handles=list(all_handles_needed))
        else:
            self._actor_dir = {}
            
        # Load unknown actors for just the handles we need
        if all_handles_needed:
            self.load_unknown_actors_lookup(specific_handles=list(all_handles_needed))
        elif not getattr(self, 'unknown_actors_lookup', None):
            self.unknown_actors_lookup = {}

        event_actor_links_table = 'v2_event_actor_links' if USE_V2_SCHEMA else 'event_actor_links'

        # Containers to upsert
        links = {}  # key: (event_id, platform, handle)
        unknown_links = {}  # key: (event_id, unknown_actor_id)

        # 1) All post-linked actors → event links
        # Known actors via v2_post_actors → actor_usernames (directory handles)
        def fetch_post_known():
            return (self.supabase.table('v2_post_actors')
                    .select('post_id,actor_id,relationship_type')
                    .in_('post_id', event_post_ids)).execute()

        try:
            res = self.database_operation_with_retry(fetch_post_known, f"Fetch known post-actors for {len(event_post_ids)} posts")
            known_rows = res.data or []
        except Exception as e:
            print(f"   ⚠️ Known post-actor fetch failed: {e}")
            known_rows = []

        # Join to v_actor_directory by actor_id -> platform/username
        actor_id_set = list({r['actor_id'] for r in known_rows if r.get('actor_id')})
        known_usernames = {}
        if actor_id_set:
            def fetch_usernames():
                return (self.supabase.table('v_actor_directory')
                        .select('actor_id,username,platform,actor_type,actor_uid')
                        .in_('actor_id', actor_id_set)).execute()
            try:
                dres = self.database_operation_with_retry(fetch_usernames, f"Fetch known usernames for {len(actor_id_set)} actors")
                for r in dres.data or []:
                    known_usernames.setdefault(r['actor_id'], []).append(r)
            except Exception as e:
                print(f"   ⚠️ Username directory fetch failed: {e}")

        for row in known_rows:
            aid = row.get('actor_id')
            for r in known_usernames.get(aid, []):
                handle = r['username']
                plat = (r['platform'] or '').lower()
                key = (event_id, plat, handle)
                links[key] = {
                    'event_id': event_id,
                    'actor_id': aid,
                    'actor_handle': handle,
                    'platform': plat,
                    'actor_type': r.get('actor_type') or 'person'
                }

        # Unknown actors already linked to posts → keep their unknown_actor_id
        def fetch_post_unknown():
            return (self.supabase.table('v2_post_unknown_actors')
                    .select('post_id,unknown_actor_id')
                    .in_('post_id', event_post_ids)).execute()

        try:
            ures = self.database_operation_with_retry(fetch_post_unknown, f"Fetch unknown post-actors for {len(event_post_ids)} posts")
            for link in (ures.data or []):
                k = (event_id, link['unknown_actor_id'])
                unknown_links[k] = {
                    'event_id': event_id,
                    'actor_handle': f"unknown_{link['unknown_actor_id']}",
                    'platform': 'unknown',
                    'actor_type': 'unknown',
                    'unknown_actor_id': link['unknown_actor_id']
                }
        except Exception as e:
            print(f"   ⚠️ Unknown post-actor fetch failed: {e}")

        # 2) Add @mentions from event text that weren't tied to a post
        mentioned = self._extract_handles_from_event_text(event_dict)  # set of handles
        # Also include Gemini-returned handle arrays
        for h in event_dict.get('InstagramHandles', []) or []:
            mentioned.add(h.lower())
        for h in event_dict.get('TwitterHandles', []) or []:
            mentioned.add(h.lower())

        # Remove anything we already linked from posts (by handle+platform)
        already = {(k[1], k[2]) for k in links.keys()}
        still_needed = set()
        for h in mentioned:
            # We'll try both platforms unless the handle appears in directory for a specific platform
            still_needed.add(('instagram', h))
            still_needed.add(('twitter', h))

        still_needed = {hp for hp in still_needed if hp not in already}

        # Resolve against v_actor_directory → known first
        for plat, h in list(still_needed):
            look_key = f"{plat}:{h}"
            if look_key in self._actor_dir:
                meta = self._actor_dir[look_key]
                key = (event_id, plat, h)
                links[key] = {
                    'event_id': event_id,
                    'actor_id': meta.get('actor_id'),
                    'actor_handle': h,
                    'platform': plat,
                    'actor_type': meta.get('actor_type') or 'person'
                }
                still_needed.discard((plat, h))

        # Anything left → try to match to unknown_actors_lookup; if present, link with unknown_actor_id
        for plat, h in list(still_needed):
            uaid = self.find_unknown_actor_by_username(h, plat)
            if uaid:
                uk = (event_id, uaid)
                unknown_links[uk] = {
                    'event_id': event_id,
                    'actor_handle': f'unknown_{uaid}',
                    'platform': 'unknown',
                    'actor_type': 'unknown',
                    'unknown_actor_id': uaid
                }

        # 3) Upsert (known + unknown) without duplicates
        to_upsert = list(links.values())
        to_upsert_unknown = list(unknown_links.values())

        def upsert_known():
            return self.supabase.table(event_actor_links_table).upsert(
                to_upsert,
                on_conflict='event_id,actor_handle,platform'
            ).execute()

        if to_upsert:
            self.database_operation_with_retry(upsert_known, f"Upsert {len(to_upsert)} event-actor links")

        if to_upsert_unknown:
            # Already using unique actor_handle per unknown_actor_id, just deduplicate by key
            deduplicated_unknown = {}
            for item in to_upsert_unknown:
                key = (item['event_id'], item['actor_handle'], item['platform'])
                deduplicated_unknown[key] = item
            
            to_upsert_unknown = list(deduplicated_unknown.values())
            
            def upsert_unknown():
                # store unknown_actor_id in v2_event_actor_links
                return self.supabase.table(event_actor_links_table).upsert(
                    to_upsert_unknown,
                    on_conflict='event_id,actor_handle,platform'
                ).execute()
            self.database_operation_with_retry(upsert_unknown, f"Upsert {len(to_upsert_unknown)} event-unknown actor links")

        print(f"      🔗 Linked {len(to_upsert)} known + {len(to_upsert_unknown)} unknown actors to event {event_id}")

    def create_event_unknown_actor_links(self, event_id, event_data):
        """Create links between events and unknown actors mentioned in the event"""
        try:
            unknown_actor_links = []

            # Check participants field for unknown actors
            if event_data.get('participants'):
                participants_text = event_data['participants'].lower()
                unknown_actors = self.find_unknown_actors_in_text(participants_text)
                for actor_id in unknown_actors:
                    unknown_actor_links.append({
                        'id': str(uuid.uuid4()),
                        'event_id': event_id,
                        'unknown_actor_id': actor_id,
                        'created_at': datetime.now().isoformat()
                    })

            # Check twitter_handles for unknown actors
            if event_data.get('twitter_handles'):
                for handle in event_data['twitter_handles']:
                    actor_id = self.find_unknown_actor_by_username(handle.lower(), 'twitter')
                    if actor_id:
                        unknown_actor_links.append({
                            'id': str(uuid.uuid4()),
                            'event_id': event_id,
                            'unknown_actor_id': actor_id,
                            'created_at': datetime.now().isoformat()
                        })

            # Check instagram_handles for unknown actors
            if event_data.get('instagram_handles'):
                for handle in event_data['instagram_handles']:
                    actor_id = self.find_unknown_actor_by_username(handle.lower(), 'instagram')
                    if actor_id:
                        unknown_actor_links.append({
                            'id': str(uuid.uuid4()),
                            'event_id': event_id,
                            'unknown_actor_id': actor_id,
                            'created_at': datetime.now().isoformat()
                        })

            # Check associated_actors for unknown actors
            if event_data.get('associated_actors'):
                for actor in event_data['associated_actors']:
                    if isinstance(actor, str):
                        actor_text = actor.lower()
                    else:
                        actor_text = str(actor).lower()

                    unknown_actors = self.find_unknown_actors_in_text(actor_text)
                    for actor_id in unknown_actors:
                        unknown_actor_links.append({
                            'id': str(uuid.uuid4()),
                            'event_id': event_id,
                            'unknown_actor_id': actor_id,
                            'created_at': datetime.now().isoformat()
                        })

            # Insert all unknown actor links
            if unknown_actor_links:
                # FIXED: Insert unknown actor links into v2_event_actor_links
                event_actor_links_table = 'v2_event_actor_links' if USE_V2_SCHEMA else 'event_actor_links'
                
                # Transform links to match v2_event_actor_links schema
                transformed_links = []
                for link in unknown_actor_links:
                    unknown_id = link.get('unknown_actor_id')
                    transformed_links.append({
                        'event_id': link['event_id'],
                        'actor_handle': f'unknown_{unknown_id}' if unknown_id else 'unknown',
                        'platform': 'unknown',
                        'actor_type': 'unknown',
                        'unknown_actor_id': unknown_id
                    })
                
                self.supabase.table(event_actor_links_table).insert(transformed_links).execute()
                self.update_stats('event_unknown_actor_links_created', len(transformed_links))
                self.update_stats('unknown_actors_linked_to_events', len(set([link['unknown_actor_id'] for link in unknown_actor_links])))
                print(f"      🔗 Created {len(transformed_links)} event-unknown actor links")

        except Exception as e:
            print(f"   ⚠️  Error creating event-unknown actor links: {e}")

    def link_event_to_post_unknown_actors(self, event_id, source_post_ids):
        """Link events to unknown actors via the posts that generated the event with retry logic"""
        try:
            if not source_post_ids:
                return

            # Find unknown actors connected to the source posts
            post_unknown_actor_links = []
            for post_id in source_post_ids:
                # Choose post unknown actors table based on v2 schema setting
                post_unknown_actors_table = 'v2_post_unknown_actors' if USE_V2_SCHEMA else 'post_unknown_actors'

                def fetch_post_unknown_actors():
                    return self.supabase.table(post_unknown_actors_table)\
                        .select('unknown_actor_id')\
                        .eq('post_id', post_id)\
                        .execute()

                try:
                    result = self.database_operation_with_retry(
                        fetch_post_unknown_actors,
                        f"Fetch unknown actors for post {post_id}"
                    )

                    for link in result.data:
                        # Since we don't have relationship type from the post link,
                        # default to 'mentioned' for unknown actors found via posts
                        post_unknown_actor_links.append({
                            'id': str(uuid.uuid4()),
                            'event_id': event_id,
                            'unknown_actor_id': link['unknown_actor_id'],
                            'relationship_type': 'mentioned',  # Add the missing field
                            'created_at': datetime.now().isoformat()
                        })

                except Exception as e:
                    print(f"   ⚠️  Error processing post {post_id} for event links after retries: {e}")

            # Insert event-unknown actor links
            if post_unknown_actor_links:
                # Remove duplicates based on event_id and unknown_actor_id only (not relationship_type)
                unique_links = {}
                for link in post_unknown_actor_links:
                    # Use only event_id and unknown_actor_id for deduplication
                    key = f"{link['event_id']}:{link['unknown_actor_id']}"
                    unique_links[key] = link

                unique_links_list = list(unique_links.values())

                def create_unknown_actor_links():
                    # FIXED: Use v2_event_actor_links for unknown actors
                    event_actor_links_table = 'v2_event_actor_links' if USE_V2_SCHEMA else 'event_actor_links'
                    
                    # Transform links to match v2_event_actor_links schema
                    # Make actor_handle unique per unknown_actor_id to avoid conflicts
                    transformed_links = []
                    for link in unique_links_list:
                        unknown_id = link.get('unknown_actor_id')
                        transformed_links.append({
                            'event_id': link['event_id'],
                            'actor_handle': f'unknown_{unknown_id}' if unknown_id else 'unknown',
                            'platform': 'unknown',
                            'actor_type': 'unknown',
                            'unknown_actor_id': unknown_id
                        })
                    
                    # Use insert with on_conflict='nothing' to silently skip duplicates
                    # This avoids the "duplicate key" errors we've been seeing
                    return self.supabase.table(event_actor_links_table).insert(
                        transformed_links
                    ).execute()

                try:
                    self.database_operation_with_retry(
                        create_unknown_actor_links,
                        f"Insert {len(unique_links_list)} event-unknown actor links"
                    )
                    self.update_stats('event_unknown_actor_links_created', len(unique_links_list))
                    print(f"      🔗 Inserted {len(unique_links_list)} event-unknown actor links via posts")
                except Exception as e:
                    # Check if it's a duplicate key error - if so, that's OK
                    if "duplicate key" in str(e).lower() or "already exists" in str(e).lower():
                        print(f"      ℹ️ Some unknown actor links already exist, using fallback to insert only new ones")
                        # Try fallback individual inserts to handle duplicates
                        self._create_event_unknown_actor_links_fallback(unique_links_list)
                    else:
                        print(f"      ❌ Error inserting event-unknown actor links: {e}")
                        # Try fallback for other errors too
                        self._create_event_unknown_actor_links_fallback(unique_links_list)

        except Exception as e:
            print(f"   ⚠️  Error linking event to post unknown actors: {e}")

    def download_and_process_image(self, url):
        """Download and process an image for Gemini upload"""
        try:
            if DEBUG:
                print(f"[DEBUG] Downloading image from: {url}")

            # Download image with timeout
            response = requests.get(url, timeout=10, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            response.raise_for_status()

            # Check content type
            content_type = response.headers.get('content-type', '').lower()
            if not any(fmt in content_type for fmt in ['image/jpeg', 'image/png', 'image/gif', 'image/webp']):
                if DEBUG:
                    print(f"[DEBUG] Skipping unsupported content type: {content_type}")
                return None

            # Open and process image
            image = Image.open(io.BytesIO(response.content))

            # Convert to RGB if necessary
            if image.mode in ('RGBA', 'P'):
                image = image.convert('RGB')

            # Resize if too large
            if image.size[0] > self.max_image_size[0] or image.size[1] > self.max_image_size[1]:
                image.thumbnail(self.max_image_size, Image.Resampling.LANCZOS)
                if DEBUG:
                    print(f"[DEBUG] Resized image to: {image.size}")

            # Convert to bytes
            img_byte_arr = io.BytesIO()
            image.save(img_byte_arr, format='JPEG', quality=85)
            img_byte_arr.seek(0)

            if DEBUG:
                print(f"[DEBUG] Image processed successfully, size: {len(img_byte_arr.getvalue())} bytes")

            return img_byte_arr.getvalue()

        except Exception as e:
            if DEBUG:
                print(f"[DEBUG] Error processing image {url}: {e}")
            return None

    def extract_images_from_posts(self, posts):
        """Extract and download images from posts using offline_image_url"""
        images = []
        image_count = 0

        for post in posts:

            # Use offline_image_url instead of media_urls
            offline_url = post.get('offline_image_url')
            if not offline_url or not isinstance(offline_url, str):
                continue

            # Skip non-URL values (EXPIRED, BROKEN, etc.)
            if not offline_url.startswith('http'):
                continue

            # Download and process image
            image_data = self.download_and_process_image(offline_url)
            if image_data:
                post_images = [{
                    'data': image_data,
                    'url': offline_url,
                    'post_id': post.get('post_id', ''),
                    'platform': post.get('platform', '')
                }]
                image_count += 1

                # Small delay between downloads
                time.sleep(0.1)
            else:
                post_images = []

            if post_images:
                images.extend(post_images)

        print(f"  📸 Downloaded {len(images)} images from {len(posts)} posts")
        return images

    def read_and_create_batches_from_supabase(self, total_posts_limit=None):
        """Read unprocessed posts from database and create date-sorted batches"""
        print("📥 Loading unprocessed posts from database...")

        # Choose table based on v2 schema setting
        table_name = 'v2_social_media_posts' if USE_V2_SCHEMA else 'social_media_posts'
        print(f"📊 Using table: {table_name}")

        # Get total count first for progress tracking
        try:
            count_resp = (
                self.supabase
                  .table(table_name)
                  .select('id', count='exact')
                  .eq('processed_for_events', False)
                  .is_('event_processed_at', 'null')
                  .limit(1)
                  .execute()
            )
            total_count = count_resp.count or 0
            print(f"📄 Found {total_count:,} unprocessed posts")
        except Exception as e:
            print(f"⚠️  Could not get count: {e}")
            total_count = "unknown"

        all_rows = []
        page_size = 500  # Reduced from 1000 to prevent timeouts
        start = 0
        page_num = 1

        # Page through all unprocessed posts, sorted by timestamp (newest first)
        while True:
            # Check if we've reached the limit
            if total_posts_limit and len(all_rows) >= total_posts_limit:
                print(f"  🎯 Reached posts limit of {total_posts_limit}, stopping...")
                break

            # Adjust page size if we're near the limit
            current_page_size = page_size
            if total_posts_limit and (len(all_rows) + page_size) > total_posts_limit:
                current_page_size = total_posts_limit - len(all_rows)

            print(f"  📱 Loading page {page_num} (posts {start+1}-{start+current_page_size})...")
            resp = (
                self.supabase
                  .table(table_name)
                  .select(
                      'id, post_id, platform, author_handle, author_name, '
                      'content_text, post_timestamp, mentioned_users, hashtags, location, media_urls, offline_image_url'
                  )
                  .eq('processed_for_events', False)
                  .is_('event_processed_at', 'null')
                  .order('post_timestamp', desc=True)  # Sort by timestamp DESC (newest first)
                  .range(start, start + current_page_size - 1)
                  .execute()
            )
            rows = resp.data or []
            if not rows:
                break
            all_rows.extend(rows)
            print(f"    ✅ Loaded {len(rows)} posts from page {page_num}")
            start += current_page_size
            page_num += 1

        print(f"📥 Loaded {len(all_rows):,} total unprocessed posts")

        # Filter out posts without timestamps and ensure they're properly sorted
        print("🔍 Filtering and sorting posts by timestamp...")
        valid_rows = [r for r in all_rows if r.get('post_timestamp') is not None]

        if len(valid_rows) < len(all_rows):
            filtered_out = len(all_rows) - len(valid_rows)
            print(f"  ⚠️  Filtered out {filtered_out} posts without timestamps")

        # Sort again to ensure proper ordering across all pages (newest first)
        # This is important because Supabase pagination might not guarantee perfect order
        valid_rows.sort(key=lambda x: x['post_timestamp'], reverse=True)

        if valid_rows:
            newest_post = valid_rows[0]['post_timestamp']
            oldest_post = valid_rows[-1]['post_timestamp']
            print(f"  📅 Date range: {newest_post} (newest) to {oldest_post} (oldest)")

        # Create intelligent batches - posts sorted chronologically but limited by image count
        # This means posts from the same time period will be grouped, but batches stop when image limit is reached
        batches = []
        current_batch = []
        current_image_count = 0

        def count_images_in_post(post):
            """Count how many images a post has"""
            media_urls = post.get('media_urls', [])
            if not media_urls:
                return 0

            # Handle different media_urls formats
            if isinstance(media_urls, str):
                try:
                    media_urls = json.loads(media_urls)
                except:
                    media_urls = [media_urls] if media_urls else []
            elif not isinstance(media_urls, list):
                media_urls = []

            return len([url for url in media_urls if url and isinstance(url, str)])

        for post in valid_rows:
            post_image_count = count_images_in_post(post)

            # Check if adding this post would exceed limits
            would_exceed_posts = len(current_batch) >= POSTS_PER_BATCH

            # Start new batch if we would exceed limit (but only if current batch has posts)
            if current_batch and would_exceed_posts:
                batches.append(current_batch)
                current_batch = []
                current_image_count = 0

            # Add post to current batch
            current_batch.append(post)
            current_image_count += post_image_count

        # Add final batch if it has posts
        if current_batch:
            batches.append(current_batch)

        print(f"📦 Created {len(batches)} reverse-chronologically-ordered batches")
        print(f"   📝 Max posts per batch: {POSTS_PER_BATCH}")

        if batches:
            # Show date range for first and last batch to verify sorting
            first_batch = batches[0]
            last_batch = batches[-1]

            first_batch_start = first_batch[0]['post_timestamp']
            first_batch_end = first_batch[-1]['post_timestamp']

            last_batch_start = last_batch[0]['post_timestamp']
            last_batch_end = last_batch[-1]['post_timestamp']

            print(f"  🥇 First batch date range: {first_batch_start} to {first_batch_end}")
            print(f"  🥉 Last batch date range: {last_batch_start} to {last_batch_end}")
            print(f"  ✅ Posts are sorted newest-first for testing on richer recent data")

        return batches

    def estimate_tokens_for_post(self, post):
        """Estimate token count for a single post"""
        # Base post metadata tokens
        tokens = 50  # For metadata like platform, author, timestamp

        # Content text tokens (rough estimate: 1 token per 4 characters)
        content_text = post.get('content_text', '') or ''
        tokens += len(content_text) // 4

        # Additional tokens for hashtags, mentions, location
        hashtags = post.get('hashtags', []) or []
        mentioned_users = post.get('mentioned_users', []) or []
        location = post.get('location', '') or ''

        if isinstance(hashtags, str):
            hashtags = [hashtags] if hashtags else []
        if isinstance(mentioned_users, str):
            mentioned_users = [mentioned_users] if mentioned_users else []

        tokens += len(str(hashtags)) // 4
        tokens += len(str(mentioned_users)) // 4
        tokens += len(location) // 4

        return min(tokens, AVERAGE_TOKENS_PER_POST)  # Cap at configured average

    def estimate_tokens_for_batch(self, posts, images_count):
        """Estimate total token count for a batch"""
        # System prompt tokens
        total_tokens = SYSTEM_PROMPT_TOKENS

        # Post tokens
        for post in posts:
            total_tokens += self.estimate_tokens_for_post(post)

        # Image tokens
        total_tokens += images_count * AVERAGE_TOKENS_PER_IMAGE

        # Add buffer for response tokens
        total_tokens += 5000

        return total_tokens

    def count_images_in_post(self, post):
        """Count how many images a post has based on offline_image_url"""
        offline_url = post.get('offline_image_url')
        if not offline_url or not isinstance(offline_url, str):
            return 0

        # If it starts with http, it's a valid image URL
        if offline_url.startswith('http'):
            return 1

        # Otherwise, no downloadable images
        return 0

    def get_posts_for_processing(self, limit=None, filters=None):
        """
        Fetch posts for processing using direct SQL-like query with proper chronological ordering.
        Implements pagination to handle limits > 1000 (Supabase API limit).

        Args:
            limit: Maximum number of posts to fetch
            filters: Dictionary of filters to apply (for future use)
                - author_handles: List of author handles to filter by
                - date_range: Tuple of (start_date, end_date)
                - platforms: List of platforms to filter by

        Returns:
            List of posts sorted by post_timestamp DESC (newest first)
        """
        print("📥 Fetching posts for processing with direct query...")

        # Choose table based on v2 schema setting
        table_name = 'v2_social_media_posts' if USE_V2_SCHEMA else 'social_media_posts'
        print(f"📊 Using table: {table_name}")

        if limit:
            print(f"📋 Limiting to {limit} posts")

        # Collect all posts with pagination
        all_posts = []
        page_size = 500  # Reduced from 1000 to prevent timeouts
        start = 0
        page_num = 1

        while True:
            # Check if we've collected enough posts
            if limit and len(all_posts) >= limit:
                all_posts = all_posts[:limit]  # Trim to exact limit
                break

            # Adjust page size if we're near the limit
            current_page_size = page_size
            if limit and (len(all_posts) + page_size) > limit:
                current_page_size = limit - len(all_posts)

            print(f"  📱 Loading page {page_num} (posts {start+1}-{start+current_page_size})...")

            # Build query for this page
            query = self.supabase.table(table_name).select(
                'id, post_id, platform, author_handle, author_name, '
                'content_text, post_timestamp, mentioned_users, hashtags, location, media_urls, offline_image_url'
            )

            # Apply filters
            query = query.eq('processed_for_events', False)
            query = query.is_('event_processed_at', 'null')

            # Future filter support (not implemented yet)
            if filters:
                if 'author_handles' in filters and filters['author_handles']:
                    query = query.in_('author_handle', filters['author_handles'])
                if 'platforms' in filters and filters['platforms']:
                    query = query.in_('platform', filters['platforms'])
                if 'date_range' in filters and filters['date_range']:
                    start_date, end_date = filters['date_range']
                    if start_date:
                        query = query.gte('post_timestamp', start_date)
                    if end_date:
                        query = query.lte('post_timestamp', end_date)

            # Order by post_timestamp DESC to get newest posts first
            query = query.order('post_timestamp', desc=True)

            # Use range for pagination instead of limit
            query = query.range(start, start + current_page_size - 1)

            # Execute query with retry logic for timeouts
            max_retries = 3
            retry_count = 0
            
            while retry_count < max_retries:
                try:
                    result = query.execute()
                    posts = result.data or []

                    if not posts:
                        print(f"    ✅ No more posts found, stopping at page {page_num}")
                        break

                    all_posts.extend(posts)
                    print(f"    ✅ Loaded {len(posts)} posts from page {page_num}")

                    # If we got fewer posts than requested, we've reached the end
                    if len(posts) < current_page_size:
                        break

                    start += current_page_size
                    page_num += 1
                    break  # Success, exit retry loop

                except Exception as e:
                    retry_count += 1
                    error_msg = str(e)
                    error_dict = e.__dict__ if hasattr(e, '__dict__') else {}
                    
                    # Check for timeout errors
                    if ('timeout' in error_msg.lower() or 
                        'canceling statement' in error_msg.lower() or
                        '57014' in error_msg or
                        (isinstance(error_dict, dict) and error_dict.get('code') == '57014')):
                        
                        if retry_count < max_retries:
                            wait_time = retry_count * 2  # Exponential backoff
                            print(f"❌ Database timeout on page {page_num}, retrying in {wait_time}s... (attempt {retry_count}/{max_retries})")
                            time.sleep(wait_time)
                            continue
                        else:
                            print(f"❌ Database timeout after {max_retries} attempts on page {page_num}")
                            print(f"❌ Error details: {error_dict}")
                            print(f"ℹ️ Returning {len(all_posts)} posts fetched so far")
                            return all_posts  # Return what we have
                    else:
                        print(f"❌ Error fetching posts on page {page_num}: {e}")
                        break  # Exit both loops for non-timeout errors
            
            # If we exhausted retries, break the outer loop
            if retry_count >= max_retries:
                break

        # Final summary
        if all_posts:
            # Show date range of fetched posts
            newest_timestamp = all_posts[0]['post_timestamp']
            oldest_timestamp = all_posts[-1]['post_timestamp']
            print(f"✅ Fetched {len(all_posts)} posts total")
            print(f"📅 Date range: {newest_timestamp} (newest) to {oldest_timestamp} (oldest)")

            # Verify ordering
            for i in range(1, min(5, len(all_posts))):
                if all_posts[i-1]['post_timestamp'] < all_posts[i]['post_timestamp']:
                    print(f"⚠️ WARNING: Posts not in correct chronological order!")
                    break
        else:
            print("ℹ️ No unprocessed posts found")

        return all_posts

    def create_optimized_batches_from_supabase(self, total_posts_limit=None):
        """Create optimized batches with token-based sizing and date clustering"""
        print("📥 Loading unprocessed posts with optimized batching...")

        # Choose table based on v2 schema setting
        table_name = 'v2_social_media_posts' if USE_V2_SCHEMA else 'social_media_posts'
        print(f"📊 Using table: {table_name}")
        print(f"🧠 Token limits: {MAX_TOKENS_PER_BATCH:,} tokens max per batch")
        print(f"📝 Estimated tokens per post: {AVERAGE_TOKENS_PER_POST}")
        print(f"📸 Estimated tokens per image: {AVERAGE_TOKENS_PER_IMAGE:,}")
        print(f"📊 Max posts per batch: {MAX_POSTS_PER_BATCH}")

        # Get total count first for progress tracking
        try:
            count_resp = (
                self.supabase
                  .table(table_name)
                  .select('id', count='exact')
                  .eq('processed_for_events', False)
                  .is_('event_processed_at', 'null')
                  .limit(1)
                  .execute()
            )
            total_count = count_resp.count or 0
            print(f"📄 Found {total_count:,} unprocessed posts")
        except Exception as e:
            print(f"⚠️  Could not get count: {e}")
            total_count = "unknown"

        all_rows = []
        page_size = 500  # Reduced from 1000 to prevent timeouts
        start = 0
        page_num = 1

        # Page through all unprocessed posts, sorted by timestamp
        sort_order = 'desc' if PRIORITIZE_RECENT_POSTS else 'asc'
        print(f"📅 Sorting posts: {sort_order} (newest first: {PRIORITIZE_RECENT_POSTS})")

        while True:
            # Check if we've reached the limit
            if total_posts_limit and len(all_rows) >= total_posts_limit:
                print(f"  🎯 Reached posts limit of {total_posts_limit}, stopping...")
                break

            # Adjust page size if we're near the limit
            current_page_size = page_size
            if total_posts_limit and (len(all_rows) + page_size) > total_posts_limit:
                current_page_size = total_posts_limit - len(all_rows)

            print(f"  📱 Loading page {page_num} (posts {start+1}-{start+current_page_size})...")
            
            # Add retry logic for timeout errors
            max_retries = 3
            retry_count = 0
            
            while retry_count < max_retries:
                try:
                    resp = (
                        self.supabase
                          .table(table_name)
                          .select(
                              'id, post_id, platform, author_handle, author_name, '
                              'content_text, post_timestamp, mentioned_users, hashtags, location, media_urls, offline_image_url'
                          )
                          .eq('processed_for_events', False)
                          .is_('event_processed_at', 'null')
                          .order('post_timestamp', desc=(sort_order == 'desc'))
                          .range(start, start + current_page_size - 1)
                          .execute()
                    )
                    rows = resp.data or []
                    break  # Success, exit retry loop
                    
                except Exception as e:
                    retry_count += 1
                    error_msg = str(e)
                    if ('timeout' in error_msg.lower() or 
                        'canceling statement' in error_msg.lower() or
                        '57014' in error_msg):
                        if retry_count < max_retries:
                            wait_time = retry_count * 2  # Exponential backoff
                            print(f"    ⚠️ Database timeout on page {page_num}, retrying in {wait_time}s... (attempt {retry_count}/{max_retries})")
                            time.sleep(wait_time)
                            continue
                        else:
                            print(f"    ❌ Database timeout after {max_retries} attempts. Ending fetch.")
                            return all_rows  # Return what we have so far
                    else:
                        print(f"    ❌ Error fetching posts on page {page_num}: {error_msg}")
                        raise
            
            if not rows:
                break
            all_rows.extend(rows)
            print(f"    ✅ Loaded {len(rows)} posts from page {page_num}")
            start += current_page_size
            page_num += 1

        print(f"📥 Loaded {len(all_rows):,} total unprocessed posts")

        # Filter out posts without timestamps
        print("🔍 Filtering and sorting posts by timestamp...")
        valid_rows = [r for r in all_rows if r.get('post_timestamp') is not None]

        if len(valid_rows) < len(all_rows):
            filtered_out = len(all_rows) - len(valid_rows)
            print(f"  ⚠️  Filtered out {filtered_out} posts without timestamps")

        if valid_rows:
            newest_post = valid_rows[0]['post_timestamp']
            oldest_post = valid_rows[-1]['post_timestamp']
            print(f"  📅 Date range: {newest_post} to {oldest_post}")

        # Create intelligent batches with token-based sizing and date clustering
        batches = []

        if DATE_CLUSTERING_ENABLED:
            batches = self.create_date_clustered_batches(valid_rows)
        else:
            batches = self.create_token_optimized_batches(valid_rows)

        print(f"📦 Created {len(batches)} optimized batches")
        if batches:
            avg_posts = sum(len(batch) for batch in batches) / len(batches)
            avg_tokens = sum(self.estimate_tokens_for_batch(batch, self.count_images_in_batch(batch)) for batch in batches) / len(batches)
            print(f"   📊 Average posts per batch: {avg_posts:.1f}")
            print(f"   🧠 Average tokens per batch: {avg_tokens:,.0f}")

        return batches

    def count_images_in_batch(self, batch):
        """Count total images in a batch of posts"""
        total_images = 0
        for post in batch:
            total_images += self.count_images_in_post(post)
        return total_images

    def create_token_optimized_batches(self, posts):
        """Create batches optimized for token limits without date clustering"""
        batches = []
        current_batch = []
        current_tokens = SYSTEM_PROMPT_TOKENS
        current_images = 0

        for post in posts:
            post_tokens = self.estimate_tokens_for_post(post)
            post_images = self.count_images_in_post(post)

            # Calculate what tokens would be with this post added
            batch_tokens_with_post = current_tokens + post_tokens + (post_images * AVERAGE_TOKENS_PER_IMAGE)

            # Check if we need to start a new batch
            would_exceed_tokens = batch_tokens_with_post > MAX_TOKENS_PER_BATCH
            would_exceed_posts = len(current_batch) >= MAX_POSTS_PER_BATCH

            if current_batch and (would_exceed_tokens or would_exceed_posts):
                batches.append(current_batch)
                current_batch = []
                current_tokens = SYSTEM_PROMPT_TOKENS
                current_images = 0

            # Add post to current batch
            current_batch.append(post)
            current_tokens += post_tokens + (post_images * AVERAGE_TOKENS_PER_IMAGE)
            current_images += post_images

        # Add final batch if it has posts
        if current_batch:
            batches.append(current_batch)

        return batches

    def create_chronological_batches(self, posts):
        """
        Create batches that intelligently group related posts while respecting token limits.

        Strategy:
        1. Maximum 500k tokens per batch (half of Gemini's limit)
        2. Group posts that are likely related (same author, close time proximity, similar content)
        3. Maintain chronological order but allow smaller batches to keep related posts together
        """
        from datetime import datetime
        import re

        batches = []
        print(f"📊 Creating intelligent batches with token limit: {MAX_TOKENS_PER_BATCH:,} tokens")
        print(f"   📝 Post tokens: {AVERAGE_TOKENS_PER_POST}, Image tokens: {AVERAGE_TOKENS_PER_IMAGE}")

        # Group posts by author and time proximity
        post_groups = self._group_related_posts(posts)

        # Create batches from groups
        current_batch = []
        current_tokens = SYSTEM_PROMPT_TOKENS
        current_images = 0

        for group in post_groups:
            group_tokens = SYSTEM_PROMPT_TOKENS  # Reset for group calculation
            group_images = 0

            # Calculate total tokens for this group
            for post in group:
                group_tokens += self.estimate_tokens_for_post(post)
                post_images = self.count_images_in_post(post)
                group_images += post_images
                group_tokens += post_images * AVERAGE_TOKENS_PER_IMAGE

            # Check if adding this entire group would exceed limits
            batch_tokens_with_group = current_tokens + group_tokens - SYSTEM_PROMPT_TOKENS  # Don't double count system prompt

            if current_batch and batch_tokens_with_group > MAX_TOKENS_PER_BATCH:
                # Can't fit entire group, start new batch
                batches.append(current_batch)
                print(f"   📦 Batch created with {len(current_batch)} posts ({current_tokens:,} tokens)")
                current_batch = []
                current_tokens = SYSTEM_PROMPT_TOKENS
                current_images = 0

            # Add group to current batch
            for post in group:
                post_tokens = self.estimate_tokens_for_post(post)
                post_images = self.count_images_in_post(post)

                current_batch.append(post)
                current_tokens += post_tokens + (post_images * AVERAGE_TOKENS_PER_IMAGE)
                current_images += post_images

        # Add final batch
        if current_batch:
            batches.append(current_batch)
            print(f"   📦 Final batch created with {len(current_batch)} posts ({current_tokens:,} tokens)")

        # Log batch statistics
        if batches:
            self._log_batch_statistics(batches)

        return batches

    def _group_related_posts(self, posts):
        """
        Group posts prioritizing:
        1. Keep complete days together when possible
        2. Group posts from same author within a day
        3. Respect token limits
        """
        from datetime import datetime, timedelta

        # First, group posts by date
        posts_by_date = defaultdict(list)

        for post in posts:
            timestamp_str = post.get('post_timestamp', '')
            try:
                timestamp = datetime.fromisoformat(timestamp_str.replace('+00:00', '+00:00'))
                date_key = timestamp.date()
                posts_by_date[date_key].append(post)
            except:
                # If can't parse timestamp, add to a special group
                posts_by_date['unknown'].append(post)

        # Sort dates to maintain chronological order
        sorted_dates = sorted([d for d in posts_by_date.keys() if d != 'unknown'], reverse=True)
        if 'unknown' in posts_by_date:
            sorted_dates.append('unknown')

        print(f"📅 Posts span {len(sorted_dates)} unique dates")

        # Now create groups trying to keep full days together
        groups = []
        current_batch_posts = []
        current_batch_tokens = SYSTEM_PROMPT_TOKENS
        current_batch_dates = []

        for date in sorted_dates:
            day_posts = posts_by_date[date]

            # Calculate tokens for this entire day
            day_tokens = 0
            for post in day_posts:
                day_tokens += self.estimate_tokens_for_post(post)
                day_tokens += self.count_images_in_post(post) * AVERAGE_TOKENS_PER_IMAGE

            # Check if adding this entire day would exceed limits
            if current_batch_posts and (current_batch_tokens + day_tokens > MAX_TOKENS_PER_BATCH * 0.9):
                # Can't fit entire day, start new batch
                groups.extend(self._split_into_groups(current_batch_posts))
                print(f"   📦 Batch created covering dates: {current_batch_dates[0]} to {current_batch_dates[-1]} ({len(current_batch_posts)} posts, ~{current_batch_tokens:,} tokens)")
                current_batch_posts = []
                current_batch_tokens = SYSTEM_PROMPT_TOKENS
                current_batch_dates = []

            # Add this day to current batch
            current_batch_posts.extend(day_posts)
            current_batch_tokens += day_tokens
            if date != 'unknown':
                current_batch_dates.append(date)

            # If this single day is too large, it needs to be split
            if day_tokens > MAX_TOKENS_PER_BATCH * 0.9:
                print(f"   ⚠️ Date {date} has {len(day_posts)} posts (~{day_tokens:,} tokens) - will be split into multiple groups")

        # Add final batch
        if current_batch_posts:
            groups.extend(self._split_into_groups(current_batch_posts))
            if current_batch_dates:
                print(f"   📦 Final batch covering dates: {current_batch_dates[0]} to {current_batch_dates[-1]} ({len(current_batch_posts)} posts, ~{current_batch_tokens:,} tokens)")

        print(f"📊 Created {len(groups)} groups from {len(posts)} posts")
        print(f"   Group sizes: min={min(len(g) for g in groups)}, max={max(len(g) for g in groups)}, avg={len(posts)/len(groups):.1f}")

        return groups

    def _split_into_groups(self, posts):
        """Split posts into groups by author while respecting token limits"""
        # Group by author within this set of posts
        posts_by_author = defaultdict(list)
        for post in posts:
            author = post.get('author_handle', 'unknown')
            posts_by_author[author].append(post)

        # Create groups keeping same-author posts together
        groups = []
        current_group = []
        current_tokens = 0

        for author, author_posts in posts_by_author.items():
            for post in author_posts:
                post_tokens = self.estimate_tokens_for_post(post)
                post_tokens += self.count_images_in_post(post) * AVERAGE_TOKENS_PER_IMAGE

                if current_group and current_tokens + post_tokens > MAX_TOKENS_PER_BATCH * 0.8:
                    groups.append(current_group)
                    current_group = []
                    current_tokens = 0

                current_group.append(post)
                current_tokens += post_tokens

        if current_group:
            groups.append(current_group)

        return groups

    def _log_batch_statistics(self, batches):
        """Log detailed statistics about the created batches"""
        total_posts = sum(len(batch) for batch in batches)

        print(f"\n📊 Batch Statistics:")
        print(f"   - Total batches: {len(batches)}")
        print(f"   - Total posts: {total_posts}")
        print(f"   - Posts per batch: min={min(len(b) for b in batches)}, max={max(len(b) for b in batches)}, avg={total_posts/len(batches):.1f}")

        # Calculate tokens per batch
        token_counts = []
        for batch in batches:
            tokens = SYSTEM_PROMPT_TOKENS
            for post in batch:
                tokens += self.estimate_tokens_for_post(post)
                tokens += self.count_images_in_post(post) * AVERAGE_TOKENS_PER_IMAGE
            token_counts.append(tokens)

        print(f"   - Tokens per batch: min={min(token_counts):,}, max={max(token_counts):,}, avg={sum(token_counts)/len(token_counts):,.0f}")
        print(f"   - Token utilization: {(sum(token_counts)/len(token_counts))/MAX_TOKENS_PER_BATCH*100:.1f}% of limit")

        # Show first few batches
        for i, batch in enumerate(batches[:5]):
            if batch:
                newest = batch[0]['post_timestamp']
                oldest = batch[-1]['post_timestamp']
                authors = set(p.get('author_handle', 'unknown') for p in batch)
                print(f"\n   Batch {i+1}:")
                print(f"      Posts: {len(batch)}, Tokens: ~{token_counts[i]:,}")
                print(f"      Date range: {newest[:16]} to {oldest[:16]}")
                print(f"      Authors: {', '.join(list(authors)[:3])}{'...' if len(authors) > 3 else ''}")

    def create_date_clustered_batches(self, posts):
        """Create batches with date clustering for better event detection"""
        from datetime import datetime, timedelta
        import pandas as pd

        batches = []

        # Convert post timestamps to datetime objects and sort
        posts_with_dt = []
        for post in posts:
            try:
                if isinstance(post['post_timestamp'], str):
                    dt = pd.to_datetime(post['post_timestamp'])
                else:
                    dt = post['post_timestamp']
                posts_with_dt.append((post, dt))
            except:
                # Skip posts with invalid timestamps
                continue

        # Sort by timestamp (newest or oldest first based on config)
        posts_with_dt.sort(key=lambda x: x[1], reverse=PRIORITIZE_RECENT_POSTS)

        i = 0
        while i < len(posts_with_dt):
            current_batch = []
            current_tokens = SYSTEM_PROMPT_TOKENS
            current_images = 0
            batch_start_date = posts_with_dt[i][1]

            # Build batch within date range and token limits
            j = i
            while j < len(posts_with_dt):
                post, post_dt = posts_with_dt[j]

                # Check date range
                date_diff = abs((post_dt - batch_start_date).days)
                if DATE_CLUSTERING_ENABLED and date_diff > MAX_DATE_RANGE_DAYS:
                    break

                # Check token and size limits
                post_tokens = self.estimate_tokens_for_post(post)
                post_images = self.count_images_in_post(post)

                batch_tokens_with_post = current_tokens + post_tokens + (post_images * AVERAGE_TOKENS_PER_IMAGE)

                would_exceed_tokens = batch_tokens_with_post > MAX_TOKENS_PER_BATCH
                would_exceed_posts = len(current_batch) >= MAX_POSTS_PER_BATCH

                if current_batch and (would_exceed_tokens or would_exceed_posts):
                    break

                # Add post to batch
                current_batch.append(post)
                current_tokens += post_tokens + (post_images * AVERAGE_TOKENS_PER_IMAGE)
                current_images += post_images
                j += 1

            if current_batch:
                batches.append(current_batch)

            i = j if j > i else i + 1  # Ensure we make progress

        return batches

    def mark_posts_as_processed(self, post_uuids):
        """Mark posts as processed with retry logic and batching to avoid URL length limits"""
        try:
            if not post_uuids:
                return

            print(f"  📝 Marking {len(post_uuids)} posts as processed...")

            # Choose table based on v2 schema setting
            table_name = 'v2_social_media_posts' if USE_V2_SCHEMA else 'social_media_posts'

            # Batch updates to avoid URL length limits
            batch_size = 100  # Conservative batch size to avoid URL length issues
            total_marked = 0

            for i in range(0, len(post_uuids), batch_size):
                batch = post_uuids[i:i + batch_size]
                batch_num = (i // batch_size) + 1
                total_batches = (len(post_uuids) + batch_size - 1) // batch_size

                if total_batches > 1:
                    print(f"    📦 Processing batch {batch_num}/{total_batches} ({len(batch)} posts)...")

                def update_batch():
                    return self.supabase.table(table_name).update({
                        'processed_for_events': True,
                        'event_processed_at': datetime.now(timezone.utc).isoformat()
                    }).in_('id', batch).execute()

                try:
                    result = self.database_operation_with_retry(
                        update_batch,
                        f"Mark batch {batch_num} ({len(batch)} posts) as processed"
                    )

                    if result.data:
                        total_marked += len(result.data)

                except Exception as e:
                    print(f"    ❌ Error marking batch {batch_num} as processed: {str(e)}")
                    # Continue with other batches even if one fails
                    continue

            print(f"  ✅ Marked {total_marked}/{len(post_uuids)} posts as processed")

        except Exception as e:
            print(f"  ❌ Error marking posts as processed: {str(e)}")

    def build_system_prompt_with_tools(self, allowed_tags, tag_rules):
        """Build prompt with static rules but dynamic context via function tools"""
        if DEBUG:
            print(f"[DEBUG] Building tool-based system prompt with {len(allowed_tags)} tags")
        
        tag_list_str = ", ".join(f'"{tag}"' for tag in allowed_tags)
        tag_rules_str = "\n".join([f'- **{tag}**: {tag_rules.get(tag, "No description")}' for tag in allowed_tags])
        
        # Tool usage instructions
        tool_instructions = """
DYNAMIC CONTEXT RETRIEVAL:

Instead of having all actor bios and existing slugs embedded in this prompt, you have access to tools to retrieve this information on-demand:

1. **search_actors**: Look up any actor/handle to get their biographical information
   - Use this for EVERY handle you see (author_handle, mentioned_users, or in post content)
   - Returns: full name, role, affiliations, location, about text, usernames
   - Batch multiple actors in one call for efficiency
   - This replaces the "ACTOR BIOGRAPHICAL INFORMATION" section

2. **search_dynamic_slugs**: Find existing dynamic slugs before creating new ones
   - Search for School, Church, Election, LobbyingTopic, BallotMeasure, Conference slugs
   - Shows ALL variations across ALL parent_tags
   - Returns grouped results showing which parent_tags already have this slug
   - If NO results are returned, you should CREATE a new slug by including it in CategoryTags
   - This replaces the "EXISTING DYNAMIC SLUGS" section

3. **link_posts_to_existing_event**: Link posts to an existing event if you identify a duplicate
   - Use this sparingly - only for obvious duplicates you can identify from context
   - Event deduplication is primarily handled by a separate automated script
   - Focus on extracting new events from posts

REQUIRED WORKFLOW:
1. First, search for all actors mentioned in the batch
2. Extract events from the posts with all relevant details
3. Only use link_posts_to_existing_event if you're certain it's a duplicate from the post content itself
4. Use INTELLIGENT REASONING for duplicates:
   - "ASU Professor Frames Event" = "Arizona State University Professor Event" (clear match)
   - "Trump Rally Phoenix May 28" = "President Trump Rally in Phoenix May 28" (same event)
   - But "Voter Registration Drive ASU" ≠ "Voter Registration Drive U of A" (different schools)
5. When confident about a duplicate:
   - Link posts to the existing event
   - Explain your reasoning clearly
6. When uncertain:
   - Err on the side of creating a new event
   - Similar names alone aren't enough without matching dates/locations
7. Search for dynamic slugs before creating new ones
8. Output only truly NEW events in the JSON format
"""
        
        # Return the complete prompt without embedded context
        return """
You are an expert data extraction assistant focused on tracking real-world, in-person political and organizational activities of Turning Point USA and its affiliates. Your job is to accurately scrape and structure data from social media posts to support researchers. The primary research goals are to map TPUSA's youth-to-staff pipeline, document their field activities (who, what, where, when), identify which electoral races they are involved in, and understand how they use public conflicts to mobilize supporters and influence institutions.

{tool_instructions}

A post must pass this gate or it is discarded.


GATE (Activity Gate)
The content describes one or more of the following real-world activities:

High-Priority Electioneering: Any form of direct voter or citizen engagement. This includes canvassing, door-knocking, signature gathering, phone banking, or voter registration drives. Crucially, this includes informal descriptions. A post saying "out talking with Moms about the Mesa Recall" or "hitting the pavement for the campaign" IS a valid canvassing event.

Organized Gatherings: A scheduled or completed in-person event/activity such as a rally, training session, chapter meeting, conference, or tabling on campus. Anything in person activity. 

Official Engagements & Public Conflict:
- An actor in an official capacity testifies at or attends a government meeting (e.g., school board, city council).
- A significant public conflict where an actor in an official capacity is a principal organizer, instigator, or direct target of controversy or institutional sanction (e.g., chapter de-recognition, event cancellation). Casual media hot-takes, podcast interviews, or Fox News spots are not controversies.

Official Digital Programming: Coordinated virtual events with a defined goal run by an official organization (e.g., PragerU virtual lesson launch).

WHEN IN DOUBT, DO NOT EXTRACT: Your default action should be to ignore a post. Only extract an event if it unambiguously meets the criteria. An empty output {{ "events": [] }} is a perfectly valid and often correct response.

CRITICAL INSTRUCTIONS:

REAL-WORLD EVENTS ONLY: Extract only actual, physical gatherings or organized activities. IGNORE general political commentary, online arguments, or simple media appearances (TV, podcasts).

CONFIDENCE SCORE NUANCE (Official vs. Social Capacity): You MUST adjust the ConfidenceScore based on the actor's role.
- High Confidence (0.9-1.0): The actor is clearly participating in an official capacity for their organization (e.g., a TPUSA Field Rep running a TPUSA canvassing event, a chapter hosting a speaker). The event aligns with the organization's mission.
- Lower Confidence (0.3-0.7): An affiliated actor is present at a political or social event, but it's unclear if they are acting in their official capacity. For example, a known TPUSA staffer attends a rally organized by a different, unaffiliated group. In this case, you should still extract the event but use a lower score to flag the ambiguity. If it is, for example, a TPUSA staffer at a social event with no clear mention of their professional capacity, it should be even lower. 

MAINSTREAM NEWS EVENT PENALTY (IMPORTANT): 
- Downgrade confidence (multiply by 0.7) for events that would be mainstream news:
  * ANY event primarily about Trump administration activities or appointments  
  * High-profile political figures at major venues (Trump at Mar-a-Lago, DeSantis at state events)
  * Celebrity appearances or endorsements
  * Major campaign rallies covered by national media
  * White House events, Congressional hearings, or federal government activities
  * Any "Trump welcomes X" or "Trump appoints Y" type events
  
- EXCEPTION: Conferences organized BY affiliated actors (AmericaFest, Student Action Summit, etc.) maintain normal confidence
  
- BOOST confidence (multiply by 1.2, cap at 1.0) for grassroots activities:
  * Field representatives meeting with local churches or community groups
  * Youth groups organizing local events  
  * School board testimonies by parents or local activists
  * Door-to-door canvassing in neighborhoods
  * Small-scale voter registration at local venues
  * Chapter meetings at schools
  * Local activists training sessions
  
- The more LOCAL and GRASSROOTS the activity, the HIGHER the confidence
- The more NATIONAL NEWS WORTHY, the LOWER the confidence
- Ask yourself: "Is this about Trump administration news?" If yes, multiply confidence by 0.7
- Ask yourself: "Would CNN/Fox News cover this?" If yes, multiply confidence by 0.7
- Ask yourself: "Is this hyperlocal organizing work?" If yes, multiply confidence by 1.2 (cap at 1.0)

CANVASSING & ELECTIONEERING PRIORITY (CRITICAL): This is the highest priority activity. These events CANNOT be missed.
- Recognize Informal Activity: Posts do not need to announce a formal event. Photographic evidence of door-knocking (e.g., people with clipboards, wearing campaign shirts at a door) or descriptive text like "Just a couple of Moms out here in Mesa talking with other Moms about the Mesa Recall" are sufficient proof of a canvassing event. Treat these as valid events.
- Assume Separate Events: Electioneering happens frequently. Posts on different days are ALWAYS separate events. Posts on the same day but mentioning different locations or actors should also be treated as separate events. When in doubt, create a separate entry.
- Date Inference: For canvassing, the date of the event is the date the post was made, unless the post is explicitly promoting a future event with a specific date.

ONE ROW PER UNIQUE EVENT: Each unique occurrence (defined by activity, date, and location) gets its own row. If an event series occurs over multiple days, each day is a unique event.

SEPARATE MULTI-STATE EVENTS: If a single announcement promotes activity in multiple states/locations, create a SEPARATE event entry for EACH location.

INTELLIGENT DATE RESOLUTION: If no exact date is in the text, infer the month and year from the post timestamp and set the day to "01", unless Rule #3 (Canvassing) applies.

DYNAMIC SLUG CREATION: You MUST generate a dynamic slug for certain activities. 
IMPORTANT: Use the search_dynamic_slugs tool to check for existing slugs first.
- If a matching slug exists (even under a different parent_tag), use the existing one with the CORRECT parent_tag
- If NO matching slug exists, CREATE A NEW ONE by including it in CategoryTags

NAMING CONVENTIONS (follow these exactly):
- Elections: Election:[State]_[Office]_[Candidate]_[Year] (e.g., Election:AZ_Senate_Kari_Lake_2024)
  * Without candidate: Election:[State]_[Office]_[Year] (do NOT add "_General" - it's redundant)
  * Special elections: add "_Special" (e.g., Election:PA_House_District_35_Special_2025)
  * Recalls: add "_Recall" (e.g., Election:AZ_Mesa_City_Council_Recall_2025)
- Ballot Measures: BallotMeasure:[State]_Prop[Number]_[Topic]_[Year] (e.g., BallotMeasure:AZ_Prop139_Abortion_2024)
- Schools: School:[State]_[SchoolName] or School:[State]_[District]_[Topic] (e.g., School:AZ_University_of_Arizona, School:CA_LAUSD_Board_Election)
- Churches: Church:[Name]_[City]_[State] (e.g., Church:Calvary_Chapel_Chino_Hills_CA)
- Conferences: Conference:[Name]_[Year]_[Location] (e.g., Conference:TPUSA_AmFest_2024_Phoenix)
- LobbyingTopic: LobbyingTopic:[Topic] (e.g., LobbyingTopic:abortion_rights, LobbyingTopic:school_choice)

MANDATORY TAG COMBINATIONS:
- If any event is at a school, you MUST include a School:[State]_[SchoolName] slug.
- If any event is at a church, you MUST include a Church:[Name]_[City]_[State] slug.
- If any Lobbying tag is used, you MUST also include a LobbyingTopic:[Topic] slug.

LOBBYING SCOPE:
- Lobbying: Applies to direct, formal interactions with government bodies (testifying at a school board, meeting with a legislator). A post that is an official, coordinated call to action from an affiliated organization for its members to contact officials or attend a public meeting (e.g., "Call your reps about Bill XYZ!", "Show up to the school board meeting on Tuesday to testify!") also qualifies and should be tagged Lobbying. An individual's unsolicited complaint to a politician is NOT lobbying.

### CONTROVERSY SCOPE  

1. **Define "Controversy."**  
   Extract **only** incidents where an affiliated actor's *real-world* action, decision, or official statement sparks public dispute **or** where the actor claims institutional suppression (e.g., de-recognition, event cancellation, disciplinary hearing, subpoena, lawsuit).

2. **Include Actor-Instigated Misconduct.**  
   Capture cases where a TPUSA-affiliated actor is the **instigator/perpetrator** of harassment, violence, threats, or other illicit conduct (e.g., assaulting a professor, doxxing protestors). These cases receive their own **Critical** tier (below).

3. **Ignore "Frivolous" Posts by Default.**  
   - A single tweet, Substack rant, or media clip with **no** coordinated call-to-action, **no** institutional response, and **no** offline consequence **is frivolous**.  
   - Still extract **if** both gates pass, but classify it as **Low-Severity** so it receives a low `ConfidenceScore`.

4. **Severity Tiers (used only for scoring).**

| Tier | Triggering Conditions | Example | **SeverityWeight** |
|------|----------------------|---------|--------------------|
| **Critical** | Affiliated actor **initiates** harassment, violence, credible threat, or other criminal/misconduct action | TPUSA staffer assaults professor during protest; or an actor doxxes a "woke" professor and urgest people to contact his employer | **1.1** |
| **High**   | Documented institutional action *or* offline consequence (resignation, policy change, cancelled speech, lawsuit filing, formal investigation, police report) **AND** the affiliated actor is the principal organizer/target | Chapter mobilizes parents; superintendent resigns | **1.0** |
| **Medium** | Coordinated public campaign, organized protest, or press conference targeting an institution **but** no confirmed institutional action (yet) | TPUSA field rep launches petition; large turnout at board meeting | **0.8** |
| **Low**    | Online outrage only (tweet thread, Substack post, podcast clip) **without** evidence of coordination or institutional response | Staffer tweets screenshot of "woke" email | **0.4** |

5. **ConfidenceScore Calculation (Controversy Events).**
BaseScore = 1.0 if actor clearly in official capacity, else 0.7
ConfidenceScore = BaseScore × SeverityWeight
*Examples:*  
- High-severity + official actor ⇒ **1.0**  
- Low-severity + unclear capacity ⇒ **0.28** (round to one decimal place → **0.3**)
6. **Tag Usage.**  
   Always apply the single tag **`Controversy`**. Use `ConfidenceScore` for seriousness ranking—no extra tags needed.
7. **Justification Must Note Severity.**  
   In the `Justification` field, explicitly state the detected severity tier and why (e.g., "High-severity: board opened investigation; actor led protest").
8. Instances of actors engaging with school boards directly are priority to notice!! 

PARTICIPANTS FIELD: Extract every individual or organization named. List all by their formal/display names, comma-separated. Do NOT include @handles.

HANDLE FIELDS (InstagramHandles, TwitterHandles): Be EXHAUSTIVE. List ALL handles (without @) from the post author and any mentioned users. Missing handles are a critical error.

ANNOUNCEMENTS VS. ACTUALS: If you see a post announcing an event AND a post showing the event happened within the same batch, combine them into a single event entry with all SourceIDs.
 a) **but** always track annoucements that indiate a new program or important news about one of the actors, (like tpusa high school chapters changing their name, or the launch of a new chase the vote program)
 b) general campaign annoucements must be made OFFICIALLY - not just "lets do this sometime!" as a tweet - it has to be a formal annoucement on behalf of an actors affiliated organizations. 

SMART CITY INFERENCE: If a state is named but not a city, use the fallback ladder to infer a city and note the reasoning in the Justification.
a) Venue clues in text.
b) Primary actor's home base from bio (use search_actors tool).
c) Largest city in the state/region.
d) City from another event in the same batch (same actors/date).
e) For Legislative Districts, use the largest city within that district.

SCHOOL CHAPTER HANDLE RULE: If a handle clearly represents a school chapter (@tpusa_asu, @tpusa_lakewoodhs), you MUST add the correct education-level tag (College, High School, Homeschool) AND a matching Institution:<School_Name> slug (unless it is a large multi-chapter conference).

CALENDAR POSTS: some posts with a url like https://calendar.example.com/event/https://nau.campuslabs.com/engage/event/11270387 or other non normal urls can be assumed to be ical events added to the dataset and can be assumed to be events at the date they are posted (happening at the date posted exactly)


FIELD-SPECIFIC INSTRUCTIONS:
- Date: "YYYY-MM-DD".
- EventName: A concise, descriptive name for the event.
- EventDescription: A detailed 2–4 sentences of what/how/why.
- CategoryTags: A JSON list of strings. Choose from the allowed tags and generate required slugs.
- Location, City, State: Extract as precisely as possible.
- Participants: A single string of ALL formal/display names, comma-separated.
- ConfidenceScore: 0.0–1.0. Adhere to Rule #2.
- Justification: Briefly explain your reasoning. Your justification MUST explicitly state the connection to TPUSA or its affiliates (e.g., "Event was attended by TPUSA Field Rep Laci Williams," or "Controversy tag applied because TPUSA is framing the event cancellation as a free speech violation"). If you cannot establish this link, do not extract the event.
- SourceIDs: A JSON list of the database UUID values (NOT post_id) for all posts that refer to this event. Use the UUID values provided in the post metadata, not the post_id field.
- InstagramHandles & TwitterHandles: ALL handles (without @) from EVERY post - include the author handle AND ALL mentioned users. Be EXHAUSTIVE - missing handles means missing actor links!

CATEGORY TAG DEFINITIONS:
{tag_rules_str}

ALLOWED CATEGORY TAGS:
[{tag_list_str}]


FINAL INSTRUCTION FOR THE MODEL:
After you have finished using all necessary tools, your final response MUST be a single, valid JSON object. For best results, enclose this JSON object in a markdown code block like so:
```json
{{
  "events": [
    // ... your extracted events here ...
  ]
}}
```
Do NOT include any other text, conversation, or explanations before or after the JSON block in your final answer.

""".format(
            tool_instructions=tool_instructions,
            tag_rules_str=tag_rules_str,
            tag_list_str=tag_list_str,
        )

    def build_system_prompt(self, allowed_tags, tag_rules, actor_bio):
        """Build enhanced system prompt with hierarchical categories and existing slugs"""
        if DEBUG:
            print(f"[DEBUG] Building system prompt with {len(allowed_tags)} tags and {len(actor_bio)} actors")

        tag_list_str = ", ".join(f'"{tag}"' for tag in allowed_tags)
        tag_rules_str = "\n".join([f'- **{tag}**: {tag_rules.get(tag, "No description")}' for tag in allowed_tags])

        # Format existing slugs for AI
        existing_slugs_str = ""
        if self.slug_manager.existing_slugs:
            existing_slugs_str = "\n**EXISTING DYNAMIC SLUGS (Use these before creating new ones):**\n"
            for parent, slugs in self.slug_manager.existing_slugs.items():
                # Limit to most recent/common ones to keep prompt manageable
                recent_slugs = slugs[:8]  # Only show 8 most recent
                existing_slugs_str += f"- **{parent}**: {', '.join(recent_slugs)}\n"

        actor_bio_str = ""
        if actor_bio:
            actor_bio_str = "\n**ACTOR BIOGRAPHICAL INFORMATION:**\n"
            actor_bio_str += "Here is background information about actors who authored posts in this batch:\n\n"
            for name, info in actor_bio.items():
                if DEBUG:
                    print(f"[DEBUG] Processing actor {name}: {info.get('type', 'unknown_type')}")

                if info.get('type') == 'person':
                    actor_bio_str += f"- **{info.get('full_name', name)}**: {info.get('primary_role', 'N/A')}\n"
                    if info.get('organizations'):
                        actor_bio_str += f"  Organizations: {'; '.join(info.get('organizations', []))}\n"
                    location = info.get('location') or f"{info.get('city', '')}, {info.get('state', '')}".strip(', ')
                    if location:
                        actor_bio_str += f"  Location: {location}\n"
                    if info.get('usernames'):
                        actor_bio_str += f"  Handles: {', '.join(info.get('usernames', []))}\n"
                    about_text = info.get('about')
                    if about_text:
                        if len(about_text) > 200:
                            about_text = about_text[:200] + "..."
                        actor_bio_str += f"  About: {about_text}\n"
                elif info.get('type') == 'chapter':
                    actor_bio_str += f"- **{info.get('name', name)}** (Chapter)\n"
                    location = info.get('location') or f"{info.get('city', '')}, {info.get('state', '')}".strip(', ')
                    if location:
                        actor_bio_str += f"  Location: {location}\n"
                    if info.get('about'):
                        actor_bio_str += f"  About: {info.get('about')}\n"
                    if info.get('usernames'):
                        actor_bio_str += f"  Handles: {', '.join(info.get('usernames', []))}\n"
                elif info.get('type') == 'organization':
                    actor_bio_str += f"- **{info.get('name', name)}** (Organization)\n"
                    if info.get('about'):
                        actor_bio_str += f"  About: {info.get('about')}\n"
                    location = info.get('location')
                    if location:
                        actor_bio_str += f"  Location: {location}\n"
                    if info.get('usernames'):
                        actor_bio_str += f"  Handles: {', '.join(info.get('usernames', []))}\n"
                elif info.get('type') == 'unknown':
                    actor_bio_str += f"- **{info.get('display_name', name)}** (Unknown Actor Handle: @{name})\n"
                    bio_text = info.get('bio') or 'N/A'
                    if bio_text != 'N/A' and len(bio_text) > 200:
                        bio_text = bio_text[:200] + "..."
                    actor_bio_str += f"  Bio: {bio_text}\n"
                    actor_bio_str += f"  Location: {info.get('location') or 'N/A'}\n"

                actor_bio_str += "\n"

        if DEBUG:
            print(f"[DEBUG] System prompt built successfully, total length: {len(actor_bio_str)} chars for actor bio")

        # Return the complete enhanced system prompt
        return """
You are an expert data extraction assistant focused on tracking real-world, in-person political and organizational activities of Turning Point USA and its affiliates. Your job is to accurately scrape and structure data from social media posts to support researchers. The primary research goals are to map TPUSA's youth-to-staff pipeline, document their field activities (who, what, where, when), identify which electoral races they are involved in, and understand how they use public conflicts to mobilize supporters and influence institutions.

A post must pass this gate or it is discarded.


GATE (Activity Gate)
The content describes one or more of the following real-world activities:

High-Priority Electioneering: Any form of direct voter or citizen engagement. This includes canvassing, door-knocking, signature gathering, phone banking, or voter registration drives. Crucially, this includes informal descriptions. A post saying "out talking with Moms about the Mesa Recall" or "hitting the pavement for the campaign" IS a valid canvassing event.

Organized Gatherings: A scheduled or completed in-person event/activity such as a rally, training session, chapter meeting, conference, or tabling on campus. Anything in person activity. 

Official Engagements & Public Conflict:
- An actor in an official capacity testifies at or attends a government meeting (e.g., school board, city council).
- A significant public conflict where an actor in an official capacity is a principal organizer, instigator, or direct target of controversy or institutional sanction (e.g., chapter de-recognition, event cancellation). Casual media hot-takes, podcast interviews, or Fox News spots are not controversies.

Official Digital Programming: Coordinated virtual events with a defined goal run by an official organization (e.g., PragerU virtual lesson launch).

WHEN IN DOUBT, DO NOT EXTRACT: Your default action should be to ignore a post. Only extract an event if it unambiguously meets the criteria. An empty output {{ "events": [] }} is a perfectly valid and often correct response.

CRITICAL INSTRUCTIONS:

REAL-WORLD EVENTS ONLY: Extract only actual, physical gatherings or organized activities. IGNORE general political commentary, online arguments, or simple media appearances (TV, podcasts).

CONFIDENCE SCORE NUANCE (Official vs. Social Capacity): You MUST adjust the ConfidenceScore based on the actor's role.
- High Confidence (0.9-1.0): The actor is clearly participating in an official capacity for their organization (e.g., a TPUSA Field Rep running a TPUSA canvassing event, a chapter hosting a speaker). The event aligns with the organization's mission.
- Lower Confidence (0.3-0.7): An affiliated actor is present at a political or social event, but it's unclear if they are acting in their official capacity. For example, a known TPUSA staffer attends a rally organized by a different, unaffiliated group. In this case, you should still extract the event but use a lower score to flag the ambiguity. If it is, for example, a TPUSA staffer at a social event with no clear mention of their professional capacity, it should be even lower. 

MAINSTREAM NEWS EVENT PENALTY (IMPORTANT): 
- Downgrade confidence (multiply by 0.7) for events that would be mainstream news:
  * ANY event primarily about Trump administration activities or appointments  
  * High-profile political figures at major venues (Trump at Mar-a-Lago, DeSantis at state events)
  * Celebrity appearances or endorsements
  * Major campaign rallies covered by national media
  * White House events, Congressional hearings, or federal government activities
  * Any "Trump welcomes X" or "Trump appoints Y" type events
  
- EXCEPTION: Conferences organized BY affiliated actors (AmericaFest, Student Action Summit, etc.) maintain normal confidence
  
- BOOST confidence (multiply by 1.2, cap at 1.0) for grassroots activities:
  * Field representatives meeting with local churches or community groups
  * Youth groups organizing local events  
  * School board testimonies by parents or local activists
  * Door-to-door canvassing in neighborhoods
  * Small-scale voter registration at local venues
  * Chapter meetings at schools
  * Local activists training sessions
  
- The more LOCAL and GRASSROOTS the activity, the HIGHER the confidence
- The more NATIONAL NEWS WORTHY, the LOWER the confidence
- Ask yourself: "Is this about Trump administration news?" If yes, multiply confidence by 0.7
- Ask yourself: "Would CNN/Fox News cover this?" If yes, multiply confidence by 0.7
- Ask yourself: "Is this hyperlocal organizing work?" If yes, multiply confidence by 1.2 (cap at 1.0)

CANVASSING & ELECTIONEERING PRIORITY (CRITICAL): This is the highest priority activity. These events CANNOT be missed.
- Recognize Informal Activity: Posts do not need to announce a formal event. Photographic evidence of door-knocking (e.g., people with clipboards, wearing campaign shirts at a door) or descriptive text like "Just a couple of Moms out here in Mesa talking with other Moms about the Mesa Recall" are sufficient proof of a canvassing event. Treat these as valid events.
- Assume Separate Events: Electioneering happens frequently. Posts on different days are ALWAYS separate events. Posts on the same day but mentioning different locations or actors should also be treated as separate events. When in doubt, create a separate entry.
- Date Inference: For canvassing, the date of the event is the date the post was made, unless the post is explicitly promoting a future event with a specific date.

ONE ROW PER UNIQUE EVENT: Each unique occurrence (defined by activity, date, and location) gets its own row. If an event series occurs over multiple days, each day is a unique event.

SEPARATE MULTI-STATE EVENTS: If a single announcement promotes activity in multiple states/locations, create a SEPARATE event entry for EACH location.

INTELLIGENT DATE RESOLUTION: If no exact date is in the text, infer the month and year from the post timestamp and set the day to "01", unless Rule #3 (Canvassing) applies.

DYNAMIC SLUG CREATION: You MUST generate a dynamic slug for certain activities. Check existing slugs first.

NAMING CONVENTIONS (follow these exactly):
- Elections: Election:[State]_[Office]_[Candidate]_[Year] (e.g., Election:AZ_Senate_Kari_Lake_2024)
  * Without candidate: Election:[State]_[Office]_[Year]
  * Special elections: add "_Special"
  * Recalls: add "_Recall"
- Ballot Measures: BallotMeasure:[State]_Prop[Number]_[Topic]_[Year]
- Schools: School:[State]_[SchoolName] or School:[State]_[District]_[Topic]
- Churches: Church:[Name]_[City]_[State]
- Conferences: Conference:[Name]_[Year]_[Location]
- LobbyingTopic: LobbyingTopic:[Topic]

MANDATORY TAG COMBINATIONS:
- If any event is at a school, you MUST include a School:[State]_[SchoolName] slug.
- If any event is at a church, you MUST include a Church:[Name]_[City]_[State] slug.
- If any Lobbying tag is used, you MUST also include a LobbyingTopic:[Topic] slug.

LOBBYING SCOPE:
- Lobbying: Applies to direct, formal interactions with government bodies (testifying at a school board, meeting with a legislator). A post that is an official, coordinated call to action from an affiliated organization for its members to contact officials or attend a public meeting (e.g., "Call your reps about Bill XYZ!", "Show up to the school board meeting on Tuesday to testify!") also qualifies and should be tagged Lobbying. An individual's unsolicited complaint to a politician is NOT lobbying.

### CONTROVERSY SCOPE  

1. **Define “Controversy.”**  
   Extract **only** incidents where an affiliated actor’s *real-world* action, decision, or official statement sparks public dispute **or** where the actor claims institutional suppression (e.g., de-recognition, event cancellation, disciplinary hearing, subpoena, lawsuit).

2. **Include Actor-Instigated Misconduct.**  
   Capture cases where a TPUSA-affiliated actor is the **instigator/perpetrator** of harassment, violence, threats, or other illicit conduct (e.g., assaulting a professor, doxxing protestors). These cases receive their own **Critical** tier (below).

3. **Ignore “Frivolous” Posts by Default.**  
   - A single tweet, Substack rant, or media clip with **no** coordinated call-to-action, **no** institutional response, and **no** offline consequence **is frivolous**.  
   - Still extract **if** both gates pass, but classify it as **Low-Severity** so it receives a low `ConfidenceScore`.

4. **Severity Tiers (used only for scoring).**

| Tier | Triggering Conditions | Example | **SeverityWeight** |
|------|----------------------|---------|--------------------|
| **Critical** | Affiliated actor **initiates** harassment, violence, credible threat, or other criminal/misconduct action | TPUSA staffer assaults professor during protest; or an actor doxxes a "woke" professor and urgest people to contact his employer | **1.1** |
| **High**   | Documented institutional action *or* offline consequence (resignation, policy change, cancelled speech, lawsuit filing, formal investigation, police report) **AND** the affiliated actor is the principal organizer/target | Chapter mobilizes parents; superintendent resigns | **1.0** |
| **Medium** | Coordinated public campaign, organized protest, or press conference targeting an institution **but** no confirmed institutional action (yet) | TPUSA field rep launches petition; large turnout at board meeting | **0.8** |
| **Low**    | Online outrage only (tweet thread, Substack post, podcast clip) **without** evidence of coordination or institutional response | Staffer tweets screenshot of “woke” email | **0.4** |

5. **ConfidenceScore Calculation (Controversy Events).**
BaseScore = 1.0 if actor clearly in official capacity, else 0.7
ConfidenceScore = BaseScore × SeverityWeight
*Examples:*  
- High-severity + official actor ⇒ **1.0**  
- Low-severity + unclear capacity ⇒ **0.28** (round to one decimal place → **0.3**)
6. **Tag Usage.**  
   Always apply the single tag **`Controversy`**. Use `ConfidenceScore` for seriousness ranking—no extra tags needed.
7. **Justification Must Note Severity.**  
   In the `Justification` field, explicitly state the detected severity tier and why (e.g., “High-severity: board opened investigation; actor led protest”).
8. Instances of actors engaging with school boards directly are priority to notice!! 

PARTICIPANTS FIELD: Extract every individual or organization named. List all by their formal/display names, comma-separated. Do NOT include @handles.

HANDLE FIELDS (InstagramHandles, TwitterHandles): Be EXHAUSTIVE. List ALL handles (without @) from the post author and any mentioned users. Missing handles are a critical error.

ANNOUNCEMENTS VS. ACTUALS: If you see a post announcing an event AND a post showing the event happened within the same batch, combine them into a single event entry with all SourceIDs.
 a) **but** always track annoucements that indiate a new program or important news about one of the actors, (like tpusa high school chapters changing their name, or the launch of a new chase the vote program)
 b) general campaign annoucements must be made OFFICIALLY - not just "lets do this sometime!" as a tweet - it has to be a formal annoucement on behalf of an actors affiliated organizations. 

SMART CITY INFERENCE: If a state is named but not a city, use the fallback ladder to infer a city and note the reasoning in the Justification.
a) Venue clues in text.
b) Primary actor's home base from bio.
c) Largest city in the state/region.
d) City from another event in the same batch (same actors/date).
e) For Legislative Districts, use the largest city within that district.

SCHOOL CHAPTER HANDLE RULE: If a handle clearly represents a school chapter (@tpusa_asu, @tpusa_lakewoodhs), you MUST add the correct education-level tag (College, High School, Homeschool) AND a matching Institution:<School_Name> slug (unless it is a large multi-chapter conference).

CALENDAR POSTS: some posts with a url like https://calendar.example.com/event/https://nau.campuslabs.com/engage/event/11270387 or other non normal urls can be assumed to be ical events added to the dataset and can be assumed to be events at the date they are posted (happening at the date posted exactly)


FIELD-SPECIFIC INSTRUCTIONS:
- Date: "YYYY-MM-DD".
- EventName: A concise, descriptive name for the event.
- EventDescription: A detailed 2–4 sentences of what/how/why.
- CategoryTags: A JSON list of strings. Choose from the allowed tags and generate required slugs.
- Location, City, State: Extract as precisely as possible.
- Participants: A single string of ALL formal/display names, comma-separated.
- ConfidenceScore: 0.0–1.0. Adhere to Rule #2.
- Justification: Briefly explain your reasoning. Your justification MUST explicitly state the connection to TPUSA or its affiliates (e.g., "Event was attended by TPUSA Field Rep Laci Williams," or "Controversy tag applied because TPUSA is framing the event cancellation as a free speech violation"). If you cannot establish this link, do not extract the event.
- SourceIDs: A JSON list of the database UUID values (NOT post_id) for all posts that refer to this event. Use the UUID values provided in the post metadata, not the post_id field.
- InstagramHandles & TwitterHandles: ALL handles (without @) from EVERY post - include the author handle AND ALL mentioned users. Be EXHAUSTIVE - missing handles means missing actor links!

EXAMPLE OF A PERFECT RESPONSE:
{{
"events": [
    {{
        "Date": "2023-10-01",
        "EventName": "TPUSA vs ASU Administration Controversy",
        "EventDescription": "TPUSA chapter at Arizona State University faced censorship when the administration banned their 'America First' banner from campus grounds. The chapter organized a response rally and is claiming this as an example of institutional bias against conservative students.",
        "CategoryTags": ["Controversy", "College", "Institution:Arizona_State_University", "Rally"],
        "Location": "Arizona State University, Tempe, AZ",
        "City": "Tempe",
        "State": "AZ",
        "Participants": "TPUSA ASU Chapter, Campus Administration, Student Government",
        "ConfidenceScore": 0.90,
        "Justification": "Clear controversy involving institutional pushback against TPUSA. The connection to TPUSA is direct, as it involves their ASU chapter and was amplified by national staff.",
        "SourceIDs": ["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440002"],
        "InstagramHandles": ["tpusa_asu"],
        "TwitterHandles": ["tpusa_asu", "charliekirk11"]
    }}
]
}}

{{
"events": [
    {{
        "Date": "2024-09-10",
        "EventName": "TPUSA Rep Testifies at PVUSD School Board Meeting",
        "EventDescription": "A TPUSA field representative attended and provided public testimony at the Paradise Valley Unified School District board meeting. The testimony focused on the 'Make America Healthy Again' initiative, advocating for changes to the district's school lunch program to align with their health and wellness standards.",
        "CategoryTags": ["School Board", "High School", "Health", "LobbyingTopic:School_Lunch_Policy", "Institution:Paradise_Valley_Unified_School_District"],
        "Location": "Paradise Valley Unified School District Board Room, Phoenix, AZ",
        "City": "Phoenix",
        "State": "AZ",
        "Participants": "John Doe (TPUSA Field Rep), Paradise Valley Unified School District Board",
        "ConfidenceScore": 1.0,
        "Justification": "Direct lobbying activity by a known TPUSA affiliate in an official capacity. The Lobbying tag applies due to testimony at a government meeting. LobbyingTopic and Institution slugs are generated as required.",
        "SourceIDs": ["550e8400-e29b-41d4-a716-446655440003"],
        "InstagramHandles": ["tpusa_pvchapter", "johndoe_az"],
        "TwitterHandles": ["tpusa_pvchapter", "johndoe_az"]
    }}
]
}}

{{
"events": [
    {{
        "Date": "2025-05-23",
        "EventName": "TPAction Canvassing for Julie Spilsbury Recall",
        "EventDescription": "A get-out-the-signature event organized by Turning Point Action. Volunteers went door-to-door in Mesa's District 2 to gather signatures for the recall petition against Councilwoman Julie Spilsbury, whom they have labeled a 'RINO'.",
        "CategoryTags": ["Canvassing", "Recall:Julie_Spilsbury"],
        "Location": "Mesa Council District 2, Mesa, AZ",
        "City": "Mesa",
        "State": "AZ",
        "Participants": "TPAction Arizona Team, Jane Smith (Organizer)",
        "ConfidenceScore": 1.0,
        "Justification": "Direct electoral activity organized by TPAction. The connection is explicit. The Canvassing tag is used for the door-knocking activity. The Recall:Julie_Spilsbury slug identifies the specific political race.",
        "SourceIDs": ["550e8400-e29b-41d4-a716-446655440004"],
        "InstagramHandles": ["tpaction_az", "janesmith_tpa"],
        "TwitterHandles": ["tpaction_az", "janesmith_tpa"]
    }}
]
}}

CONTEXT: 
{actor_bio_str}


CATEGORY TAG DEFINITIONS:
{tag_rules_str}

ALLOWED CATEGORY TAGS:
[{tag_list_str}]

{existing_slugs_str}

FINAL INSTRUCTION FOR THE MODEL:
Your response MUST be a single, valid JSON object. For best results, enclose this JSON object in a markdown code block like so:
```json
{{
  "events": [
    // ... your extracted events here ...
  ]
}}
```
Do NOT include any other text, conversation, or explanations before or after the JSON block in your response.

""".format(
            actor_bio_str=actor_bio_str,
            tag_rules_str=tag_rules_str,
            tag_list_str=tag_list_str,
            existing_slugs_str=existing_slugs_str,
        )

    def process_batch_with_worker_delayed(self, batch, allowed_tags, tag_rules, batch_num, total_batches, worker, delay):
        """Process a batch with a specific worker after applying a startup delay"""
        if delay > 0:
            worker_id = worker.get('worker_id', 'unknown')
            print(f"  🕐 Worker {worker_id} (Batch {batch_num}): Delaying {delay:.1f}s before processing...")
            time.sleep(delay)
            print(f"  ▶️ Worker {worker_id} (Batch {batch_num}): Starting processing after delay")
        
        # Call the original method after delay
        return self.process_batch_with_worker(batch, allowed_tags, tag_rules, batch_num, total_batches, worker)

    def process_batch_with_worker_with_tools(self, batch, allowed_tags, tag_rules, batch_num, total_batches, worker):
        """Process a single batch with function tools for dynamic context retrieval"""
        # Store batch mapping for post ID lookups (used by link_posts_to_event handler)
        self.current_batch_post_mapping = {row['post_id']: row['id'] for row in batch}
        
        # Add safety check for None worker
        if worker is None:
            error_msg = f"Worker is None for batch {batch_num}. This indicates an issue with APIKeyManager initialization."
            print(f"  Error: {error_msg}")
            raise Exception(error_msg)
        
        # Update batch info in stats
        try:
            self.update_stats('current_batch', 0, {'current_batch': batch_num, 'total_batches': total_batches})
        except Exception as e:
            print(f"  ⚠️ {worker.get('worker_id', 'unknown')}: Failed to update batch stats: {e}")
        
        # Reload dynamic slugs before processing
        slug_reload_start = time.time()
        try:
            before_count = sum(len(slugs) for slugs in self.slug_manager.existing_slugs.values())
            self.slug_manager.load_existing_slugs()
            after_count = sum(len(slugs) for slugs in self.slug_manager.existing_slugs.values())
            slug_reload_time = time.time() - slug_reload_start
            
            if after_count != before_count:
                print(f"  🔄 {worker.get('worker_id', 'unknown')}: Reloaded slugs for batch {batch_num}: {before_count}→{after_count} ({slug_reload_time:.2f}s)")
            else:
                print(f"  📋 {worker.get('worker_id', 'unknown')}: Slugs up-to-date for batch {batch_num} ({after_count} total)")
        except Exception as e:
            print(f"  ⚠️ {worker.get('worker_id', 'unknown')}: Could not reload slugs: {e}")
        
        worker_id = worker['worker_id']
        
        try:
            # Only show batch processing message every 60 seconds to reduce console spam
            current_time = time.time()
            if current_time - self.last_batch_status_time >= self.batch_status_interval:
                print(f"  🔄 {worker_id}: Processing batch {batch_num}/{total_batches} ({len(batch)} posts) with function tools")
                self.last_batch_status_time = current_time
            
            # Apply rate limiting
            self.api_manager.rate_limit_delay(worker)
            
            # Create UUID mapping
            post_id_to_uuid_map = self.current_batch_post_mapping
            batch_post_uuids = [row['id'] for row in batch]
            
            # Extract and download images from posts
            images = self.extract_images_from_posts(batch)
            
            # Build simplified system prompt (without embedded context)
            system_prompt = self.build_system_prompt_with_tools(allowed_tags, tag_rules)
            
            retry_count = 0
            success = False
            events_saved = 0  # Initialize here so it's accessible throughout the function
            already_linked_posts = set()  # Track posts linked to existing events
            
            while retry_count < MAX_RETRIES and not success:
                try:
                    print(f"  {worker_id}: Attempt {retry_count + 1}/{MAX_RETRIES}")
                    
                    content_parts = [system_prompt]
                    
                    # Add text content for each post
                    for i, row in enumerate(batch):
                        post_dt = row.get('post_timestamp', '')
                        post_dt_str = ''
                        if pd.notna(post_dt):
                            if isinstance(post_dt, pd.Timestamp):
                                post_dt_str = post_dt.strftime("%Y-%m-%d %H:%M")
                            else:
                                post_dt_str = str(post_dt)
                        
                        post_text = (
                            f"--- Post Metadata ---\n"
                            f"UUID (use this for SourceIDs): {row.get('id','')}\n"
                            f"Post ID: {row.get('post_id','')} (do NOT use for SourceIDs)\n"
                            f"Platform: {row.get('platform','')}\n"
                            f"Author Handle: {row.get('author_handle','')}\n"
                            f"Author Name: {row.get('author_name','')}\n"
                            f"Post Date: {post_dt_str}\n"
                            f"Location: {row.get('location','')}\n"
                            f"Mentioned Users: {row.get('mentioned_users','')}\n"
                            f"Hashtags: {row.get('hashtags','')}\n"
                            f"--- Post Content ---\n"
                            f"{row.get('content_text','')}\n\n"
                        )
                        content_parts.append(post_text)
                    
                    # Add images to content if any
                    if images:
                        print(f"  {worker_id}: Including {len(images)} images in request")
                        content_parts.append(f"\n--- IMAGES ({len(images)} total) ---\n")
                        content_parts.append("The following images are from the posts above. Use them to better understand the events and context:\n\n")
                        
                        for i, img in enumerate(images):
                            content_parts.append(f"Image {i+1} - Post ID: {img['post_id']} ({img['platform']}):\n")
                            # Add the actual image data for Gemini using inline_data format
                            content_parts.append({
                                "inline_data": {
                                    "mime_type": "image/jpeg",
                                    "data": img["data"]
                                }
                            })
                            content_parts.append("\n")
                    
                    print(f"  {worker_id}: Calling Gemini API with function tools...")
                    api_start_time = time.time()
                    
                    # Get timeout from environment or use default
                    gemini_timeout = int(os.getenv('GEMINI_API_TIMEOUT', '600'))  # Default 10 minutes
                    
                    # Modified generation config to NOT force JSON (incompatible with tools)
                    generation_config = types.GenerationConfig(
                        max_output_tokens=100000,
                        temperature=0.2,
                        top_p=0.9,
                        top_k=40
                    )
                    
                    # Call with function tools (with retry for disconnections)
                    max_api_retries = 3
                    api_retry_count = 0
                    response = None
                    
                    while api_retry_count < max_api_retries:
                        try:
                            response = worker['model'].generate_content(
                                content_parts,
                                generation_config=generation_config,
                                tools=self.all_function_tools,
                                tool_config={'function_calling_config': {'mode': 'ANY'}},
                                request_options={'timeout': gemini_timeout}
                            )
                            break  # Success, exit retry loop
                            
                        except Exception as api_e:
                            api_retry_count += 1
                            error_msg = str(api_e).lower()
                            
                            if 'server disconnected' in error_msg or 'connection' in error_msg or 'deadline exceeded' in error_msg:
                                if api_retry_count < max_api_retries:
                                    print(f"  ⚠️ {worker_id}: Connection error (attempt {api_retry_count}/{max_api_retries}): {api_e}")
                                    time.sleep(2 ** api_retry_count)  # Exponential backoff
                                    continue
                                else:
                                    print(f"  ❌ {worker_id}: Max retries reached for Gemini API: {api_e}")
                                    raise
                            else:
                                raise  # Re-raise non-connection errors
                    
                    api_duration = time.time() - api_start_time
                    print(f"  {worker_id}: Gemini API call completed in {api_duration:.1f}s")
                    
                    # Process function calls and collect results
                    function_responses = []
                    has_function_calls = False
                    
                    if response and response.candidates:
                        for candidate in response.candidates:
                            if hasattr(candidate.content, 'parts'):
                                for part in candidate.content.parts:
                                    # Handle function calls
                                    if hasattr(part, 'function_call'):
                                        has_function_calls = True
                                        fc = part.function_call
                                        print(f"  {worker_id}: Processing function call: {fc.name}")
                                        
                                        if fc.name == "search_actors":
                                            actors = fc.args.get('actors', [])
                                            result = self.handle_search_actors(actors)
                                            # Create a Part with function_response
                                            from google.generativeai import protos
                                            function_responses.append(protos.Part(
                                                function_response=protos.FunctionResponse(
                                                    name=fc.name,
                                                    response={"actors": result}
                                                )
                                            ))
                                            
                                        elif fc.name == "search_dynamic_slugs":
                                            result = self.handle_search_dynamic_slugs(
                                                search_term=fc.args.get('search_term'),
                                                parent_tag_filter=fc.args.get('parent_tag_filter')
                                            )
                                            function_responses.append(protos.Part(
                                                function_response=protos.FunctionResponse(
                                                    name=fc.name,
                                                    response={"slugs": result}
                                                )
                                            ))
                                            # Model sees all slug variations
                                            
                                        elif fc.name == "link_posts_to_existing_event":
                                            result = self.handle_link_posts_to_event(
                                                event_id=fc.args.get('event_id'),
                                                post_ids=fc.args.get('post_ids', []),
                                                reason=fc.args.get('reason', '')
                                            )
                                            function_responses.append(protos.Part(
                                                function_response=protos.FunctionResponse(
                                                    name=fc.name,
                                                    response=result
                                                )
                                            ))
                                            if result.get('success'):
                                                # Track which posts are already linked
                                                for post_id in fc.args.get('post_ids', []):
                                                    already_linked_posts.add(post_id)
                    
                    # If we had function calls, send the responses back to get the final answer
                    if has_function_calls and function_responses:
                        print(f"  {worker_id}: Sending function responses back to model...")
                        
                        # Create a new content list with the function responses
                        content_with_responses = content_parts + function_responses
                        
                        # Call the model again with the function responses
                        # This time, ask for JSON output explicitly by not providing tools
                        final_generation_config = types.GenerationConfig(
                            max_output_tokens=100000,
                            temperature=0.2,
                            top_p=0.9,
                            top_k=40,
                            response_mime_type="application/json"  # Request JSON response
                        )
                        
                        response = worker['model'].generate_content(
                            content_with_responses,
                            generation_config=final_generation_config,
                            # Don't provide tools this time to get the final JSON response
                            request_options={'timeout': gemini_timeout}
                        )
                        
                        print(f"  {worker_id}: Received final response from model")
                    
                    # Get the final text response (JSON with events)
                    # When using function tools, the response might be in a different format
                    response_text = None
                    
                    # Try to get text from the response
                    try:
                        if response and hasattr(response, 'text'):
                            response_text = response.text.strip()
                    except Exception as e:
                        # If we can't get text, check if we have candidates with content
                        if response and hasattr(response, 'candidates') and response.candidates:
                            for candidate in response.candidates:
                                if hasattr(candidate, 'content') and hasattr(candidate.content, 'parts'):
                                    for part in candidate.content.parts:
                                        if hasattr(part, 'text'):
                                            response_text = part.text.strip()
                                            break
                                if response_text:
                                    break
                    
                    if response_text is None:
                        # If no text response, that's OK - posts might have been linked to existing events
                        if already_linked_posts:
                            print(f"  ✅ {worker_id}: {len(already_linked_posts)} posts linked to existing events")
                            response_data = {'events': []}  # Empty events since posts were linked
                        else:
                            # No text found, but that's OK with function tools - assume no events
                            print(f"  {worker_id}: No events found in batch")
                            response_data = {'events': []}
                    else:
                        if DEBUG:
                            print(f"[DEBUG] {worker_id}: Gemini response length: {len(response_text)} characters")
                            print(f"[DEBUG] {worker_id}: First 200 chars: {response_text[:200]}")
                        
                        # Use robust JSON extraction for Flash model
                        response_data = self._extract_json_from_response(response_text)
                        if response_data is None:
                            print(f"  ❌ {worker_id}: Failed to extract a valid JSON object from the model's response.")
                            print(f"  Raw response: {response_text[:500]}...")
                            raise Exception("Could not parse a valid JSON object from Gemini's response.")
                    
                    # Handle different response formats
                    if isinstance(response_data, list):
                        # If it's a list directly, wrap it in the expected format
                        response_data = {'events': response_data}
                    elif 'events' not in response_data:
                        # If it's a dict but missing 'events' key, try to extract events
                        # Check if it has event-like structure
                        if 'EventName' in response_data:
                            # Single event as dict
                            response_data = {'events': [response_data]}
                        else:
                            # Unknown format, assume no events
                            response_data = {'events': []}
                    
                    events_list = response_data['events']
                    if not isinstance(events_list, list):
                        raise Exception("'events' must be a list")
                    
                    # Filter out events whose posts were already linked
                    new_events = []
                    for event in events_list:
                        source_ids = set(event.get('SourceIDs', []))
                        if not source_ids.intersection(already_linked_posts):
                            new_events.append(event)
                        else:
                            print(f"  ℹ️ {worker_id}: Skipping event (posts already linked): {event.get('EventName', 'Unknown')}")
                    
                    print(f"  ✅ {worker_id}: Gemini returned {len(new_events)} new events ({len(already_linked_posts)} posts linked to existing)")

                    # Guard against events with missing or empty SourceIDs
                    missing_source_events = [
                        event for event in new_events
                        if not event.get('SourceIDs')
                        or not isinstance(event.get('SourceIDs'), list)
                        or not any(sid for sid in event.get('SourceIDs') if sid)
                    ]

                    if missing_source_events:
                        sample_names = ', '.join([
                            str(evt.get('EventName') or 'Unnamed')[:60]
                            for evt in missing_source_events[:3]
                        ])
                        raise MissingSourceIdsError(
                            f"{worker_id}: Model returned {len(missing_source_events)} event(s) without SourceIDs"
                            + (f" (examples: {sample_names})" if sample_names else '')
                        )

                    # Process the new events using the existing logic
                    events_saved = 0
                    events_to_upsert = []
                    event_infos = []
                    
                    for event_data in new_events:
                        try:
                            # Handle case where event_data might have nested 'events' key
                            if isinstance(event_data, dict) and 'events' in event_data:
                                # Extract the first event from nested structure
                                if isinstance(event_data['events'], list) and event_data['events']:
                                    event_data = event_data['events'][0]
                                else:
                                    continue
                            
                            event_obj = Event(**event_data)
                        except ValidationError as ve:
                            print(f"  ❌ {worker_id}: Event validation failed: {str(ve)}")
                            print(f"  Event data: {event_data}")
                            continue
                        
                        source_uuids = []
                        for post_id_or_uuid in event_obj.SourceIDs:
                            # First check if it's already a UUID in our mapping
                            if post_id_or_uuid in post_id_to_uuid_map:
                                source_uuids.append(post_id_to_uuid_map[post_id_or_uuid])
                            # Check if it's already a UUID from the batch
                            elif post_id_or_uuid in batch_post_uuids:
                                source_uuids.append(post_id_or_uuid)
                            else:
                                # Try to find by post_id in the database
                                print(f"  🔍 {worker_id}: Searching for post_id {post_id_or_uuid} in database...")
                                try:
                                    result = self.supabase.table('v2_posts').select('id').eq('post_id', post_id_or_uuid).execute()
                                    if result.data and len(result.data) > 0:
                                        uuid = result.data[0]['id']
                                        source_uuids.append(uuid)
                                        print(f"  ✅ {worker_id}: Found UUID {uuid[:8]}... for post_id {post_id_or_uuid}")
                                    else:
                                        print(f"  ⚠️ {worker_id}: Post ID {post_id_or_uuid} not found in database")
                                except Exception as e:
                                    print(f"  ⚠️ {worker_id}: Error searching for post_id {post_id_or_uuid}: {e}")
                        
                        event_dict = event_obj.dict()
                        event_dict['SourceIDs'] = source_uuids

                        if not source_uuids:
                            raise MissingSourceIdsError(
                                f"{worker_id}: Event '{event_obj.EventName[:60]}' produced no valid SourceIDs from {event_obj.SourceIDs}"
                            )
                        
                        content_hash = self.generate_event_hash(event_dict)
                        event_date = event_dict.get('Date', '')
                        
                        # Generate embedding for the event with better error handling
                        location_text = f"{event_dict.get('City', '')} {event_dict.get('State', '')}".strip()
                        try:
                            embedding = generate_event_embedding(
                                event_name=event_dict['EventName'],
                                event_description=event_dict.get('EventDescription', ''),
                                location=location_text
                            )

                            if not embedding:
                                print(f"  ⚠️ {worker_id}: Failed to generate embedding for event: {event_dict['EventName'][:50]}")
                                print(f"     Event will be saved without embedding for semantic search")
                        except Exception as e:
                            print(f"  ❌ {worker_id}: Exception generating embedding: {e}")
                            print(f"     Event will be saved without embedding for semantic search")
                            embedding = None
                        
                        event_record = {
                            'event_name': event_dict['EventName'],
                            'event_description': event_dict.get('EventDescription', ''),
                            'event_date': event_date if event_date else None,
                            'location': event_dict.get('Location', ''),
                            'city': event_dict.get('City', ''),
                            'state': event_dict.get('State', ''),
                            'participants': event_dict.get('Participants', ''),
                            'category_tags': event_dict.get('CategoryTags', []),
                            'confidence_score': event_dict.get('ConfidenceScore', 0.5),
                            'justification': event_dict.get('Justification', ''),
                            'content_hash': content_hash,
                            'project_id': DEFAULT_PROJECT_ID,
                            'embedding': embedding  # Add the embedding
                        }
                        
                        events_to_upsert.append(event_record)
                        
                        event_infos.append({
                            'event_dict': event_dict,
                            'instagram_handles': event_dict.get('InstagramHandles', []),
                            'twitter_handles': event_dict.get('TwitterHandles', []),
                            'source_uuids': source_uuids
                        })
                    
                    # Batch upsert events if we have any
                    if events_to_upsert:
                        table_name = 'v2_events' if USE_V2_SCHEMA else 'events'
                        upserted = self.supabase.table(table_name).upsert(
                            events_to_upsert,
                            on_conflict='content_hash'
                        ).execute()
                        
                        if upserted.data:
                            events_saved = len(upserted.data)
                            print(f"  💾 {worker_id}: Saved {events_saved} events")
                            
                            # Update statistics
                            self.update_stats('events_processed', events_saved)
                            self.update_stats('events_created', events_saved)
                            
                            # Create event-post links and handle actor links
                            for i, event_record in enumerate(upserted.data):
                                if i < len(event_infos):
                                    event_info = event_infos[i]
                                    event_id = event_record['id']
                                    
                                    # Create event-post links
                                    self.create_event_post_links(event_id, event_info['source_uuids'])
                                    
                                    # Link actors using the unified method
                                    self.link_event_actors_unified(
                                        event_id=event_id,
                                        event_dict=event_info['event_dict'],
                                        event_post_ids=event_info['source_uuids']
                                    )
                                    
                                    # Link unknown actors
                                    self.link_event_to_post_unknown_actors(event_id, event_info['source_uuids'])
                                    
                                    # Process dynamic slugs
                                    for tag in event_info['event_dict'].get('CategoryTags', []):
                                        if ':' in tag:
                                            parent_tag, slug_identifier = tag.split(':', 1)
                                            # Check if parent_tag is valid (e.g., Institution, BallotMeasure, etc.)
                                            if parent_tag in self.slug_manager.existing_slugs:
                                                self.slug_manager.get_or_create_slug(parent_tag, slug_identifier)
                    
                    success = True
                    
                    # Mark posts as processed after successful batch
                    print(f"  📝 {worker_id}: Marking {len(batch_post_uuids)} posts as processed...")
                    self.mark_posts_as_processed(batch_post_uuids)
                    
                    # Update posts processed count with batch info
                    self.update_stats('posts_processed', len(batch_post_uuids), {'current_batch': batch_num, 'total_batches': total_batches})
                    
                except Exception as e:
                    retry_count += 1
                    print(f"  ❌ {worker_id}: Attempt {retry_count} failed: {str(e)}")
                    if retry_count < MAX_RETRIES:
                        wait_time = min(2 ** retry_count, 30)
                        print(f"  ⏳ {worker_id}: Waiting {wait_time}s before retry...")
                        time.sleep(wait_time)
                    else:
                        self.log_failed_batch(batch, str(e), worker_id)
                        # DO NOT mark posts as processed on failure - they need to be retried
                        print(f"  ❌ {worker_id}: Batch failed after {MAX_RETRIES} attempts - posts NOT marked as processed")
                        raise
            
            # Return the number of events saved instead of just success boolean
            return events_saved if success else 0
            
        except Exception as e:
            print(f"  ❌ {worker_id}: Batch {batch_num} failed: {str(e)}")
            self.log_failed_batch(batch, str(e), worker_id)
            # DO NOT mark posts as processed on failure - they need to be retried
            print(f"  ❌ {worker_id}: Batch failed - posts NOT marked as processed")
            raise
    
    def process_batch_with_worker(self, batch, allowed_tags, tag_rules, batch_num, total_batches, worker):
        """Process a single batch with a specific worker"""
        # Check if we should use the new tool-based approach
        use_tools = os.getenv('USE_FUNCTION_TOOLS', 'true').lower() == 'true'
        
        if use_tools:
            return self.process_batch_with_worker_with_tools(
                batch, allowed_tags, tag_rules, batch_num, total_batches, worker
            )
        
        # Otherwise use the original implementation
        # Add safety check for None worker
        if worker is None:
            error_msg = f"Worker is None for batch {batch_num}. This indicates an issue with APIKeyManager initialization."
            print(f"  Error: {error_msg}")
            raise Exception(error_msg)
        
        # Update batch info in stats
        try:
            self.update_stats('current_batch', 0, {'current_batch': batch_num, 'total_batches': total_batches})
        except Exception as e:
            print(f"  ⚠️ {worker.get('worker_id', 'unknown')}: Failed to update batch stats: {e}")

        # Reload dynamic slugs before processing this batch to get any new ones created by previous batches
        # This ensures each batch has access to slugs created by previous batches
        slug_reload_start = time.time()
        try:
            before_count = sum(len(slugs) for slugs in self.slug_manager.existing_slugs.values())
            self.slug_manager.load_existing_slugs()
            after_count = sum(len(slugs) for slugs in self.slug_manager.existing_slugs.values())
            slug_reload_time = time.time() - slug_reload_start

            if after_count != before_count:
                print(f"  🔄 {worker.get('worker_id', 'unknown')}: Reloaded slugs for batch {batch_num}: {before_count}→{after_count} ({slug_reload_time:.2f}s)")
            else:
                print(f"  📋 {worker.get('worker_id', 'unknown')}: Slugs up-to-date for batch {batch_num} ({after_count} total)")
        except Exception as e:
            print(f"  ⚠️ {worker.get('worker_id', 'unknown')}: Could not reload slugs: {e}")

        if not isinstance(worker, dict):
            error_msg = f"Worker is not a dict for batch {batch_num}. Got: {type(worker)}"
            print(f"  Error: {error_msg}")
            raise Exception(error_msg)

        if 'worker_id' not in worker:
            error_msg = f"Worker missing 'worker_id' key for batch {batch_num}. Keys: {list(worker.keys())}"
            print(f"  Error: {error_msg}")
            raise Exception(error_msg)

        worker_id = worker['worker_id']

        try:
            # Only show batch processing message every 60 seconds to reduce console spam
            current_time = time.time()
            if current_time - self.last_batch_status_time >= self.batch_status_interval:
                print(f"  🔄 {worker_id}: Processing batch {batch_num}/{total_batches} ({len(batch)} posts) - Connection active")
                self.last_batch_status_time = current_time

            # Apply rate limiting
            self.api_manager.rate_limit_delay(worker)

            # Create UUID mapping
            post_id_to_uuid_map = { row['post_id']: row['id'] for row in batch }
            batch_post_uuids = [row['id'] for row in batch]

            if DEBUG:
                print(f"[DEBUG] {worker_id}: Created post ID mapping for {len(post_id_to_uuid_map)} posts")

            # Extract and download images from posts
            images = self.extract_images_from_posts(batch)

            # Collect handles for bio lookup
            handles_in_batch = set()
            for row in batch:
                author = str(row.get('author_handle', '')).strip()
                if author:
                    handles_in_batch.add(author)
                mentions_raw = row.get('mentioned_users', '')
                if isinstance(mentions_raw, list):
                    mentions = [m.strip() for m in mentions_raw]
                else:
                    mentions = [m.strip() for m in str(mentions_raw).replace('[','').replace(']','').replace("'",'').split(',') if m.strip()]
                for mention in mentions:
                    if mention:
                        handles_in_batch.add(mention)

            if DEBUG:
                print(f"[DEBUG] {worker_id}: Found {len(handles_in_batch)} unique handles in batch")

            actor_bio = self.get_actor_bio_info(list(handles_in_batch))
            system_prompt = self.build_system_prompt(allowed_tags, tag_rules, actor_bio)

            retry_count = 0
            success = False
            
            if DEBUG:
                print(f"[DEBUG] {worker_id}: Starting Gemini API attempts...")

            while retry_count < MAX_RETRIES and not success:
                try:
                    print(f"  {worker_id}: Attempt {retry_count + 1}/{MAX_RETRIES}")

                    content_parts = [system_prompt]

                    # Add text content for each post
                    for i, row in enumerate(batch):
                        post_dt = row.get('post_timestamp', '')
                        post_dt_str = ''
                        if pd.notna(post_dt):
                            if isinstance(post_dt, pd.Timestamp):
                                post_dt_str = post_dt.strftime("%Y-%m-%d %H:%M")
                            else:
                                post_dt_str = str(post_dt)

                        post_text = (
                            f"--- Post Metadata ---\n"
                            f"UUID (use this for SourceIDs): {row.get('id','')}\n"
                            f"Post ID: {row.get('post_id','')} (do NOT use for SourceIDs)\n"
                            f"Platform: {row.get('platform','')}\n"
                            f"Author Handle: {row.get('author_handle','')}\n"
                            f"Author Name: {row.get('author_name','')}\n"
                            f"Post Date: {post_dt_str}\n"
                            f"Location: {row.get('location','')}\n"
                            f"Mentioned Users: {row.get('mentioned_users','')}\n"
                            f"Hashtags: {row.get('hashtags','')}\n"
                            f"--- Post Content ---\n"
                            f"{row.get('content_text','')}\n\n"
                        )
                        content_parts.append(post_text)

                    # Add images to content if any
                    if images:
                        print(f"  {worker_id}: Including {len(images)} images in request")
                        content_parts.append(f"\n--- IMAGES ({len(images)} total) ---\n")
                        content_parts.append("The following images are from the posts above. Use them to better understand the events and context:\n\n")

                        for i, img in enumerate(images):
                            content_parts.append(f"Image {i+1} - Post ID: {img['post_id']} ({img['platform']}):\n")
                            # Add the actual image data for Gemini using inline_data format
                            content_parts.append({
                                "inline_data": {
                                    "mime_type": "image/jpeg",
                                    "data": img["data"]
                                }
                            })
                            content_parts.append("\n")

                    print(f"  {worker_id}: Calling Gemini API with {len(images)} images...")
                    api_start_time = time.time()
                    # Get timeout from environment or use default
                    gemini_timeout = int(os.getenv('GEMINI_API_TIMEOUT', '600'))  # Default 10 minutes
                    response = worker['model'].generate_content(
                        content_parts,
                        generation_config=worker['generation_config'],
                        request_options={'timeout': gemini_timeout}
                    )
                    api_duration = time.time() - api_start_time
                    print(f"  {worker_id}: Gemini API call completed in {api_duration:.1f}s")

                    if response is None or not hasattr(response, 'text') or response.text is None:
                        raise Exception("Gemini API returned invalid response")

                    response_text = response.text.strip()
                    if DEBUG:
                        print(f"[DEBUG] {worker_id}: Gemini response length: {len(response_text)} characters")
                        print(f"[DEBUG] {worker_id}: First 200 chars: {response_text[:200]}")

                    # Parse JSON response
                    try:
                        response_data = json.loads(response_text)
                    except json.JSONDecodeError as e:
                        print(f"  ❌ {worker_id}: JSON parsing failed: {str(e)}")
                        print(f"  Raw response: {response_text[:500]}...")
                        raise Exception(f"Invalid JSON response from Gemini: {str(e)}")

                    # Validate response structure
                    if 'events' not in response_data:
                        raise Exception("Response missing 'events' key")

                    events_list = response_data['events']
                    if not isinstance(events_list, list):
                        raise Exception("'events' must be a list")

                    print(f"  ✅ {worker_id}: Gemini returned {len(events_list)} events")

                    # Guard against events missing SourceIDs outright before processing
                    missing_source_events = [
                        event for event in events_list
                        if not event.get('SourceIDs')
                        or not isinstance(event.get('SourceIDs'), list)
                        or not any(sid for sid in event.get('SourceIDs') if sid)
                    ]

                    if missing_source_events:
                        sample_names = ', '.join([
                            str(evt.get('EventName') or 'Unnamed')[:60]
                            for evt in missing_source_events[:3]
                        ])
                        raise MissingSourceIdsError(
                            f"{worker_id}: Model returned {len(missing_source_events)} event(s) without SourceIDs"
                            + (f" (examples: {sample_names})" if sample_names else '')
                        )

                    # Prepare events for batch upsert
                    events_saved = 0
                    events_to_upsert = []
                    event_infos = []

                    for event_data in events_list:
                        try:
                            event_obj = Event(**event_data)
                        except ValidationError as ve:
                            print(f"  ❌ {worker_id}: Event validation failed: {str(ve)}")
                            print(f"  Event data: {event_data}")
                            continue

                        source_uuids = []
                        for post_id_or_uuid in event_obj.SourceIDs:
                            # First check if it's already a UUID in our mapping
                            if post_id_or_uuid in post_id_to_uuid_map:
                                source_uuids.append(post_id_to_uuid_map[post_id_or_uuid])
                            # Check if it's already a UUID from the batch
                            elif post_id_or_uuid in batch_post_uuids:
                                source_uuids.append(post_id_or_uuid)
                            else:
                                # Try to find by post_id in the database
                                print(f"  🔍 {worker_id}: Searching for post_id {post_id_or_uuid} in database...")
                                try:
                                    result = self.supabase.table('v2_posts').select('id').eq('post_id', post_id_or_uuid).execute()
                                    if result.data and len(result.data) > 0:
                                        uuid = result.data[0]['id']
                                        source_uuids.append(uuid)
                                        print(f"  ✅ {worker_id}: Found UUID {uuid[:8]}... for post_id {post_id_or_uuid}")
                                    else:
                                        print(f"  ⚠️ {worker_id}: Post ID {post_id_or_uuid} not found in database")
                                except Exception as e:
                                    print(f"  ⚠️ {worker_id}: Error searching for post_id {post_id_or_uuid}: {e}")

                        event_dict = event_obj.dict()
                        event_dict['SourceIDs'] = source_uuids

                        if not source_uuids:
                            raise MissingSourceIdsError(
                                f"{worker_id}: Event '{event_obj.EventName[:60]}' produced no valid SourceIDs from {event_obj.SourceIDs}"
                            )

                        content_hash = self.generate_event_hash(event_dict)
                        event_date = event_dict.get('Date', '')
                        if event_date and event_date.endswith('-00'):
                            event_date = event_date.replace('-00', '-01')
                        elif not event_date:
                            event_date = None

                        # Generate embedding for the event with better error handling
                        location_text = f"{event_dict.get('City', '')} {event_dict.get('State', '')}".strip()
                        try:
                            embedding = generate_event_embedding(
                                event_name=event_dict['EventName'],
                                event_description=event_dict.get('EventDescription', ''),
                                location=location_text
                            )

                            if not embedding:
                                print(f"  ⚠️ {worker_id}: Failed to generate embedding for event: {event_dict['EventName'][:50]}")
                                print(f"     Event will be saved without embedding for semantic search")
                        except Exception as e:
                            print(f"  ❌ {worker_id}: Exception generating embedding: {e}")
                            print(f"     Event will be saved without embedding for semantic search")
                            embedding = None

                        event_insert = {
                            'event_name': event_dict['EventName'],
                            'event_date': event_date,
                            'event_description': event_dict.get('EventDescription', ''),
                            'location': event_dict.get('Location', ''),
                            'city': event_dict.get('City', ''),
                            'state': event_dict.get('State', ''),
                            'participants': event_dict.get('Participants', ''),
                            'justification': event_dict.get('Justification', ''),
                            'category_tags': event_dict.get('CategoryTags', []),
                            'event_type': 'extracted',
                            'source_post_ids': event_dict.get('SourceIDs', []),
                            'confidence_score': event_dict.get('ConfidenceScore', 0.5),
                            'instagram_handles': event_dict.get('InstagramHandles', []),
                            'twitter_handles': event_dict.get('TwitterHandles', []),
                            'extracted_by': f"{MODEL_NAME}_concurrent_{len(self.api_manager.workers)}workers",
                            'extracted_at': datetime.now().isoformat(),
                            'verified': False,
                            'content_hash': content_hash,
                            'embedding': embedding  # Add the embedding
                        }

                        if USE_V2_SCHEMA:
                            event_insert['project_id'] = DEFAULT_PROJECT_ID

                        events_to_upsert.append(event_insert)
                        event_infos.append({
                            'event_obj': event_obj,
                            'event_dict': event_dict,
                            'source_uuids': source_uuids,
                            'content_hash': content_hash
                        })

                    # Batch upsert events
                    event_results = self.save_events_batch_to_supabase(events_to_upsert)

                    event_post_link_rows = []

                    for info in event_infos:
                        res = event_results.get(info['content_hash'])
                        if not res:
                            print(f"  ❌ Failed to save/update event: {info['event_dict']['EventName']}")
                            continue

                        event_id = res['event_id']
                        is_new = res['is_new']

                        if is_new:
                            events_saved += 1
                            self.update_stats('events_processed')
                            self.update_stats('events_created')  # Track new events separately

                            # Collect post link rows for batch upsert
                            for pid in info['source_uuids']:
                                event_post_link_rows.append({'event_id': event_id, 'post_id': pid})

                            # Use unified actor linking function
                            self.link_event_actors_unified(
                                event_id=event_id,
                                event_dict=info['event_dict'],
                                event_post_ids=list(info['source_uuids'])
                            )
                        else:
                            print(f"      ℹ️ Skipped duplicate event processing and link creation")

                    # Upsert all event-post links at once
                    self.bulk_create_event_post_links(event_post_link_rows)

                    print(f"  📊 {worker_id}: Batch Summary: {events_saved}/{len(events_list)} events saved successfully")

                    # Mark posts as processed
                    self.mark_posts_as_processed(batch_post_uuids)

                    # Update posts processed count with batch info
                    self.update_stats('posts_processed', len(batch_post_uuids), {'current_batch': batch_num, 'total_batches': total_batches})

                    success = True
                    return events_saved

                except Exception as e:
                    retry_count += 1
                    error_msg = str(e)
                    print(f"  ❌ {worker_id}: Attempt {retry_count} failed: {error_msg}")

                    if retry_count < MAX_RETRIES:
                        wait_time = 2 ** retry_count  # Exponential backoff
                        print(f"  ⏱️ {worker_id}: Waiting {wait_time}s before retry...")
                        time.sleep(wait_time)
                    else:
                        # Log failed batch
                        with open(self.failed_log_file, 'a') as f:
                            f.write(f"{datetime.now().isoformat()}: {worker_id} Batch {batch_num} failed after {MAX_RETRIES} attempts: {error_msg}\n")

                        print(f"  ❌ {worker_id}: Batch {batch_num} failed permanently after {MAX_RETRIES} attempts")
                        # DO NOT mark posts as processed on failure - they need to be retried
                        print(f"  ❌ {worker_id}: Posts NOT marked as processed - will be retried in next run")
                        return 0

        except Exception as e:
            print(f"❌ {worker_id}: Critical error in batch {batch_num}: {str(e)}")
            return 0

    def process_all_events(self, total_posts_limit=None):
        try:
            # Only show startup messages once
            if not hasattr(self, '_startup_shown'):
                print("🚀 Starting Event Processing Pipeline")
                print(f"📋 Configuration: Model={MODEL_NAME}, Test Mode={TEST_MODE}, Posts/Batch={POSTS_PER_BATCH}")
                print(f"⚡ Concurrent Processing: {len(self.api_manager.workers)} workers available")
                if total_posts_limit:
                    print(f"📊 Processing limit: {total_posts_limit} posts")
                self._startup_shown = True

            # Load category tags
            allowed_tags, tag_rules = self.get_category_tags_from_supabase()
            if not allowed_tags:
                print("❌ No category tags available. Cannot proceed.")
                return False

            # Fetch posts using direct query with proper chronological ordering
            posts = self.get_posts_for_processing(limit=total_posts_limit)

            if not posts:
                print("ℹ️ No unprocessed posts found. Nothing to do.")
                return True

            # Create batches from the fetched posts
            print("📦 Creating batches from fetched posts...")
            # Use improved batching that maintains chronological order but maximizes batch size
            batches = self.create_chronological_batches(posts)

            print(f"📊 Created {len(batches)} batches from {len(posts)} posts")
            if batches:
                avg_posts = sum(len(batch) for batch in batches) / len(batches)
                print(f"   📈 Average posts per batch: {avg_posts:.1f}")
            if not batches:
                print("ℹ️ No unprocessed posts found. Nothing to do.")
                return True

            # Limit batches in test mode
            if TEST_MODE and TEST_BATCH_LIMIT:
                original_count = len(batches)
                batches = batches[:TEST_BATCH_LIMIT]
                print(f"🧪 Test mode: Processing {len(batches)}/{original_count} batches")

            # Determine number of concurrent workers to use
            max_workers = min(len(self.api_manager.workers), len(batches))
            print(f"🔧 Using {max_workers} concurrent workers for {len(batches)} batches")
            print(f"🔧 Debug: API manager has {len(self.api_manager.workers)} workers total")
            print(f"🔧 Debug: API manager has {len(self.api_manager.api_keys)} API keys total")

            # Debug check: ensure we have workers
            if len(self.api_manager.workers) == 0:
                print("❌ CRITICAL: No workers available! APIKeyManager initialization failed.")
                return False

            # Process batches concurrently
            total_events_saved = 0
            successful_batches = 0
            total_posts_processed = 0

            start_time = time.time()

            if max_workers == 1:
                # Single-threaded processing for single API key
                print("🔄 Single-threaded processing...")
                worker = self.api_manager.get_worker(0)
                print(f"🔧 Debug: Retrieved worker for index 0: {worker is not None}")
                if worker:
                    print(f"🔧 Debug: Worker ID: {worker.get('worker_id', 'MISSING')}")
                else:
                    print("❌ CRITICAL: get_worker(0) returned None!")
                    return False

                for i, batch in enumerate(batches, 1):
                    # Check for cancellation before processing each batch
                    if self.check_cancellation():
                        print(f"🛑 Cancellation detected before batch {i}. Stopping gracefully.")
                        self.batches_completed_before_cancellation = successful_batches
                        break

                    batch_start = time.time()

                    events_saved = self.process_batch_with_worker(
                        batch, allowed_tags, tag_rules, i, len(batches), worker
                    )

                    total_events_saved += events_saved
                    total_posts_processed += len(batch)

                    if events_saved >= 0:  # Even 0 events is considered successful processing
                        successful_batches += 1

                    batch_time = time.time() - batch_start
                    print(f"  ⏱️ Batch {i} completed in {batch_time:.1f}s")

                    # Check for cancellation after completing batch
                    if self.check_cancellation():
                        print(f"🛑 Cancellation detected after batch {i}. Stopping gracefully.")
                        self.batches_completed_before_cancellation = successful_batches
                        break

                    # Brief pause between batches to be respectful to API
                    if i < len(batches):
                        time.sleep(1)

            else:
                # Multi-threaded concurrent processing
                print(f"⚡ Multi-threaded concurrent processing with {max_workers} workers...")
                
                # Add staggered startup delays for workers to prevent concurrent batch grabbing
                import random
                worker_delays = {}
                for idx in range(max_workers):
                    if idx == 0:
                        # First worker starts immediately
                        worker_delays[idx] = 0
                    else:
                        # Other workers get random delays between 30-90 seconds
                        worker_delays[idx] = random.uniform(30, 90)
                
                print("🕐 Worker startup delays to prevent concurrent batch processing:")
                for idx, delay in worker_delays.items():
                    if delay == 0:
                        print(f"   Worker {idx}: Starting immediately")
                    else:
                        print(f"   Worker {idx}: Starting after {delay:.1f}s delay")

                with ThreadPoolExecutor(max_workers=max_workers) as executor:
                    # Submit all batches to workers
                    future_to_batch = {}
                    worker_index = 0

                    for i, batch in enumerate(batches, 1):
                        # Check for cancellation before submitting more batches
                        if self.check_cancellation():
                            print(f"🛑 Cancellation detected. Not submitting remaining batches.")
                            break

                        worker_idx = worker_index % max_workers
                        worker = self.api_manager.get_worker(worker_idx)
                        print(f"🔧 Debug: Retrieved worker for index {worker_idx}: {worker is not None}")
                        if worker is None:
                            print(f"❌ CRITICAL: get_worker({worker_idx}) returned None!")
                            continue
                        
                        # Get the delay for this worker
                        delay = worker_delays.get(worker_idx, 0)
                        
                        future = executor.submit(
                            self.process_batch_with_worker_delayed,
                            batch, allowed_tags, tag_rules, i, len(batches), worker, delay
                        )
                        future_to_batch[future] = (i, batch)
                        worker_index += 1

                    # Collect results as they complete with timeout protection
                    completed_futures = set()
                    overall_timeout = int(os.getenv('EVENT_PROCESSOR_TIMEOUT', '43200'))  # Default 12 hours
                    try:
                        for future in as_completed(future_to_batch, timeout=overall_timeout):
                            batch_num, batch = future_to_batch[future]
                            completed_futures.add(future)
                            try:
                                events_saved = future.result(timeout=300)  # 5 minute timeout per result
                                total_events_saved += events_saved
                                total_posts_processed += len(batch)

                                if events_saved >= 0:
                                    successful_batches += 1

                                print(f"  ✅ Batch {batch_num} completed with {events_saved} events")

                                # Check for cancellation after each completed batch
                                if self.check_cancellation():
                                    print(f"🛑 Cancellation detected after batch {batch_num}. Waiting for in-progress batches to complete.")
                                    self.batches_completed_before_cancellation = successful_batches
                                    # Let remaining futures complete naturally - they're already running

                            except TimeoutError:
                                print(f"  ⏰ Batch {batch_num} timed out after 5 minutes - posts NOT marked as processed")
                                # DO NOT count timed out posts as processed - they need to be retried
                            except Exception as e:
                                print(f"  ❌ Batch {batch_num} failed with exception: {str(e)}")
                                # DO NOT count failed posts as processed - they need to be retried
                                
                    except TimeoutError:
                        print(f"⚠️ Overall processing timeout reached ({overall_timeout/60:.0f} minutes). Some batches may not have completed.")
                    
                    # Check for any futures that didn't complete
                    incomplete_futures = set(future_to_batch.keys()) - completed_futures
                    if incomplete_futures:
                        print(f"⚠️ Warning: {len(incomplete_futures)} batches did not complete within timeout")
                        for future in incomplete_futures:
                            batch_num, batch = future_to_batch[future]
                            print(f"  ⏰ Batch {batch_num} was incomplete - posts NOT marked as processed")
                            future.cancel()  # Try to cancel the stuck future
                            # DO NOT count incomplete posts as processed - they need to be retried

            # Update global statistics and clear batch info since we're done
            self.update_stats('batches_processed', successful_batches, {'current_batch': 0, 'total_batches': 0})
            self.update_stats('total_processing_time', time.time() - start_time)

            # Final summary
            total_time = time.time() - start_time

            # Check if we were cancelled
            if self.is_cancelled:
                print(f"\n🛑 Event Processing Cancelled!")
                print(f"📊 Cancellation Summary:")
                print(f"   • Batches completed before cancellation: {self.batches_completed_before_cancellation}/{len(batches)}")
                print(f"   • Posts processed before cancellation: {self.stats.get('posts_processed', 0)}")
                print(f"   • Events extracted before cancellation: {total_events_saved}")
                print(f"   • Processing time before cancellation: {total_time:.1f}s")
                print(f"   • Workers used: {max_workers}")

                # Show worker statistics
                with self.stats_lock:
                    for worker in self.api_manager.workers:
                        worker_id = worker['worker_id']
                        requests_made = worker['requests_made']
                        if requests_made > 0:
                            print(f"   • {worker_id}: {requests_made} API requests")

                print("🛑 Job was cancelled gracefully after finishing in-progress batches.")
                return False  # Return False to indicate job was cancelled, not completed
            else:
                print(f"\n🎉 Event Processing Complete!")
                print(f"📊 Final Summary:")
                print(f"   • Batches processed: {successful_batches}/{len(batches)}")
                print(f"   • Posts processed: {total_posts_processed}")
                print(f"   • Total events extracted: {total_events_saved}")
                print(f"   • Total processing time: {total_time:.1f}s")
                print(f"   • Average time per batch: {total_time/len(batches):.1f}s")
                print(f"   • Workers used: {max_workers}")

                # Show worker statistics
                with self.stats_lock:
                    for worker in self.api_manager.workers:
                        worker_id = worker['worker_id']
                        requests_made = worker['requests_made']
                        if requests_made > 0:
                            print(f"   • {worker_id}: {requests_made} API requests")

                if successful_batches == len(batches):
                    print("✅ All batches processed successfully!")
                    return True
                else:
                    failed_batches = len(batches) - successful_batches
                    print(f"⚠️ {failed_batches} batch(es) failed. Check {self.failed_log_file} for details.")
                    return False

        except Exception as e:
            print(f"❌ Critical error in event processing pipeline: {str(e)}")
            return False
    
    def get_current_stats(self):
        """Get current processing statistics"""
        with self.stats_lock:
            return self.stats.copy()
    
    def log_failed_batch(self, batch, error_message, worker_id):
        """Log a failed batch for debugging"""
        print(f"  ❌ {worker_id}: Batch failed - {error_message}")
        # Could also log to a file or database if needed
        self.update_stats('batches_failed', 1)

# API Integration Function
def run_event_processing(max_workers=None):
    """
    Function to be called by the API to run event processing
    Returns a dictionary with status and results

    Args:
        max_workers (int, optional): Maximum number of workers to use. If None, uses all available API keys.
    """
    try:
        processor = EventProcessor(max_workers=max_workers)
        success = processor.process_all_events()

        return {
            "success": success,
            "message": "Event processing completed" if success else "Event processing completed with errors",
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"Event processing failed: {str(e)}",
            "timestamp": datetime.now().isoformat()
        }

class StandaloneEventProcessor:
    """Standalone event processor with database communication"""

    def __init__(self, job_id: str, auto_create: bool = False):
        self.job_id = job_id
        self.shutdown_requested = False
        self.console_logs = []
        self._last_log_times: dict[str, float] = {}   # <- NEW
        self._last_startup_message_time = 0  # Track startup message timing
        
        # Initialize Supabase connection
        try:
            self.supabase = get_supabase()
        except Exception as e:
            print(f"Failed to connect to Supabase: {e}")
            raise
        self.db_limiter = SupabaseRateLimiter(SUPABASE_RPS)
        
        # Auto-create job entry if needed
        if auto_create:
            self._ensure_job_exists()

        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _ensure_job_exists(self):
        """Create job entry in v2_batches if it doesn't exist"""
        try:
            # Check if job exists
            existing = self.supabase.table('v2_batches').select('id').eq('id', self.job_id).execute()
            
            if not existing.data:
                # Create new job entry
                job_data = {
                    'id': self.job_id,
                    'job_type': 'event_processing',
                    'module_name': 'flash_standalone_event_processor',
                    'status': 'initializing',
                    'posts_processed': 0,
                    'events_extracted': 0,
                    'total_posts': 0,
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'updated_at': datetime.now(timezone.utc).isoformat(),
                    'console_logs': [],
                    'worker_stats': {},
                    'message': 'Auto-created job for Flash event processing'
                }
                
                self.supabase.table('v2_batches').insert(job_data).execute()
                print(f"✅ Created job entry in v2_batches: {self.job_id}")
        except Exception as e:
            print(f"⚠️ Warning: Could not ensure job exists: {e}")
            # Continue anyway - the job tracking is optional
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals"""
        self.log("INFO", f"Received signal {signum}, requesting shutdown...")
        self.shutdown_requested = True

    def log(self, level: str, message: str, from_capture: bool = False):
        """Log message to console and database"""
        now = time.time()

        # Special handling for startup messages - show only once per minute
        startup_patterns = ["Event processing started", "Starting Event Processing", "🚀 Starting"]
        is_startup_message = any(pattern in message for pattern in startup_patterns)
        
        if is_startup_message:
            if now - self._last_startup_message_time < 60:
                return  # Skip this startup message
            self._last_startup_message_time = now
        else:
            # Regular throttling for other duplicates
            last = self._last_log_times.get(message, 0)
            if now - last < 60:                # 60‑second window
                return                         # skip this repeat
            self._last_log_times[message] = now
        
        timestamp = datetime.now().isoformat()
        log_entry = {"timestamp": timestamp, "level": level, "message": message}

        # Print to console (only if not from capture to avoid recursion)
        if not from_capture:
            print(f"[{timestamp}] {level}: {message}")

        # Add to internal log buffer
        self.console_logs.append(log_entry)

        # Keep only last 1000 entries
        if len(self.console_logs) > 1000:
            self.console_logs = self.console_logs[-1000:]

        # Update database more frequently - every 3 log entries or immediately for important messages
        important_levels = ["ERROR", "SUCCESS", "WARN"]
        if len(self.console_logs) % 3 == 0 or level in important_levels:
            try:
                # Append new logs to console_output array in v2_batches
                self.supabase.table('v2_batches').update({
                    'console_output': self.console_logs[-500:],  # Keep last 500 entries
                    'updated_at': datetime.now().isoformat()
                }).eq('id', self.job_id).execute()
            except Exception as e:
                # Don't use print here to avoid recursion, use original stdout
                if hasattr(self, 'original_stdout'):
                    self.original_stdout.write(f"Failed to update logs: {e}\n")
                    self.original_stdout.flush()

    def flush_logs(self):
        """Force immediate flush of console logs to database"""
        if self.console_logs:
            try:
                self.supabase.table('v2_batches').update({
                    'console_output': self.console_logs[-500:],  # Keep last 500 entries
                    'updated_at': datetime.now().isoformat()
                }).eq('id', self.job_id).execute()
            except Exception as e:
                if hasattr(self, 'original_stdout'):
                    self.original_stdout.write(f"Failed to flush logs: {e}\n")
                    self.original_stdout.flush()

    def capture_print_output(self):
        """Redirect print statements to our logging system"""
        import sys

        # Store original stdout for direct writing
        self.original_stdout = sys.stdout

        class LogCapture:
            def __init__(self, original_stdout, logger):
                self.original_stdout = original_stdout
                self.logger = logger
                self.line_count = 0

            def write(self, text):
                # Write to original stdout
                self.original_stdout.write(text)
                self.original_stdout.flush()

                # Also log to database if it's not just whitespace
                text = text.strip()
                if text and not text.startswith("[202") and "Failed to update logs" not in text:
                    # Parse different log levels from the text
                    if "❌" in text or "ERROR" in text or "Failed" in text:
                        level = "ERROR"
                    elif "⚠️" in text or "WARN" in text:
                        level = "WARN"
                    elif "✅" in text or "SUCCESS" in text or "completed" in text:
                        level = "SUCCESS"
                    elif "🔧" in text or "INFO" in text or "🚀" in text or "📋" in text or "⚡" in text:
                        level = "INFO"
                    else:
                        level = "INFO"

                    self.logger.log(level, text, from_capture=True)
                    
                    # Force flush every 2 lines
                    self.line_count += 1
                    if self.line_count >= 2:
                        self.logger.flush_logs()
                        self.line_count = 0

            def flush(self):
                self.original_stdout.flush()
                self.logger.flush_logs()

        # Redirect stdout to our logger
        sys.stdout = LogCapture(sys.stdout, self)

    def check_control_signal(self) -> bool:
        """Check for cancel signal from database"""
        try:
            result = self.supabase.table('v2_batches')\
                .select('control_signal')\
                .eq('id', self.job_id)\
                .execute()

            if result.data and result.data[0].get('control_signal') == 'cancel':
                return True
        except Exception as e:
            self.log("ERROR", f"Failed to check control signal: {e}")

        return self.shutdown_requested

    def update_progress(self, stats: dict):
        """Update job progress in database"""
        now = time.time()
        if (last := getattr(self, "_last_flush", 0)) and now - last < 15:
            return
        self._last_flush = now

        try:
            # Only update if there's a valid job_id
            if not self.job_id:
                return
                
            self.supabase.table('v2_batches').update({
                'worker_stats': json.dumps(stats),
                'batch_progress': json.dumps({
                    'posts_processed': stats.get('posts_processed', 0),
                    'events_extracted': stats.get('events_processed', 0),
                    'last_update': datetime.now().isoformat()
                }),
                'posts_processed': stats.get('posts_processed', 0),
                'events_extracted': stats.get('events_processed', 0),
                'total_posts': stats.get('events_processed', 0),  # Use events as "posts" for consistency
                'current_batch': stats.get('current_batch', 0),
                'total_batches': stats.get('total_batches', 0),
                'accounts_scraped': stats.get('current_batch', 0),  # Batches processed as "accounts"
                'total_accounts': stats.get('total_batches', 0),   # Total batches as "accounts"
                'message': f"Processing batch {stats.get('current_batch', 0)}/{stats.get('total_batches', 0)} - {stats.get('posts_processed', 0)} posts processed, {stats.get('events_processed', 0)} events extracted",
                'updated_at': datetime.now().isoformat()
            }).eq('id', self.job_id).execute()
        except Exception as e:
            # Don't log to avoid recursion, just print
            print(f"Failed to update progress: {e}")

    def run(self, batch_size: Optional[int] = None, max_workers: Optional[int] = None, job_limit: Optional[int] = None, cooldown_seconds: Optional[float] = None):
        """Run the event processing job"""
        try:
            # Enable print capture to log all console output
            self.capture_print_output()

            self.log("INFO", f"Starting standalone event processor for job {self.job_id}")
            self.log("INFO", "Subprocess started successfully")
            self.log("INFO", "Initializing event processing components...")
            self.flush_logs()  # Force immediate flush for startup messages

            # Update job status to running
            self.supabase.table('v2_batches').update({
                'status': 'running',
                'subprocess_pid': os.getpid(),
                'started_at': datetime.now().isoformat(),
                'message': 'Initializing event processing...',
                'posts_processed': 0,
                'events_extracted': 0,
                'total_posts': 0,
                'accounts_scraped': 0,
                'total_accounts': 0,
                'current_batch': 0,
                'total_batches': 0,
                'updated_at': datetime.now().isoformat()
            }).eq('id', self.job_id).execute()

            # Create processor with cancellation callback
            self.log("INFO", "Creating EventProcessor instance...")
            processor = EventProcessor(
                job_id=self.job_id,
                cancellation_callback=self.check_control_signal,
                stats_callback=self.update_progress,
                max_workers=max_workers,
                cooldown_seconds=cooldown_seconds
            )
            self.log("INFO", f"EventProcessor created with max_workers={max_workers}, batch_size={batch_size}")
            self.flush_logs()

            # Run processing with job_limit if specified, otherwise use batch_size for backwards compatibility
            total_limit = job_limit if job_limit is not None else batch_size
            self.log("INFO", f"Starting event processing with limit={total_limit}...")
            success = processor.process_all_events(total_posts_limit=total_limit)
            
            # Get final stats from processor
            with processor.stats_lock:
                final_stats = processor.stats.copy()
            events_processed = final_stats.get('events_processed', 0)
            posts_processed = final_stats.get('posts_processed', 0)
            
            # Determine final status and message
            if self.check_control_signal():
                final_status = 'cancelled'
                message = f"Event processing cancelled. Processed {posts_processed} posts, extracted {events_processed} events."
            elif success:
                final_status = 'completed'
                message = f"Event processing completed successfully. Processed {posts_processed} posts, extracted {events_processed} events."
            else:
                final_status = 'failed'
                message = f"Event processing completed with errors. Processed {posts_processed} posts, extracted {events_processed} events."

            # Update final status
            self.supabase.table('v2_batches').update({
                'status': final_status,
                'completed_at': datetime.now().isoformat(),
                'error_log': json.dumps({'error': 'Some batches failed during processing'}) if not success else None,
                'message': message,
                'posts_processed': posts_processed,
                'events_extracted': events_processed,
                'total_posts': events_processed,  # Events count as total "posts" output
                'accounts_scraped': processor.stats.get('current_batch', processor.stats.get('total_batches', 0)),
                'total_accounts': processor.stats.get('total_batches', 0),
                'worker_stats': json.dumps(processor.stats),
                'updated_at': datetime.now().isoformat()
            }).eq('id', self.job_id).execute()

            self.log("INFO", message)
            return {"success": success, "message": message}

        except Exception as e:
            self.log("ERROR", f"Event processing failed: {str(e)}")

            # Update job status to failed
            self.supabase.table('v2_batches').update({
                'status': 'failed',
                'completed_at': datetime.now().isoformat(),
                'error_log': json.dumps({'error': str(e)}),
                'message': f"Event processing failed: {str(e)}",
                'updated_at': datetime.now().isoformat()
            }).eq('id', self.job_id).execute()

            return {"success": False, "message": str(e)}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Standalone Event Processor')
    parser.add_argument('--job-id', help='Job ID from v2_batches table (auto-generates UUID if not provided)')
    parser.add_argument('--batch-size', type=int, help='Batch size for processing')
    parser.add_argument('--max-workers', type=int, help='Maximum number of workers')
    parser.add_argument('--job-limit', type=int, help='Maximum number of posts to pull before processing')
    parser.add_argument('--cooldown-seconds', type=float, default=60.0, help='Cooldown between API calls per worker (seconds)')
    parser.add_argument('--pro', action='store_true', help='Use Gemini 2.5 Pro instead of Flash')

    args = parser.parse_args()

    # Set model based on --pro flag
    if args.pro:
        MODEL_NAME = 'gemini-2.5-pro'
        print("🚀 Using Gemini 2.5 Pro model")
    else:
        print("⚡ Using Gemini 2.5 Flash model (default)")

    # Generate UUID if job-id not provided
    job_id = args.job_id or str(uuid.uuid4())
    auto_created = not args.job_id

    # If we generated a UUID, inform the user
    if auto_created:
        print(f"🔑 Auto-generated job ID: {job_id}")

    processor = StandaloneEventProcessor(job_id, auto_create=auto_created)
    result = processor.run(batch_size=args.batch_size, max_workers=args.max_workers, job_limit=args.job_limit, cooldown_seconds=args.cooldown_seconds)

    sys.exit(0 if result.get('success') else 1)
