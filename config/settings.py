"""Configuration settings for Automation Standalone."""

import os
from pathlib import Path

from dotenv import load_dotenv


# Load environment variables from the nearest .env irrespective of the CWD
_CONFIG_PATH = Path(__file__).resolve()
_ENV_CANDIDATES = [
    (_CONFIG_PATH.parents[i] / '.env')
    for i in range(min(5, len(_CONFIG_PATH.parents)))
]
_ENV_CANDIDATES.append(Path.cwd() / '.env')

for _candidate in _ENV_CANDIDATES:
    if _candidate.is_file():
        load_dotenv(_candidate)
        break
else:
    # Fall back to default discovery when no candidate matched
    load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Multi-worker Supabase configuration
SUPABASE_RPS_PER_KEY = int(os.environ.get("SUPABASE_RPS_PER_KEY", "15"))
SUPABASE_RPS = int(os.environ.get("SUPABASE_RPS", "5"))

# Load multiple service keys for worker threads
SUPABASE_SERVICE_KEYS = []
for i in range(1, 9):  # Support up to 8 worker keys
    key = os.environ.get(f"SUPABASE_SERVICE_KEY_{i}")
    if key:
        SUPABASE_SERVICE_KEYS.append(key)

# If no multi-keys found, use primary key for all workers
if not SUPABASE_SERVICE_KEYS:
    SUPABASE_SERVICE_KEYS = [SUPABASE_SERVICE_KEY] if SUPABASE_SERVICE_KEY else []

# Worker configuration
MAX_WORKERS_ENV = int(os.environ.get("MAX_WORKERS", "0"))  # 0 means auto-detect from keys

# Google AI Configuration
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

# Google Maps API Configuration (for geocoding)
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")

# Application Settings
DEBUG = os.environ.get("DEBUG", "False").lower() == "true"
TEST_MODE = os.environ.get("TEST_MODE", "False").lower() == "true"
MAX_TEST_RECORDS = int(os.environ.get("MAX_TEST_RECORDS", "100"))
TEST_BATCH_LIMIT = int(os.environ.get("TEST_BATCH_LIMIT", "10"))

# V2 Schema Configuration
USE_V2_SCHEMA = os.environ.get("USE_V2_SCHEMA", "True").lower() == "true"
DEFAULT_PROJECT_ID = os.environ.get("DEFAULT_PROJECT_ID", "8afb9c8f-04b2-4510-a898-0d3ca10f155a")

# Scraping Configuration
MAX_RESULTS_PER_USER = int(os.environ.get("MAX_RESULTS_PER_USER", "10000"))
NUM_ACCOUNTS = int(os.environ.get("NUM_ACCOUNTS", "75"))

# Twitter-specific performance settings
TWITTER_CONCURRENT_BATCH_SIZE = int(os.environ.get("TWITTER_CONCURRENT_BATCH_SIZE", "8"))  # Number of accounts to scrape concurrently
TWITTER_BATCH_DELAY = int(os.environ.get("TWITTER_BATCH_DELAY", "10"))
TWITTER_SAVE_BATCH_SIZE = int(os.environ.get("TWITTER_SAVE_BATCH_SIZE", "50"))
PROFILE_SCRAPER_CONCURRENCY = int(os.environ.get("PROFILE_SCRAPER_CONCURRENCY", "20"))

# Event processing settings (defaults - can be overridden by automation_settings table)
POSTS_PER_BATCH = int(os.environ.get("POSTS_PER_BATCH", "1000"))
MAX_POSTS_PER_BATCH = int(os.environ.get("MAX_POSTS_PER_BATCH", "50"))
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "10"))
MAX_DATE_RANGE_DAYS = int(os.environ.get("MAX_DATE_RANGE_DAYS", "30"))
PRIORITIZE_RECENT_POSTS = os.environ.get("PRIORITIZE_RECENT_POSTS", "True").lower() == "true"
DATE_CLUSTERING_ENABLED = os.environ.get("DATE_CLUSTERING_ENABLED", "True").lower() == "true"

# Token-based batching for Gemini (defaults - can be overridden at runtime)
MAX_TOKENS_PER_BATCH = int(os.environ.get("MAX_TOKENS_PER_BATCH", "200000"))
AVERAGE_TOKENS_PER_POST = int(os.environ.get("AVERAGE_TOKENS_PER_POST", "500"))
AVERAGE_TOKENS_PER_IMAGE = int(os.environ.get("AVERAGE_TOKENS_PER_IMAGE", "300"))
SYSTEM_PROMPT_TOKENS = int(os.environ.get("SYSTEM_PROMPT_TOKENS", "15000"))

# File Paths
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "data/output")
COOKIE_CSV = os.environ.get("COOKIE_CSV", "data/cookies_master.csv")

# Ensure output directory exists
os.makedirs(OUTPUT_DIR, exist_ok=True)
