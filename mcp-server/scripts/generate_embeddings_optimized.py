#!/usr/bin/env python3
"""
Optimized Bulk Embedding Generator for Supabase
Using 2025 best practices: OpenAI Batch API, async processing, vecs client, and connection pooling
"""

import os
import sys
import json
import time
import asyncio
import aiohttp
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
import openai
from openai import AsyncOpenAI
import vecs
from supabase import create_client, Client
import numpy as np
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values
from psycopg2 import pool
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import tempfile
import uuid
from pathlib import Path

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# OpenAI Batch API Settings
BATCH_API_ENABLED = True  # Use Batch API for 50% cost reduction
BATCH_FILE_SIZE = 20000  # Optimal batch size per file (max 50000)
BATCH_API_WAIT_TIME = 60  # Check batch status every minute

# Embedding Models and Dimensions (2025 optimized)
EMBEDDING_MODEL = 'text-embedding-3-large'  # Better quality
EVENTS_DIMENSIONS = 768  # Keep existing for events
POSTS_DIMENSIONS = 1536  # Match existing dimensions in database
ACTORS_DIMENSIONS = 1536  # Match existing dimensions in database

# Performance Settings
CONCURRENT_API_CALLS = 10  # Parallel API calls for real-time mode
DB_FETCH_LIMIT = 50000  # Larger fetch for batch processing
DB_UPDATE_BATCH = 5000  # Larger update batches
CONNECTION_POOL_SIZE = 20  # Connection pool for parallel DB operations
MAX_WORKERS = 8  # Thread pool workers

# Direct database connection for bulk updates
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
async_openai = AsyncOpenAI(api_key=OPENAI_API_KEY)
openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

class DatabaseConnectionPool:
    """Manage a pool of database connections for parallel operations"""

    def __init__(self):
        self.pool = None
        self._initialize_pool()

    def _initialize_pool(self):
        """Initialize connection pool"""
        if not DB_HOST or not DB_PASSWORD:
            print("⚠️  Direct DB connection not configured")
            return

        try:
            self.pool = psycopg2.pool.ThreadedConnectionPool(
                5,  # Min connections
                CONNECTION_POOL_SIZE,  # Max connections
                host=DB_HOST,
                port=DB_PORT,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                sslmode='require',
                options='-c statement_timeout=600000'  # 10 minute timeout
            )
            print(f"✓ Database connection pool initialized ({CONNECTION_POOL_SIZE} connections)")
        except Exception as e:
            print(f"⚠️  Could not create connection pool: {e}")

    def get_connection(self):
        """Get a connection from the pool"""
        if self.pool:
            return self.pool.getconn()
        return None

    def return_connection(self, conn):
        """Return a connection to the pool"""
        if self.pool and conn:
            self.pool.putconn(conn)

    def close_all(self):
        """Close all connections"""
        if self.pool:
            self.pool.closeall()

# Global connection pool
db_pool = DatabaseConnectionPool()

class VecsEmbeddingManager:
    """Use Supabase vecs client for optimized vector operations"""

    def __init__(self):
        self.client = None
        self._initialize_client()

    def _initialize_client(self):
        """Initialize vecs client"""
        try:
            # Parse connection string from Supabase
            db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
            self.client = vecs.create_client(db_url)
            print("✓ Vecs client initialized for optimized vector operations")
        except Exception as e:
            print(f"⚠️  Could not initialize vecs client: {e}")

    def get_or_create_collection(self, name: str, dimensions: int):
        """Get or create a vector collection"""
        if not self.client:
            return None

        try:
            # Check if collection exists
            existing = [c.name for c in self.client.list_collections()]

            if name in existing:
                return self.client.get_collection(name)
            else:
                # Create new collection with optimized settings
                return self.client.create_collection(
                    name=name,
                    dimension=dimensions
                )
        except Exception as e:
            print(f"Error with collection {name}: {e}")
            return None

    def bulk_upsert(self, collection_name: str, records: List[Tuple[str, List[float], Dict]]):
        """Bulk upsert embeddings using vecs"""
        collection = self.get_or_create_collection(collection_name, len(records[0][1]) if records else 768)
        if not collection:
            return 0

        try:
            # Vecs expects (id, vector, metadata) tuples
            collection.upsert(records)
            return len(records)
        except Exception as e:
            print(f"Error in vecs bulk upsert: {e}")
            return 0

