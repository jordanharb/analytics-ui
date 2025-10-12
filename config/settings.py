"""
Configuration settings for TPUSA Social Media Monitoring System
"""
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Multi-worker Supabase configuration
SUPABASE_RPS_PER_KEY = int(os.environ.get("SUPABASE_RPS_PER_KEY", "15"))  # Increased from 5
SUPABASE_RPS = int(os.environ.get("SUPABASE_RPS", "5"))  # Fallback for single key usage

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

# AI Provider Configuration
AI_PROVIDER = os.environ.get("AI_PROVIDER", "gemini").lower()  # 'gemini' or 'openai'

# Google AI Configuration
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

# OpenAI Configuration
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
OPENAI_MAX_TOKENS = int(os.environ.get("OPENAI_MAX_TOKENS", "4096"))
OPENAI_TEMPERATURE = float(os.environ.get("OPENAI_TEMPERATURE", "0.2"))
OPENAI_VERBOSITY = os.environ.get("OPENAI_VERBOSITY", "medium")  # low, medium, high for GPT-5
OPENAI_REASONING_EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "minimal")  # minimal, default, high for GPT-5
USE_FILE_SEARCH = os.environ.get("USE_FILE_SEARCH", "true").lower() == "true"
FALLBACK_TO_GEMINI = os.environ.get("FALLBACK_TO_GEMINI", "true").lower() == "true"

# Google Maps API Configuration (for geocoding)
GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")

# Application Settings
DEBUG = os.environ.get("DEBUG", "False").lower() == "true"
TEST_MODE = os.environ.get("TEST_MODE", "False").lower() == "true"

# Scraping Configuration
MAX_RESULTS_PER_USER = int(os.environ.get("MAX_RESULTS_PER_USER", "10000"))
LEGACY_BATCH_SIZE = int(os.environ.get("POSTS_PER_BATCH", "1000"))  # Deprecated - kept for backwards compatibility
POSTS_PER_BATCH = LEGACY_BATCH_SIZE  # Alias for backwards compatibility
MAX_POSTS_PER_BATCH = int(os.environ.get("MAX_POSTS_PER_BATCH", "50"))  # Maximum posts per AI processing batch
MAX_RETRIES = int(os.environ.get("MAX_RETRIES", "10"))
NUM_ACCOUNTS = int(os.environ.get("NUM_ACCOUNTS", "75"))

# Twitter-specific performance settings
TWITTER_CONCURRENT_BATCH_SIZE = int(os.environ.get("TWITTER_CONCURRENT_BATCH_SIZE", "8"))
TWITTER_BATCH_DELAY = int(os.environ.get("TWITTER_BATCH_DELAY", "3"))
TWITTER_SAVE_BATCH_SIZE = int(os.environ.get("TWITTER_SAVE_BATCH_SIZE", "50"))

# Event Processing Configuration
# MAX_IMAGES_PER_BATCH = int(os.environ.get("MAX_IMAGES_PER_BATCH", "20"))  # Removed - now just counting tokens

# V2 Schema Configuration
USE_V2_SCHEMA = os.environ.get("USE_V2_SCHEMA", "True").lower() == "true"
DEFAULT_PROJECT_ID = os.environ.get("DEFAULT_PROJECT_ID", "8afb9c8f-04b2-4510-a898-0d3ca10f155a")

# Token-based batching for Gemini 2.5 Pro (1M token limit)
MAX_TOKENS_PER_BATCH = int(os.environ.get("MAX_TOKENS_PER_BATCH", "400000"))  # Conservative limit for stability
AVERAGE_TOKENS_PER_POST = int(os.environ.get("AVERAGE_TOKENS_PER_POST", "500"))
AVERAGE_TOKENS_PER_IMAGE = int(os.environ.get("AVERAGE_TOKENS_PER_IMAGE", "300"))  # Per Google AI Studio
SYSTEM_PROMPT_TOKENS = int(os.environ.get("SYSTEM_PROMPT_TOKENS", "15000"))
# BATCH_SIZE_LIMIT removed - only token limits matter for batching

# Date-range clustering configuration  
DATE_CLUSTERING_ENABLED = os.environ.get("DATE_CLUSTERING_ENABLED", "True").lower() == "true"
MAX_DATE_RANGE_DAYS = int(os.environ.get("MAX_DATE_RANGE_DAYS", "3"))
PRIORITIZE_RECENT_POSTS = os.environ.get("PRIORITIZE_RECENT_POSTS", "True").lower() == "true"

