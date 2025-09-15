"""
utils/database.py  –  ONE-STOP Supabase helper for TPUSA Social-Monitoring
Compatible with supabase >= 2.17.0
"""

import logging
import threading
import time
import re
from typing import Any, Dict, List

from supabase import Client, create_client
from supabase.client import ClientOptions          # ← correct import for options
from config.settings import (
    SUPABASE_URL,
    SUPABASE_KEY,
    SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_KEYS,
    SUPABASE_RPS,
    SUPABASE_RPS_PER_KEY,
)

# Custom client wrapper for new key format
class ServiceKeyClient:
    """Wrapper client for new sb_ format service keys."""
    
    def __init__(self, supabase_url: str, supabase_key: str, options=None):
        """Initialize with new sb_ format key, bypassing JWT validation."""
        from postgrest import SyncPostgrestClient
        from storage3 import SyncStorageClient
        
        self.supabase_url = supabase_url
        self.supabase_key = supabase_key
        self.options = options or ClientOptions()
        
        # Initialize headers
        self.options.headers.update({
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        })
        
        # Set URLs
        self.rest_url = f"{supabase_url}/rest/v1"
        self.realtime_url = f"{supabase_url}/realtime/v1".replace("http", "ws")
        self.auth_url = f"{supabase_url}/auth/v1"
        self.storage_url = f"{supabase_url}/storage/v1"
        self.functions_url = f"{supabase_url}/functions/v1"
        
        # Initialize PostgreSQL client
        self.postgrest = SyncPostgrestClient(
            self.rest_url,
            headers=self.options.headers.copy(),
            schema=getattr(self.options.db, 'schema', 'public') if hasattr(self.options, 'db') else 'public',
            verify=getattr(self.options.db, 'verify', True) if hasattr(self.options, 'db') else True,
            timeout=getattr(self.options, 'postgrest_client_timeout', 60),
        )
        
        # Initialize storage client
        self.storage = SyncStorageClient(
            self.storage_url,
            self.options.headers.copy(),
            getattr(self.options, 'storage_client_timeout', 60)
        )
        
        # Minimal auth/realtime/functions for compatibility
        self.auth = None
        self.realtime = None
        self.functions = None
    
    def table(self, name: str):
        """Access a table."""
        return self.postgrest.from_(name)
    
    def rpc(self, fn: str, params=None):
        """Call an RPC function."""
        return self.postgrest.rpc(fn, params)

# Create client with appropriate method
def _create_client_with_new_key(supabase_url: str, supabase_key: str, options=None):
    """Create Supabase client, bypassing JWT validation for new sb_ format keys."""
    from supabase._sync.client import SupabaseException
    
    if not supabase_url:
        raise SupabaseException("supabase_url is required")
    if not supabase_key:
        raise SupabaseException("supabase_key is required")
    
    # Check if the url is valid
    if not re.match(r"^(https?)://.+", supabase_url):
        raise SupabaseException("Invalid URL")
    
    # For new sb_ format keys, use our custom wrapper
    if supabase_key.startswith('sb_'):
        logger.info("Creating client with new sb_ format key using ServiceKeyClient")
        return ServiceKeyClient(supabase_url, supabase_key, options)
    else:
        # For old JWT format, use original create_client
        return create_client(supabase_url, supabase_key, options)

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------------------
# Singleton Supabase client
# ------------------------------------------------------------------------------


class _SupabaseSingleton:
    """Lazily-initialised, 1-per-process Supabase client."""

    _client: Client | None = None

    @classmethod
    def get(cls) -> Client:
        if cls._client is None:
            cls._client = cls._create_client()
        return cls._client

    @classmethod
    def _create_client(cls) -> Client:
        """Build the client with generous PostgREST & Storage time-outs."""
        key = SUPABASE_SERVICE_KEY or SUPABASE_KEY
        opts = ClientOptions(
            postgrest_client_timeout=60,
            storage_client_timeout=60,
            schema="public",
        )
        # Use our custom function that handles new key format
        client = _create_client_with_new_key(SUPABASE_URL, key, options=opts)
        logger.info("✅ Supabase client initialised (60 s PostgREST timeout)")
        return client


# Public accessor --------------------------------------------------------------


def get_supabase() -> Client:
    """Return the singleton Supabase Client (creates it on first call)."""
    return _SupabaseSingleton.get()


# ------------------------------------------------------------------------------
# Convenience helpers
# ------------------------------------------------------------------------------


def call_supabase_function(func: str, params: Dict[str, Any] | None = None) -> Any:
    """Invoke a Postgres stored procedure (RPC)."""
    params = params or {}
    logger.info("🔧 RPC: %s(%s)", func, params)
    return get_supabase().rpc(func, params).execute()


def verify_connection() -> bool:
    """Ping the DB (select 1 row) to ensure the connection works."""
    try:
        _ = (
            get_supabase()
            .table("social_media_posts")
            .select("id")
            .limit(1)
            .execute()
        )
        logger.info("✅ Supabase connectivity verified")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("❌ Supabase connectivity FAILED: %s", exc)
        return False