# Global vecs manager
vecs_manager = VecsEmbeddingManager()

class BatchAPIProcessor:
    """Handle OpenAI Batch API for 50% cost reduction"""

    def __init__(self):
        self.batch_dir = Path(tempfile.gettempdir()) / "embedding_batches"
        self.batch_dir.mkdir(exist_ok=True)

    def create_batch_file(self, texts: List[str], ids: List[str], model: str, dimensions: int) -> str:
        """Create JSONL file for batch processing"""
        batch_id = str(uuid.uuid4())
        file_path = self.batch_dir / f"batch_{batch_id}.jsonl"

        with open(file_path, 'w') as f:
            for idx, (text, item_id) in enumerate(zip(texts, ids)):
                request = {
                    "custom_id": f"{item_id}",
                    "method": "POST",
                    "url": "/v1/embeddings",
                    "body": {
                        "model": model,
                        "input": text[:8191],  # Truncate to max tokens
                        "dimensions": dimensions
                    }
                }
                f.write(json.dumps(request) + '\n')

        return str(file_path)

    def upload_batch_file(self, file_path: str) -> str:
        """Upload batch file to OpenAI"""
        with open(file_path, 'rb') as f:
            response = openai_client.files.create(
                file=f,
                purpose='batch'
            )
        return response.id

    def create_batch_job(self, file_id: str) -> str:
        """Create batch processing job"""
        batch = openai_client.batches.create(
            input_file_id=file_id,
            endpoint="/v1/embeddings",
            completion_window="24h"
        )
        return batch.id

    def check_batch_status(self, batch_id: str) -> Dict:
        """Check batch job status"""
        return openai_client.batches.retrieve(batch_id)

    def get_batch_results(self, batch_id: str) -> Dict[str, List[float]]:
        """Retrieve batch processing results"""
        batch = self.check_batch_status(batch_id)

        if batch.status != 'completed':
            return {}

        # Download result file
        result_file_id = batch.output_file_id
        result_content = openai_client.files.content(result_file_id)

        # Parse results
        embeddings_by_id = {}
        for line in result_content.text.split('\n'):
            if line.strip():
                result = json.loads(line)
                item_id = result['custom_id']
                embedding = result['response']['body']['data'][0]['embedding']
                embeddings_by_id[item_id] = embedding

        return embeddings_by_id

    async def process_batch_async(self, texts: List[str], ids: List[str], model: str, dimensions: int) -> Dict[str, List[float]]:
        """Process embeddings using Batch API with async monitoring"""
        print(f"  Creating batch job for {len(texts)} items...")

        # Create and upload batch file
        file_path = self.create_batch_file(texts, ids, model, dimensions)
        file_id = self.upload_batch_file(file_path)

        # Create batch job
        batch_id = self.create_batch_job(file_id)
        print(f"  Batch job created: {batch_id}")

        # Monitor batch status
        while True:
            batch = self.check_batch_status(batch_id)
            status = batch.status

            if status == 'completed':
                print(f"  ✓ Batch completed!")
                return self.get_batch_results(batch_id)
            elif status in ['failed', 'cancelled', 'expired']:
                print(f"  ✗ Batch {status}")
                return {}
            else:
                print(f"  Batch status: {status} (completed: {batch.request_counts.completed}/{batch.request_counts.total})")
                await asyncio.sleep(BATCH_API_WAIT_TIME)

# Global batch processor
batch_processor = BatchAPIProcessor()

async def generate_embedding_async(text: str, dimensions: int = None) -> List[float]:
    """Generate embedding using async OpenAI client"""
    try:
        params = {
            "model": EMBEDDING_MODEL,
            "input": text[:8191]  # Truncate to max tokens
        }
        if dimensions:
            params["dimensions"] = dimensions

        response = await async_openai.embeddings.create(**params)
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None

