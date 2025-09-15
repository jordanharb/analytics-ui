#!/usr/bin/env python3
"""
Generate embeddings for posts and events using OpenAI's embedding API
Optimized for batch processing to minimize API costs and time
"""

import os
import sys
import json
import time
from datetime import datetime
from typing import List, Dict, Any
import openai
from supabase import create_client, Client
import numpy as np
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values

# Load environment variables
load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
EMBEDDING_MODEL = os.getenv('EMBEDDING_MODEL', 'text-embedding-3-small')

# Direct database connection for bulk updates (much faster)
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# Different dimensions for different tables
EVENTS_DIMENSIONS = 768  # Keep existing event embeddings
POSTS_DIMENSIONS = 1536  # Better quality for rhetoric analysis
ACTORS_DIMENSIONS = 1536  # Better quality for entity matching

# Batch settings
BATCH_SIZE = 100  # Items per API call (OpenAI max)
DB_FETCH_LIMIT = 10000  # How many items to fetch from DB at once
DB_UPDATE_BATCH = 1000  # Update this many records in single transaction
MAX_TOKENS = 8191  # Max tokens for embedding model

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai.api_key = OPENAI_API_KEY

def get_db_connection():
    """Get direct PostgreSQL connection for bulk operations"""
    if not DB_HOST or not DB_PASSWORD:
        print("⚠️  Direct DB connection not configured. Using Supabase client (slower).")
        print("   For faster updates, add DB_HOST and DB_PASSWORD to .env")
        return None

    try:
        # Connection string for Supabase pooler
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            sslmode='require',  # Supabase requires SSL
            options='-c statement_timeout=300000'  # 5 minute timeout for bulk operations
        )
        print("✓ Connected directly to PostgreSQL via Supabase Pooler for fast bulk updates")
        return conn
    except Exception as e:
        print(f"⚠️  Could not connect directly to DB: {e}")
        print("   Falling back to Supabase client (slower)")
        return None

def truncate_text(text: str, max_tokens: int = MAX_TOKENS) -> str:
    """Truncate text to fit within token limits"""
    # Rough estimation: 1 token ≈ 4 characters
    max_chars = max_tokens * 4
    if len(text) > max_chars:
        return text[:max_chars]
    return text

def generate_embedding(text: str, dimensions: int = None) -> List[float]:
    """Generate embedding for a single text with optional dimension specification"""
    try:
        params = {
            "model": EMBEDDING_MODEL,
            "input": truncate_text(text)
        }
        if dimensions:
            params["dimensions"] = dimensions

        response = openai.embeddings.create(**params)
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None

def batch_generate_embeddings(texts: List[str], dimensions: int = None) -> List[List[float]]:
    """Generate embeddings for multiple texts in a single API call"""
    try:
        # Truncate all texts
        truncated_texts = [truncate_text(text) for text in texts]

        params = {
            "model": EMBEDDING_MODEL,
            "input": truncated_texts
        }
        if dimensions:
            params["dimensions"] = dimensions

        response = openai.embeddings.create(**params)

        return [data.embedding for data in response.data]
    except Exception as e:
        print(f"Error generating batch embeddings: {e}")
        return [None] * len(texts)

def bulk_update_embeddings_postgres(conn, table_name: str, updates: List[tuple]):
    """Bulk update embeddings using direct PostgreSQL connection"""
    if not conn:
        return 0

    try:
        cursor = conn.cursor()

        # Prepare bulk update query
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
            execute_values(cursor, query, formatted_updates)
            conn.commit()
            return len(formatted_updates)
        return 0

    except Exception as e:
        print(f"Error in bulk update: {e}")
        conn.rollback()
        return 0

def bulk_update_embeddings_supabase(table_name: str, updates: List[tuple]):
    """Fallback method using Supabase client (slower but works without direct DB)"""
    success_count = 0

    for id_val, embedding in updates:
        if embedding:
            try:
                embedding_str = '[' + ','.join(map(str, embedding)) + ']'
                response = supabase.table(table_name).update({
                    'embedding': embedding_str
                }).eq('id', id_val).execute()

                if response.data:
                    success_count += 1
            except Exception as e:
                print(f"Error updating {id_val}: {e}")

    return success_count

