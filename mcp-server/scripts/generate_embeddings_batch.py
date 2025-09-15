#!/usr/bin/env python3
"""
OpenAI Batch API Embedding Generator - Fire and Forget
Sends ALL data in large batches to OpenAI, runs in background
50% cost reduction, handles millions of records
"""

import os
import sys
import json
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
import openai
from supabase import create_client, Client
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import execute_values
import tempfile
import uuid
from pathlib import Path
import pickle

# Load environment variables from MCP server env
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Batch Settings
MAX_REQUESTS_PER_FILE = 50000  # OpenAI max per batch file
EMBEDDING_MODEL = 'text-embedding-3-large'

# Dimensions for each table
DIMENSIONS = {
    'v2_social_media_posts': 1536,
    'v2_events': 768,
    'v2_actors': 1536
}

# Database connection
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'postgres')
DB_USER = os.getenv('DB_USER')
DB_PASSWORD = os.getenv('DB_PASSWORD')

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)

# Batch job tracking directory
BATCH_DIR = Path(tempfile.gettempdir()) / "embedding_batches"
BATCH_DIR.mkdir(exist_ok=True)
BATCH_STATUS_FILE = BATCH_DIR / "batch_status.json"

def get_db_connection():
    """Get direct PostgreSQL connection"""
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            sslmode='require'
        )
        return conn
    except Exception as e:
        print(f"⚠️  Could not connect to DB: {e}")
        return None

def prepare_text_for_embedding(item: Dict, table_name: str) -> str:
    """Prepare text for embedding based on table type"""
    if table_name == 'v2_social_media_posts':
        text = f"{item.get('content_text', '')}"
        if item.get('platform'):
            text = f"[{item['platform']}] {text}"
        if item.get('author_handle'):
            text = f"@{item['author_handle']}: {text}"
        return text[:8191]  # Max tokens

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
        return ' | '.join(text_parts)[:8191]

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
        return ' | '.join(text_parts)[:8191]

    return ""

def fetch_all_items_needing_embeddings(table_name: str) -> List[Dict]:
    """Fetch ALL items that need embeddings from a table"""
    print(f"📥 Fetching all {table_name} without embeddings...")

    all_items = []
    offset = 0
    batch_size = 10000  # Fetch in chunks to avoid memory issues

    while True:
        response = supabase.table(table_name)\
            .select('*')\
            .is_('embedding', None)\
            .range(offset, offset + batch_size - 1)\
            .execute()

        if not response.data:
            break

        all_items.extend(response.data)
        offset += batch_size

        if len(all_items) % 50000 == 0:
            print(f"  Fetched {len(all_items):,} so far...")

    print(f"  ✓ Total {table_name}: {len(all_items):,} items need embeddings")
    return all_items

def create_batch_file(items: List[Dict], table_name: str, file_index: int) -> str:
    """Create JSONL batch file for OpenAI"""
    file_path = BATCH_DIR / f"{table_name}_batch_{file_index}.jsonl"
    dimensions = DIMENSIONS[table_name]

    # Track seen IDs to avoid duplicates
    seen_ids = set()
    duplicate_count = 0

    with open(file_path, 'w') as f:
        for idx, item in enumerate(items):
            item_id = item['id']

            # Skip duplicates
            if item_id in seen_ids:
                duplicate_count += 1
                continue

            seen_ids.add(item_id)

            text = prepare_text_for_embedding(item, table_name)
            # Use index in custom_id to ensure uniqueness even if IDs repeat
            request = {
                "custom_id": f"{table_name}|{item_id}|{file_index}_{idx}",
                "method": "POST",
                "url": "/v1/embeddings",
                "body": {
                    "model": EMBEDDING_MODEL,
                    "input": text,
                    "dimensions": dimensions
                }
            }
            f.write(json.dumps(request) + '\n')

    if duplicate_count > 0:
        print(f"    ⚠️  Skipped {duplicate_count} duplicate IDs")

    return str(file_path)

def submit_batch_job(file_path: str, description: str) -> str:
    """Submit batch file to OpenAI and return batch ID"""
    # Upload file
    with open(file_path, 'rb') as f:
        file_response = openai_client.files.create(
            file=f,
            purpose='batch'
        )

    # Create batch job
    batch = openai_client.batches.create(
        input_file_id=file_response.id,
        endpoint="/v1/embeddings",
        completion_window="24h",
        metadata={"description": description}
    )

    return batch.id