async def batch_generate_embeddings_async(texts: List[str], dimensions: int = None) -> List[List[float]]:
    """Generate embeddings concurrently using asyncio"""
    tasks = []
    for text in texts:
        task = generate_embedding_async(text, dimensions)
        tasks.append(task)

    # Process with controlled concurrency
    results = []
    for i in range(0, len(tasks), CONCURRENT_API_CALLS):
        batch_tasks = tasks[i:i + CONCURRENT_API_CALLS]
        batch_results = await asyncio.gather(*batch_tasks)
        results.extend(batch_results)

        # Small delay to respect rate limits
        if i + CONCURRENT_API_CALLS < len(tasks):
            await asyncio.sleep(0.1)

    return results

def bulk_update_with_pool(table_name: str, updates: List[Tuple[str, List[float]]]) -> int:
    """Bulk update using connection pool for parallel operations"""
    conn = db_pool.get_connection()
    if not conn:
        return 0

    try:
        cursor = conn.cursor()

        # Use appropriate column and type for each table
        if table_name == 'v2_social_media_posts':
            query = f"""
                UPDATE {table_name}
                SET embedding_half = data.embedding::halfvec(1536)
                FROM (VALUES %s) AS data(id, embedding)
                WHERE {table_name}.id = data.id::uuid
            """
        elif table_name == 'v2_events':
            query = f"""
                UPDATE {table_name}
                SET embedding_optimized = data.embedding::vector(768)
                FROM (VALUES %s) AS data(id, embedding)
                WHERE {table_name}.id = data.id::uuid
            """
        elif table_name == 'v2_actors':
            query = f"""
                UPDATE {table_name}
                SET embedding_half = data.embedding::halfvec(1536)
                FROM (VALUES %s) AS data(id, embedding)
                WHERE {table_name}.id = data.id::uuid
            """
        else:
            query = f"""
                UPDATE {table_name}
                SET embedding = data.embedding::vector
                FROM (VALUES %s) AS data(id, embedding)
                WHERE {table_name}.id = data.id::uuid
            """

        # Format embeddings as PostgreSQL vector strings
        formatted_updates = [
            (str(id_val), f"[{','.join(map(str, embedding))}]")
            for id_val, embedding in updates if embedding
        ]

        if formatted_updates:
            execute_values(cursor, query, formatted_updates, page_size=1000)
            conn.commit()
            return len(formatted_updates)
        return 0

    except Exception as e:
        print(f"Error in bulk update: {e}")
        conn.rollback()
        return 0
    finally:
        db_pool.return_connection(conn)

async def process_posts_optimized():
    """Process posts using Batch API for maximum efficiency"""
    print("\n🚀 Processing posts with Batch API (50% cost reduction)...")

    # Count total posts needing embeddings (check both columns)
    count_response = supabase.table('v2_social_media_posts')\
        .select('id', count='exact')\
        .is_('embedding_half', None)\
        .execute()

    total_count = count_response.count

    if total_count == 0:
        print("No posts need embeddings")
        return

    print(f"Found {total_count:,} posts without embeddings")

    if BATCH_API_ENABLED and total_count > 1000:
        print("Using OpenAI Batch API for cost-efficient processing...")
        await process_with_batch_api('v2_social_media_posts', POSTS_DIMENSIONS)
    else:
        print("Using real-time API with async processing...")
        await process_with_async_api('v2_social_media_posts', POSTS_DIMENSIONS)

async def process_with_batch_api(table_name: str, dimensions: int):
    """Process using OpenAI Batch API"""
    offset = 0
    processed = 0

    while True:
        # Fetch large batch
        batch_response = supabase.table(table_name)\
            .select('id, content_text, platform, author_handle')\
            .is_('embedding_half' if table_name != 'v2_events' else 'embedding_optimized', None)\
            .range(offset, offset + BATCH_FILE_SIZE - 1)\
            .execute()

        items = batch_response.data
        if not items:
            break

        # Prepare texts and IDs
        texts = []
        ids = []

        for item in items:
            if table_name == 'v2_social_media_posts':
                text = f"{item['content_text'] or ''}"
                if item['platform']:
                    text = f"[{item['platform']}] {text}"
                if item['author_handle']:
                    text = f"@{item['author_handle']}: {text}"
            else:
                text = prepare_text_for_embedding(item, table_name)

            texts.append(text)
            ids.append(item['id'])

        # Process batch
        embeddings_by_id = await batch_processor.process_batch_async(texts, ids, EMBEDDING_MODEL, dimensions)

        # Bulk update
        updates = [(id_val, embeddings_by_id[id_val]) for id_val in ids if id_val in embeddings_by_id]

        if updates:
            # Use parallel updates with connection pool
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                # Split updates into chunks for parallel processing
                chunk_size = len(updates) // MAX_WORKERS + 1
                chunks = [updates[i:i+chunk_size] for i in range(0, len(updates), chunk_size)]

                futures = []
                for chunk in chunks:
                    future = executor.submit(bulk_update_with_pool, table_name, chunk)
                    futures.append(future)

                # Collect results
                for future in futures:
                    processed += future.result()

            print(f"  ✓ Processed batch: {processed:,}/{total_count:,} items")

        offset += BATCH_FILE_SIZE