# Test mode configuration
MAX_TEST_RECORDS = int(os.environ.get("MAX_TEST_RECORDS", "100"))
TEST_BATCH_LIMIT = int(os.environ.get("TEST_BATCH_LIMIT", "0"))

# Profile scraping configuration
FORCE_RESCRAPE = os.environ.get("FORCE_RESCRAPE", "False").lower() == "true"
DAYS_BEFORE_RECHECK = int(os.environ.get("DAYS_BEFORE_RECHECK", "30"))

# File Paths
# Use /tmp for serverless environments (Vercel, AWS Lambda)
IS_SERVERLESS_ENV = os.environ.get("VERCEL", os.environ.get("AWS_LAMBDA_FUNCTION_NAME")) is not None
DEFAULT_OUTPUT_DIR = "/tmp/data/output" if IS_SERVERLESS_ENV else "data/output"
DEFAULT_COOKIE_CSV = "/tmp/data/cookies_master.csv" if IS_SERVERLESS_ENV else "data/cookies_master.csv"

COOKIE_CSV = os.environ.get("COOKIE_CSV", DEFAULT_COOKIE_CSV)
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", DEFAULT_OUTPUT_DIR)

# AI Provider Configuration
AI_PROVIDER = os.environ.get('AI_PROVIDER', 'gemini').lower()  # 'gemini' or 'openai'

# Gemini Configuration
MODEL_NAME = 'gemini-2.5-pro'

# OpenAI Configuration
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-5-mini')
OPENAI_MAX_TOKENS = int(os.environ.get('OPENAI_MAX_TOKENS', '4096'))
OPENAI_TEMPERATURE = float(os.environ.get('OPENAI_TEMPERATURE', '0.2'))
OPENAI_VERBOSITY = os.environ.get('OPENAI_VERBOSITY', 'medium')  # low, medium, high
OPENAI_REASONING_EFFORT = os.environ.get('OPENAI_REASONING_EFFORT', 'minimal')  # minimal for faster responses

# Token Optimization Configuration
TOKEN_OPTIMIZATION_ENABLED = os.environ.get('TOKEN_OPTIMIZATION_ENABLED', 'true').lower() == 'true'
USE_IMAGE_GRIDS = os.environ.get('USE_IMAGE_GRIDS', 'false').lower() == 'true'
USE_COMPACT_FORMAT = os.environ.get('USE_COMPACT_FORMAT', 'true').lower() == 'true'
USE_CSV_ACTOR_BIOS = os.environ.get('USE_CSV_ACTOR_BIOS', 'true').lower() == 'true'

# Image Grid Settings
GRID_SIZE = (2, 2)  # 2x2 grid
GRID_TARGET_SIZE = (768, 768)  # Total grid size in pixels
MAX_IMAGES_PER_GRID = 4
IMAGE_GRID_QUALITY = int(os.environ.get('IMAGE_GRID_QUALITY', '85'))  # JPEG quality

# Validation
def validate_config():
    """Validate that required configuration is present"""
    required_vars = [
        ("SUPABASE_URL", SUPABASE_URL),
        ("SUPABASE_KEY", SUPABASE_KEY),
        ("GOOGLE_API_KEY", GOOGLE_API_KEY)
    ]
    
    missing_vars = []
    for var_name, var_value in required_vars:
        if not var_value:
            missing_vars.append(var_name)
    
    if missing_vars:
        raise ValueError(
            f"Missing required environment variables: {', '.join(missing_vars)}\n"
            f"Please check your .env file and ensure all required variables are set."
        )

# Validate configuration on import
if not DEBUG:
    validate_config()

# Create output directories (skip in serverless environments like Vercel)
# Check if we're in a serverless/Vercel environment
IS_SERVERLESS = os.environ.get("VERCEL", os.environ.get("AWS_LAMBDA_FUNCTION_NAME")) is not None

if not IS_SERVERLESS:
    try:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        os.makedirs(os.path.dirname(COOKIE_CSV), exist_ok=True)
    except OSError as e:
        # Ignore errors in read-only filesystems
        if "Read-only file system" not in str(e) and "[Errno 30]" not in str(e):
            print(f"Warning: Could not create directories: {e}")
        pass