def submit_all_batches():
    """Submit ALL data as batch jobs to OpenAI"""
    print("\n🚀 Starting Batch Submission to OpenAI")
    print("=" * 50)

    batch_jobs = []

    for table_name in DIMENSIONS.keys():
        print(f"\n📊 Processing {table_name}...")

        # Fetch ALL items needing embeddings
        items = fetch_all_items_needing_embeddings(table_name)

        if not items:
            print(f"  ✓ No items need embeddings")
            continue

        # Split into files of MAX_REQUESTS_PER_FILE each
        num_files = (len(items) + MAX_REQUESTS_PER_FILE - 1) // MAX_REQUESTS_PER_FILE
        print(f"  📁 Creating {num_files} batch file(s) ({MAX_REQUESTS_PER_FILE:,} items each)")

        for i in range(num_files):
            start_idx = i * MAX_REQUESTS_PER_FILE
            end_idx = min(start_idx + MAX_REQUESTS_PER_FILE, len(items))
            batch_items = items[start_idx:end_idx]

            # Create batch file
            file_path = create_batch_file(batch_items, table_name, i)
            print(f"    Creating file {i+1}/{num_files} with {len(batch_items):,} items...")

            # Submit to OpenAI
            description = f"{table_name}_file_{i+1}_of_{num_files}"
            batch_id = submit_batch_job(file_path, description)

            batch_jobs.append({
                'batch_id': batch_id,
                'table_name': table_name,
                'file_index': i,
                'num_items': len(batch_items),
                'status': 'submitted',
                'submitted_at': datetime.now().isoformat()
            })

            print(f"    ✓ Submitted batch {batch_id}")

    # Save batch job status
    with open(BATCH_STATUS_FILE, 'w') as f:
        json.dump(batch_jobs, f, indent=2)

    print("\n" + "=" * 50)
    print(f"✅ Submitted {len(batch_jobs)} batch jobs to OpenAI!")
    print(f"📄 Status saved to: {BATCH_STATUS_FILE}")
    print("\n🎯 Batch jobs will run in the background (up to 24 hours)")
    print("   Use 'check_status' mode to monitor progress")
    print("   Use 'process_results' mode to apply embeddings when ready")

    return batch_jobs

def check_batch_status():
    """Check status of all submitted batch jobs"""
    if not BATCH_STATUS_FILE.exists():
        print("❌ No batch jobs found. Run 'submit' mode first.")
        return

    with open(BATCH_STATUS_FILE, 'r') as f:
        batch_jobs = json.load(f)

    print("\n📊 Batch Job Status")
    print("=" * 50)

    total_items = sum(job['num_items'] for job in batch_jobs)
    completed_items = 0

    for job in batch_jobs:
        try:
            batch = openai_client.batches.retrieve(job['batch_id'])
            job['status'] = batch.status

            print(f"\n📁 {job['table_name']} (file {job['file_index'] + 1})")
            print(f"   Batch ID: {job['batch_id']}")
            print(f"   Status: {batch.status}")
            print(f"   Progress: {batch.request_counts.completed}/{batch.request_counts.total}")

            if batch.status == 'completed':
                job['output_file_id'] = batch.output_file_id
                job['completed_at'] = datetime.now().isoformat()
                completed_items += job['num_items']
            elif batch.status in ['failed', 'cancelled', 'expired']:
                print(f"   ⚠️  Batch {batch.status}!")
                if batch.errors:
                    print(f"   Error: {batch.errors}")
        except Exception as e:
            print(f"   ❌ Error checking batch: {e}")

    # Save updated status
    with open(BATCH_STATUS_FILE, 'w') as f:
        json.dump(batch_jobs, f, indent=2)

    completed_jobs = sum(1 for job in batch_jobs if job.get('status') == 'completed')
    print("\n" + "=" * 50)
    print(f"📈 Overall Progress: {completed_jobs}/{len(batch_jobs)} batches completed")
    print(f"   Items: {completed_items:,}/{total_items:,} processed")

    if completed_jobs == len(batch_jobs):
        print("\n✅ All batches completed! Run 'process_results' to apply embeddings.")
    else:
        print("\n⏳ Batches still processing. Check again later.")