async def process_with_async_api(table_name: str, dimensions: int):
    """Process using async real-time API calls"""
    offset = 0
    processed = 0

    # Get total count
    embedding_col = 'embedding_half' if table_name != 'v2_events' else 'embedding_optimized'
    count_response = supabase.table(table_name)\
        .select('id', count='exact')\
        .is_(embedding_col, None)\
        .execute()

    total_count = count_response.count

    while offset < total_count:
        # Fetch batch
        embedding_col = 'embedding_half' if table_name != 'v2_events' else 'embedding_optimized'
        batch_response = supabase.table(table_name)\
            .select('*')\
            .is_(embedding_col, None)\
            .range(offset, offset + DB_FETCH_LIMIT - 1)\
            .execute()

        items = batch_response.data
        if not items:
            break

        print(f"\nProcessing {offset + 1} to {min(offset + len(items), total_count)}...")

        # Process in smaller batches for API
        for i in range(0, len(items), 100):
            batch = items[i:i + 100]

            # Prepare texts
            texts = []
            for item in batch:
                text = prepare_text_for_embedding(item, table_name)
                texts.append(text)

            # Generate embeddings asynchronously
            embeddings = await batch_generate_embeddings_async(texts, dimensions)

            # Prepare updates
            updates = [(item['id'], emb) for item, emb in zip(batch, embeddings) if emb]

            # Bulk update
            if updates:
                updated = bulk_update_with_pool(table_name, updates)
                processed += updated
                print(f"  ✓ Updated {updated} items (Total: {processed:,})")

        offset += DB_FETCH_LIMIT

def prepare_text_for_embedding(item: Dict, table_name: str) -> str:
    """Prepare text for embedding based on table type"""
    if table_name == 'v2_social_media_posts':
        text = f"{item.get('content_text', '')}"
        if item.get('platform'):
            text = f"[{item['platform']}] {text}"
        if item.get('author_handle'):
            text = f"@{item['author_handle']}: {text}"
        return text

    elif table_name == 'v2_events':
        text_parts = []
        if item.get('event_name'):
            text_parts.append(item['event_name'])
        if item.get('event_description'):
            text_parts.append(item['event_description'])
        if item.get('category_tags'):
            tags = ' '.join(item['category_tags']) if isinstance(item['category_tags'], list) else ''
            if tags:
                text_parts.append(f"Tags: {tags}")
        if item.get('city') and item.get('state'):
            text_parts.append(f"Location: {item['city']}, {item['state']}")
        return ' | '.join(text_parts)

    elif table_name == 'v2_actors':
        text_parts = []
        if item.get('name'):
            text_parts.append(item['name'])
        if item.get('actor_type'):
            text_parts.append(f"Type: {item['actor_type']}")
        if item.get('about'):
            text_parts.append(item['about'])
        if item.get('city') and item.get('state'):
            text_parts.append(f"Location: {item['city']}, {item['state']}")
        return ' | '.join(text_parts)

    return ""

async def process_all_tables():
    """Process all tables with optimized methods"""
    start_time = time.time()

    # Process events (smallest dataset)
    print("\n📊 Processing events...")
    await process_with_async_api('v2_events', EVENTS_DIMENSIONS)

    # Process actors (medium dataset)
    print("\n👥 Processing actors...")
    await process_with_async_api('v2_actors', ACTORS_DIMENSIONS)

    # Process posts (largest dataset - use Batch API)
    await process_posts_optimized()

    elapsed = time.time() - start_time
    print(f"\n✅ All processing complete in {elapsed/60:.1f} minutes!")