def process_posts_embeddings(conn=None):
    """Generate embeddings for social media posts"""
    print("\nProcessing social media posts (1536 dimensions)...")

    # Count total posts needing embeddings
    count_response = supabase.table('v2_social_media_posts')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    total_count = count_response.count

    if total_count == 0:
        print("No posts need embeddings")
        return

    print(f"Found {total_count:,} posts without embeddings")
    print(f"This will process in batches of {BATCH_SIZE} for API calls")

    processed = 0
    offset = 0

    while offset < total_count:
        # Fetch batch from database
        batch_response = supabase.table('v2_social_media_posts')\
            .select('id, content_text, platform, author_handle')\
            .is_('embedding', None)\
            .range(offset, offset + DB_FETCH_LIMIT - 1)\
            .execute()

        posts = batch_response.data
        if not posts:
            break

        print(f"\nProcessing posts {offset + 1} to {min(offset + len(posts), total_count)}...")

        # Process in API batches
        for i in range(0, len(posts), BATCH_SIZE):
            batch = posts[i:i + BATCH_SIZE]

            # Prepare texts for embedding
            texts = []
            for post in batch:
                text = f"{post['content_text'] or ''}"
                if post['platform']:
                    text = f"[{post['platform']}] {text}"
                if post['author_handle']:
                    text = f"@{post['author_handle']}: {text}"
                texts.append(text)

            # Generate embeddings with 1536 dimensions
            embeddings = batch_generate_embeddings(texts, dimensions=POSTS_DIMENSIONS)

            # Prepare updates
            updates = [(post['id'], emb) for post, emb in zip(batch, embeddings) if emb]

            # Bulk update
            if updates:
                if conn:
                    updated = bulk_update_embeddings_postgres(conn, 'v2_social_media_posts', updates)
                else:
                    updated = bulk_update_embeddings_supabase('v2_social_media_posts', updates)

                processed += updated
                print(f"  ✓ Updated {updated} posts (Total: {processed:,}/{total_count:,})")

            # Rate limiting
            time.sleep(0.2)

        offset += DB_FETCH_LIMIT

    print(f"\n✅ Completed posts: {processed:,} embeddings generated")

def process_events_embeddings(conn=None):
    """Generate embeddings for events"""
    print("\nProcessing events (768 dimensions - keeping existing)...")

    # Count total events needing embeddings
    count_response = supabase.table('v2_events')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    total_count = count_response.count

    if total_count == 0:
        print("No events need embeddings")
        return

    print(f"Found {total_count} events without embeddings")

    # Fetch all events (small dataset)
    response = supabase.table('v2_events')\
        .select('id, event_name, event_description, category_tags, city, state')\
        .is_('embedding', None)\
        .execute()

    events = response.data
    processed = 0

    # Process in batches
    for i in range(0, len(events), BATCH_SIZE):
        batch = events[i:i + BATCH_SIZE]

        # Prepare texts for embedding
        texts = []
        for event in batch:
            text_parts = []

            if event['event_name']:
                text_parts.append(event['event_name'])

            if event['event_description']:
                text_parts.append(event['event_description'])

            if event['category_tags']:
                tags = ' '.join(event['category_tags']) if isinstance(event['category_tags'], list) else ''
                if tags:
                    text_parts.append(f"Tags: {tags}")

            if event['city'] and event['state']:
                text_parts.append(f"Location: {event['city']}, {event['state']}")

            text = ' | '.join(text_parts)
            texts.append(text)

        # Generate embeddings with 768 dimensions for events
        embeddings = batch_generate_embeddings(texts, dimensions=EVENTS_DIMENSIONS)

        # Prepare updates
        updates = [(event['id'], emb) for event, emb in zip(batch, embeddings) if emb]

        # Bulk update
        if updates:
            if conn:
                updated = bulk_update_embeddings_postgres(conn, 'v2_events', updates)
            else:
                updated = bulk_update_embeddings_supabase('v2_events', updates)

            processed += updated
            print(f"  ✓ Updated {updated} events")

        time.sleep(0.2)

    print(f"✅ Completed events: {processed} embeddings generated")