def get_table_counts(
    tables: List[str] | None = None,
) -> Dict[str, int | None]:
    """Return row-counts for the supplied tables (or a default list)."""
    default = [
        "social_media_posts",
        "unknown_actors",
        "actor_usernames",
        "events",
        "people",
        "organizations",
        "chapters",
    ]
    tables = tables or default

    stats: Dict[str, int | None] = {}
    for t in tables:
        try:
            res = get_supabase().table(t).select("id", count="exact").execute()
            stats[t] = res.count
        except Exception as exc:  # noqa: BLE001
            logger.warning("⚠️  Could not count %s: %s", t, exc)
            stats[t] = None
    return stats


def fetch_all_rows(query, batch_size: int = 1000) -> List[Dict[str, Any]]:
    """
    Paginate through a Supabase query and return all rows.

    The incoming query *must* be ordered for stable pagination.
    """
    rows: List[Dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            query.range(offset, offset + batch_size - 1)
            .execute()
            .data
            or []
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size
        if offset % (batch_size * 10) == 0:
            logger.info("…fetched %s rows so far", len(rows))
    logger.info("Fetched %s total rows", len(rows))
    return rows


class SupabaseRateLimiter:
    """Simple rate limiter for Supabase requests."""

    def __init__(self, max_requests_per_sec: float = SUPABASE_RPS):
        self.max_requests_per_sec = max_requests_per_sec
        self._lock = threading.Lock()
        self._last_request = 0.0

    def wait(self) -> None:
        if self.max_requests_per_sec <= 0:
            return
        min_interval = 1.0 / self.max_requests_per_sec
        with self._lock:
            now = time.time()
            elapsed = now - self._last_request
            if elapsed < min_interval:
                time.sleep(min_interval - elapsed)
            self._last_request = time.time()


# ------------------------------------------------------------------------------
# Multi-Worker Supabase Support
# ------------------------------------------------------------------------------

class MultiKeySupabaseManager:
    """Manages multiple Supabase clients with different service keys for multi-threading."""
    
    def __init__(self):
        self.clients = {}
        self.rate_limiters = {}
        self._lock = threading.Lock()
        self._initialize_clients()
    
    def _initialize_clients(self):
        """Initialize clients for all available service keys."""
        if not SUPABASE_SERVICE_KEYS:
            logger.warning("⚠️ No SUPABASE_SERVICE_KEYS found. Multi-key support disabled.")
            return
            
        for i, service_key in enumerate(SUPABASE_SERVICE_KEYS):
            client_id = f"worker_{i}"
            opts = ClientOptions(
                postgrest_client_timeout=60,
                storage_client_timeout=60,
                schema="public",
            )
            # Use our custom function that handles new key format
            self.clients[client_id] = _create_client_with_new_key(SUPABASE_URL, service_key, options=opts)
            self.rate_limiters[client_id] = SupabaseRateLimiter(SUPABASE_RPS_PER_KEY)
            logger.info(f"✅ Supabase client '{client_id}' initialized with dedicated service key")
    
    def get_client_for_worker(self, worker_id: int) -> Client:
        """Get a dedicated Supabase client for a specific worker."""
        if not self.clients:
            # Fallback to singleton if no multi-keys configured
            return get_supabase()
        
        # Cycle through available clients
        client_keys = list(self.clients.keys())
        client_id = client_keys[worker_id % len(client_keys)]
        return self.clients[client_id]
    
    def get_rate_limiter_for_worker(self, worker_id: int) -> SupabaseRateLimiter:
        """Get the rate limiter for a specific worker."""
        if not self.rate_limiters:
            # Fallback to default rate limiter
            return SupabaseRateLimiter(SUPABASE_RPS)
        
        # Cycle through available rate limiters
        limiter_keys = list(self.rate_limiters.keys())
        client_id = limiter_keys[worker_id % len(limiter_keys)]
        return self.rate_limiters[client_id]
    
    def get_max_workers(self) -> int:
        """Get the maximum number of workers based on available keys."""
        return len(self.clients) if self.clients else 1


# Global instance for multi-key management
_multi_key_manager = None

def get_multi_key_manager() -> MultiKeySupabaseManager:
    """Get the global multi-key manager instance."""
    global _multi_key_manager
    if _multi_key_manager is None:
        _multi_key_manager = MultiKeySupabaseManager()
    return _multi_key_manager

def get_supabase_for_worker(worker_id: int) -> Client:
    """Get a dedicated Supabase client for a specific worker thread."""
    return get_multi_key_manager().get_client_for_worker(worker_id)

def get_rate_limiter_for_worker(worker_id: int) -> SupabaseRateLimiter:
    """Get a dedicated rate limiter for a specific worker thread."""
    return get_multi_key_manager().get_rate_limiter_for_worker(worker_id)