def estimate_costs_and_time():
    """Estimate costs and time with Batch API savings"""
    print("📊 Analyzing workload...")

    # Count items needing embeddings
    posts_count = supabase.table('v2_social_media_posts')\
        .select('id', count='exact')\
        .is_('embedding_half', None)\
        .execute()

    events_count = supabase.table('v2_events')\
        .select('id', count='exact')\
        .is_('embedding_optimized', None)\
        .execute()

    actors_count = supabase.table('v2_actors')\
        .select('id', count='exact')\
        .is_('embedding_half', None)\
        .execute()

    total_items = posts_count.count + events_count.count + actors_count.count

    if total_items == 0:
        print("No embeddings need to be generated!")
        return False

    # Estimate tokens
    avg_tokens_per_item = 200
    total_tokens = total_items * avg_tokens_per_item

    # Cost calculation with Batch API discount
    cost_per_million_tokens = 0.13  # text-embedding-3-large

    # Posts use Batch API (50% discount)
    posts_cost = (posts_count.count * avg_tokens_per_item / 1_000_000) * cost_per_million_tokens * 0.5

    # Events and actors use regular API
    others_cost = ((events_count.count + actors_count.count) * avg_tokens_per_item / 1_000_000) * cost_per_million_tokens

    total_cost = posts_cost + others_cost

    # Time estimation
    if BATCH_API_ENABLED and posts_count.count > 1000:
        # Batch API: up to 24 hours but usually faster
        batch_time_hours = min(24, posts_count.count / 50000 * 2)  # Estimate 2 hours per 50k
        async_time_minutes = (events_count.count + actors_count.count) / 100 * 0.2 / 60
        total_time_hours = batch_time_hours + async_time_minutes / 60
    else:
        # Async processing only
        api_calls = total_items / 100
        total_time_hours = (api_calls * 0.2) / 3600

    print(f"\n📈 Embedding Generation Estimate:")
    print(f"  Posts: {posts_count.count:,} (Batch API - 50% discount)")
    print(f"  Events: {events_count.count:,}")
    print(f"  Actors: {actors_count.count:,}")
    print(f"  Total items: {total_items:,}")
    print(f"\n💰 Cost Estimate:")
    print(f"  Regular cost: ${(total_tokens / 1_000_000 * cost_per_million_tokens):.2f}")
    print(f"  With Batch API: ${total_cost:.2f} (saved ${(total_tokens / 1_000_000 * cost_per_million_tokens - total_cost):.2f})")
    print(f"\n⏱️  Time Estimate:")
    if BATCH_API_ENABLED and posts_count.count > 1000:
        print(f"  Batch processing: ~{batch_time_hours:.1f} hours")
        print(f"  Async processing: ~{async_time_minutes:.1f} minutes")
    print(f"  Total: ~{total_time_hours:.1f} hours")

    if posts_count.count > 100000:
        print(f"\n💡 Pro Tips:")
        print("  • Large batch jobs complete faster during off-peak hours")
        print("  • Monitor progress with batch status checks")
        print("  • Consider running overnight for best performance")

    return True

async def main():
    """Main execution function"""
    print("=== 🚀 Optimized Embedding Generator 2025 ===")
    print(f"Model: {EMBEDDING_MODEL}")
    print(f"Batch API: {'Enabled (50% cost savings)' if BATCH_API_ENABLED else 'Disabled'}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    # Check if we need to generate embeddings
    if not estimate_costs_and_time():
        return

    # Confirm before proceeding
    response = input("\n🔥 Ready to generate embeddings? (y/n): ")
    if response.lower() != 'y':
        print("Aborted.")
        return

    try:
        # Run async processing
        await process_all_tables()

        print("\n🎉 Success! All embeddings generated with maximum efficiency!")

    except Exception as e:
        print(f"\n❌ Error during processing: {e}")
        sys.exit(1)
    finally:
        # Clean up
        db_pool.close_all()
        if vecs_manager.client:
            vecs_manager.client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())