def process_actors_embeddings(conn=None):
    """Generate embeddings for actors"""
    print("\nProcessing actors (1536 dimensions)...")

    # Count total actors needing embeddings
    count_response = supabase.table('v2_actors')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    total_count = count_response.count

    if total_count == 0:
        print("No actors need embeddings")
        return

    print(f"Found {total_count:,} actors without embeddings")

    processed = 0
    offset = 0

    while offset < total_count:
        # Fetch batch from database
        batch_response = supabase.table('v2_actors')\
            .select('id, name, actor_type, about, city, state')\
            .is_('embedding', None)\
            .range(offset, offset + DB_FETCH_LIMIT - 1)\
            .execute()

        actors = batch_response.data
        if not actors:
            break

        print(f"\nProcessing actors {offset + 1} to {min(offset + len(actors), total_count)}...")

        # Process in API batches
        for i in range(0, len(actors), BATCH_SIZE):
            batch = actors[i:i + BATCH_SIZE]

            # Prepare texts for embedding
            texts = []
            for actor in batch:
                text_parts = []

                if actor['name']:
                    text_parts.append(actor['name'])

                if actor['actor_type']:
                    text_parts.append(f"Type: {actor['actor_type']}")

                if actor['about']:
                    text_parts.append(actor['about'])

                if actor['city'] and actor['state']:
                    text_parts.append(f"Location: {actor['city']}, {actor['state']}")

                text = ' | '.join(text_parts)
                texts.append(text)

            # Generate embeddings with 1536 dimensions for actors
            embeddings = batch_generate_embeddings(texts, dimensions=ACTORS_DIMENSIONS)

            # Prepare updates
            updates = [(actor['id'], emb) for actor, emb in zip(batch, embeddings) if emb]

            # Bulk update
            if updates:
                if conn:
                    updated = bulk_update_embeddings_postgres(conn, 'v2_actors', updates)
                else:
                    updated = bulk_update_embeddings_supabase('v2_actors', updates)

                processed += updated
                print(f"  ✓ Updated {updated} actors (Total: {processed:,}/{total_count:,})")

            time.sleep(0.2)

        offset += DB_FETCH_LIMIT

    print(f"✅ Completed actors: {processed:,} embeddings generated")

def estimate_costs():
    """Estimate the cost of generating embeddings"""
    print("Estimating costs...")

    # Count items needing embeddings
    posts_count = supabase.table('v2_social_media_posts')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    events_count = supabase.table('v2_events')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    actors_count = supabase.table('v2_actors')\
        .select('id', count='exact')\
        .is_('embedding', None)\
        .execute()

    total_items = posts_count.count + events_count.count + actors_count.count

    # Estimate tokens (rough average)
    avg_tokens_per_item = 200  # Conservative estimate
    total_tokens = total_items * avg_tokens_per_item

    # Cost calculation (text-embedding-3-small pricing as of 2024)
    cost_per_million_tokens = 0.02  # $0.02 per 1M tokens
    estimated_cost = (total_tokens / 1_000_000) * cost_per_million_tokens

    # Time estimation
    api_calls = total_items / BATCH_SIZE
    estimated_minutes = (api_calls * 0.3) / 60  # 0.3 seconds per batch with rate limiting

    print(f"\nEstimated embedding generation:")
    print(f"  Posts: {posts_count.count:,}")
    print(f"  Events: {events_count.count:,}")
    print(f"  Actors: {actors_count.count:,}")
    print(f"  Total items: {total_items:,}")
    print(f"  Estimated tokens: {total_tokens:,}")
    print(f"  Estimated cost: ${estimated_cost:.2f}")
    print(f"  Estimated time: ~{estimated_minutes:.0f} minutes")

    if posts_count.count > 100000:
        print(f"\n💡 Tip: With {posts_count.count:,} posts, this will take a while.")
        print("   Consider running overnight or in chunks.")

    return total_items > 0

def main():
    """Main execution function"""
    print("=== Woke Palantir Embedding Generator ===")
    print(f"Using model: {EMBEDDING_MODEL}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print()

    # Get database connection for faster bulk updates
    conn = get_db_connection()

    # Check if we need to generate embeddings
    if not estimate_costs():
        print("\nNo embeddings need to be generated!")
        return

    # Confirm before proceeding
    response = input("\nProceed with embedding generation? (y/n): ")
    if response.lower() != 'y':
        print("Aborted.")
        return

    start_time = time.time()

    # Process each type
    try:
        process_events_embeddings(conn)
        process_actors_embeddings(conn)
        process_posts_embeddings(conn)

        elapsed = time.time() - start_time
        print(f"\n✅ Embedding generation complete in {elapsed/60:.1f} minutes!")

    except Exception as e:
        print(f"\n❌ Error during processing: {e}")
        sys.exit(1)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    main()