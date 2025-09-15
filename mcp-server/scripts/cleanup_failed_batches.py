#!/usr/bin/env python3
"""
Cleanup failed batches and prepare for resubmission
"""

import json
import os
from pathlib import Path
import tempfile

# Batch job tracking directory
BATCH_DIR = Path(tempfile.gettempdir()) / "embedding_batches"
BATCH_STATUS_FILE = BATCH_DIR / "batch_status.json"

def cleanup_failed_batches():
    """Remove failed batches from status file"""

    if not BATCH_STATUS_FILE.exists():
        print("❌ No batch status file found")
        return

    with open(BATCH_STATUS_FILE, 'r') as f:
        batch_jobs = json.load(f)

    print(f"📊 Current batch jobs: {len(batch_jobs)}")

    # Filter out failed jobs
    failed_jobs = [job for job in batch_jobs if job.get('status') == 'failed']
    successful_jobs = [job for job in batch_jobs if job.get('status') != 'failed']

    print(f"❌ Failed jobs: {len(failed_jobs)}")
    print(f"✅ Non-failed jobs: {len(successful_jobs)}")

    if failed_jobs:
        print("\n🗑️  Removing failed jobs:")
        for job in failed_jobs:
            print(f"  - {job['table_name']} file {job['file_index']}")
            # Remove the batch file
            batch_file = BATCH_DIR / f"{job['table_name']}_batch_{job['file_index']}.jsonl"
            if batch_file.exists():
                batch_file.unlink()
                print(f"    Deleted: {batch_file.name}")

    # Save only non-failed jobs
    with open(BATCH_STATUS_FILE, 'w') as f:
        json.dump(successful_jobs, f, indent=2)

    print(f"\n✅ Cleaned up! Remaining jobs: {len(successful_jobs)}")
    print("\nYou can now rerun the submit command to create new batches without duplicates:")
    print("  ./batch_embeddings.sh submit")

if __name__ == "__main__":
    cleanup_failed_batches()