def process_batch_results():
    """Download results and update database with embeddings"""
    if not BATCH_STATUS_FILE.exists():
        print("❌ No batch jobs found.")
        return

    with open(BATCH_STATUS_FILE, 'r') as f:
        batch_jobs = json.load(f)

    completed_jobs = [job for job in batch_jobs if job.get('status') == 'completed' and job.get('output_file_id')]

    if not completed_jobs:
        print("❌ No completed batches to process. Check status first.")
        return

    print(f"\n🔄 Processing {len(completed_jobs)} completed batch(es)")
    print("=" * 50)

    conn = get_db_connection()
    if not conn:
        print("❌ Could not connect to database")
        return

    total_updated = 0

    for job in completed_jobs:
        if job.get('processed'):
            print(f"\n✓ Already processed: {job['table_name']} file {job['file_index'] + 1}")
            continue

        print(f"\n📥 Downloading results for {job['table_name']} file {job['file_index'] + 1}...")

        try:
            # Download result file
            result_content = openai_client.files.content(job['output_file_id'])

            # Parse results and prepare updates
            updates = []
            for line in result_content.text.split('\n'):
                if not line.strip():
                    continue

                result = json.loads(line)
                custom_id = result['custom_id']
                # Parse the new format: table_name|item_id|file_idx
                parts = custom_id.split('|')
                table_name = parts[0]
                item_id = parts[1]

                if 'error' in result:
                    print(f"  ⚠️  Error for {item_id}: {result['error']}")
                    continue

                embedding = result['response']['body']['data'][0]['embedding']
                embedding_str = f"[{','.join(map(str, embedding))}]"
                updates.append((item_id, embedding_str))

            # Bulk update database
            if updates:
                print(f"  💾 Updating {len(updates):,} embeddings in database...")
                cursor = conn.cursor()

                query = f"""
                    UPDATE {job['table_name']}
                    SET embedding = data.embedding::vector
                    FROM (VALUES %s) AS data(id, embedding)
                    WHERE {job['table_name']}.id = data.id::uuid
                """

                execute_values(cursor, query, updates, page_size=1000)
                conn.commit()

                total_updated += len(updates)
                print(f"  ✓ Updated {len(updates):,} embeddings")

                # Mark as processed
                job['processed'] = True
                job['processed_at'] = datetime.now().isoformat()

        except Exception as e:
            print(f"  ❌ Error processing batch: {e}")
            conn.rollback()

    # Save updated status
    with open(BATCH_STATUS_FILE, 'w') as f:
        json.dump(batch_jobs, f, indent=2)

    conn.close()

    print("\n" + "=" * 50)
    print(f"✅ Successfully updated {total_updated:,} embeddings!")

def estimate_cost():
    """Estimate cost for generating embeddings"""
    print("\n💰 Cost Estimation")
    print("=" * 50)

    total_items = 0

    for table_name in DIMENSIONS.keys():
        count_response = supabase.table(table_name)\
            .select('id', count='exact')\
            .is_('embedding', None)\
            .execute()

        count = count_response.count
        total_items += count
        print(f"  {table_name}: {count:,} items")

    # Estimate tokens and cost
    avg_tokens_per_item = 200
    total_tokens = total_items * avg_tokens_per_item

    # text-embedding-3-large pricing with Batch API discount
    cost_per_million_tokens = 0.13
    batch_cost = (total_tokens / 1_000_000) * cost_per_million_tokens * 0.5  # 50% discount
    regular_cost = (total_tokens / 1_000_000) * cost_per_million_tokens

    print(f"\n📊 Total items: {total_items:,}")
    print(f"🎯 Estimated tokens: {total_tokens:,}")
    print(f"\n💵 Cost with Batch API: ${batch_cost:.2f}")
    print(f"💸 Regular API cost: ${regular_cost:.2f}")
    print(f"💰 You save: ${regular_cost - batch_cost:.2f} (50% discount)")

    print(f"\n⏱️  Time: Batches complete within 24 hours (usually faster)")

    return total_items > 0

def main():
    """Main execution"""
    print("=== 🚀 OpenAI Batch Embedding Generator ===")
    print("Fire-and-forget batch processing with 50% cost savings")
    print()

    if len(sys.argv) > 1:
        mode = sys.argv[1]
    else:
        print("Usage:")
        print("  python generate_embeddings_batch.py submit     # Submit all data as batches")
        print("  python generate_embeddings_batch.py status     # Check batch status")
        print("  python generate_embeddings_batch.py process    # Process completed results")
        print("  python generate_embeddings_batch.py estimate   # Estimate costs")
        print()
        mode = input("Enter mode (submit/status/process/estimate): ").strip().lower()

    if mode == 'submit':
        if estimate_cost():
            response = input("\n🔥 Submit all data to OpenAI Batch API? (y/n): ")
            if response.lower() == 'y':
                submit_all_batches()

    elif mode == 'status':
        check_batch_status()

    elif mode == 'process':
        process_batch_results()

    elif mode == 'estimate':
        estimate_cost()

    else:
        print("❌ Invalid mode. Use: submit, status, process, or estimate")

if __name__ == "__main__":
    main()