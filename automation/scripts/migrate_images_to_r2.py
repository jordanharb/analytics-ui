#!/usr/bin/env python3
"""
Migrate images from Supabase Storage to Cloudflare R2

This script:
1. Fetches all posts with offline_image_url from Supabase Storage
2. Downloads images from Supabase
3. Uploads to Cloudflare R2
4. Updates database with new R2 URLs
5. Tracks progress with resume capability
6. Generates migration report

Usage:
    python automation/scripts/migrate_images_to_r2.py [--dry-run] [--batch-size 100]
"""

import os
import sys
import json
import asyncio
import aiohttp
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List
import argparse

# Add project root to path
script_dir = Path(__file__).resolve().parent
analytics_ui_dir = script_dir.parent.parent
sys.path.insert(0, str(analytics_ui_dir))

from utils.database import get_supabase, fetch_all_rows
from config.settings import (
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY
)

# Import boto3 for S3-compatible R2 access
try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("❌ boto3 not installed. Run: pip install boto3")
    sys.exit(1)


class R2ImageMigrator:
    def __init__(self, dry_run=False, batch_size=100, concurrent_uploads=10):
        self.dry_run = dry_run
        self.batch_size = batch_size
        self.concurrent_uploads = concurrent_uploads
        self.supabase = get_supabase()

        # R2 Configuration
        self.r2_account_id = os.getenv('R2_ACCOUNT_ID')
        self.r2_access_key = os.getenv('R2_ACCESS_KEY_ID')
        self.r2_secret_key = os.getenv('R2_SECRET_ACCESS_KEY')
        self.r2_bucket_name = os.getenv('R2_BUCKET_NAME', 'instagram-media')
        self.r2_endpoint = os.getenv('R2_ENDPOINT')
        self.r2_public_url = os.getenv('R2_PUBLIC_URL')

        # Validate R2 config
        if not all([self.r2_account_id, self.r2_access_key, self.r2_secret_key, self.r2_endpoint]):
            raise ValueError("Missing R2 configuration. Check your .env file for R2_* variables")

        # Initialize R2 client (S3-compatible)
        self.r2_client = boto3.client(
            's3',
            endpoint_url=self.r2_endpoint,
            aws_access_key_id=self.r2_access_key,
            aws_secret_access_key=self.r2_secret_key,
            region_name='auto',
            config=Config(signature_version='s3v4')
        )

        # Progress tracking
        self.progress_file = analytics_ui_dir / 'data' / 'r2_migration_progress.json'
        self.progress_file.parent.mkdir(exist_ok=True)
        self.progress = self.load_progress()

        # Stats
        self.stats = {
            'total': 0,
            'already_migrated': 0,
            'skipped': 0,
            'downloaded': 0,
            'uploaded': 0,
            'updated': 0,
            'failed': 0,
            'errors': []
        }

        # Batch updates buffer
        self.pending_db_updates = []

    def load_progress(self) -> Dict:
        """Load migration progress from file"""
        if self.progress_file.exists():
            with open(self.progress_file, 'r') as f:
                return json.load(f)
        return {'migrated_ids': [], 'failed_ids': []}

    def save_progress(self):
        """Save migration progress to file"""
        with open(self.progress_file, 'w') as f:
            json.dump(self.progress, f, indent=2)

    def extract_filename_from_supabase_url(self, url: str) -> Optional[str]:
        """Extract the filename from Supabase storage URL"""
        try:
            # Supabase URLs look like:
            # https://<project>.supabase.co/storage/v1/object/public/instagram-media/filename.jpg?token=...
            if '/storage/v1/object/public/instagram-media/' in url:
                filename = url.split('/storage/v1/object/public/instagram-media/')[-1]
                # Remove query parameters (everything after ?)
                filename = filename.split('?')[0]
                return filename
            return None
        except Exception as e:
            print(f"   ⚠️  Error extracting filename from {url}: {e}")
            return None

    def build_r2_public_url(self, filename: str) -> str:
        """Build R2 public URL for a filename"""
        # R2 public URLs: https://pub-<account-id>.r2.dev/<filename>
        return f"{self.r2_public_url}/{filename}"

    async def download_from_supabase(self, url: str) -> Optional[bytes]:
        """Download image from Supabase storage"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                    if response.status == 200:
                        return await response.read()
                    else:
                        print(f"   ❌ Failed to download {url}: HTTP {response.status}")
                        return None
        except Exception as e:
            print(f"   ❌ Error downloading {url}: {e}")
            return None

    def upload_to_r2(self, filename: str, content: bytes) -> bool:
        """Upload file to Cloudflare R2"""
        try:
            # Upload with public-read ACL
            self.r2_client.put_object(
                Bucket=self.r2_bucket_name,
                Key=filename,
                Body=content,
                ContentType=self.guess_content_type(filename)
            )
            return True
        except Exception as e:
            print(f"   ❌ Error uploading {filename} to R2: {e}")
            return False

    def guess_content_type(self, filename: str) -> str:
        """Guess content type from filename"""
        ext = filename.lower().split('.')[-1]
        content_types = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'mp4': 'video/mp4',
            'mov': 'video/quicktime'
        }
        return content_types.get(ext, 'application/octet-stream')

    def check_r2_file_exists(self, filename: str) -> bool:
        """Check if file already exists in R2"""
        try:
            self.r2_client.head_object(Bucket=self.r2_bucket_name, Key=filename)
            return True
        except:
            return False

    def flush_db_updates(self):
        """Flush pending database updates in bulk"""
        if not self.pending_db_updates:
            return

        try:
            import json
            # Convert to JSON string for JSONB parameter
            updates_json = json.dumps(self.pending_db_updates)

            # Call RPC function with JSON string
            result = self.supabase.rpc('bulk_update_image_urls', {
                'updates': updates_json
            }).execute()

            self.stats['updated'] += len(self.pending_db_updates)
            print(f"   💾 Batch updated {len(self.pending_db_updates)} URLs in database")

            # Clear buffer
            self.pending_db_updates = []

        except Exception as e:
            print(f"   ⚠️  Batch update failed: {e}, falling back to individual updates")
            # Fallback to individual updates
            for update in self.pending_db_updates:
                try:
                    self.supabase.table('v2_social_media_posts')\
                        .update({'offline_image_url': update['new_url']})\
                        .eq('id', update['id'])\
                        .execute()
                    self.stats['updated'] += 1
                except Exception as e2:
                    print(f"   ❌ Failed to update {update['id']}: {e2}")
                    self.stats['failed'] += 1

            self.pending_db_updates = []

    async def migrate_post(self, post: Dict) -> bool:
        """Migrate a single post's image"""
        post_id = post['id']
        supabase_url = post['offline_image_url']

        # Check if already migrated
        if post_id in self.progress['migrated_ids']:
            self.stats['already_migrated'] += 1
            return True

        # Extract filename
        filename = self.extract_filename_from_supabase_url(supabase_url)
        if not filename:
            print(f"   ⚠️  Could not extract filename from {supabase_url}")
            self.stats['skipped'] += 1
            return False

        # Check if already in R2
        if self.check_r2_file_exists(filename):
            print(f"   ✓ {filename} already exists in R2")
            r2_url = self.build_r2_public_url(filename)

            # Buffer database update
            if not self.dry_run:
                self.pending_db_updates.append({
                    'id': post_id,
                    'new_url': r2_url
                })

            self.progress['migrated_ids'].append(post_id)
            self.stats['already_migrated'] += 1
            return True

        # Download from Supabase
        print(f"   📥 Downloading {filename}...")
        content = await self.download_from_supabase(supabase_url)
        if not content:
            self.stats['failed'] += 1
            self.progress['failed_ids'].append(post_id)
            self.stats['errors'].append(f"Failed to download {filename}")
            return False

        self.stats['downloaded'] += 1

        # Upload to R2
        if self.dry_run:
            print(f"   [DRY RUN] Would upload {filename} ({len(content)} bytes)")
            self.stats['uploaded'] += 1
        else:
            print(f"   📤 Uploading {filename} to R2...")
            if not self.upload_to_r2(filename, content):
                self.stats['failed'] += 1
                self.progress['failed_ids'].append(post_id)
                self.stats['errors'].append(f"Failed to upload {filename}")
                return False
            self.stats['uploaded'] += 1

        # Update database with new R2 URL
        r2_url = self.build_r2_public_url(filename)

        if self.dry_run:
            print(f"   [DRY RUN] Would update {post_id}: {r2_url}")
        else:
            # Buffer database update for batch processing
            self.pending_db_updates.append({
                'id': post_id,
                'new_url': r2_url
            })

        # Mark as migrated
        self.progress['migrated_ids'].append(post_id)

        return True

    async def run(self):
        """Run the migration"""
        print("=" * 80)
        print("🚀 MIGRATING IMAGES FROM SUPABASE TO CLOUDFLARE R2")
        print("=" * 80)

        if self.dry_run:
            print("⚠️  DRY RUN MODE - No actual changes will be made")

        print(f"\n📊 Configuration:")
        print(f"   R2 Bucket: {self.r2_bucket_name}")
        print(f"   R2 Endpoint: {self.r2_endpoint}")
        print(f"   R2 Public URL: {self.r2_public_url}")
        print(f"   Batch Size: {self.batch_size}")
        print(f"   Concurrent Uploads: {self.concurrent_uploads}")

        # Fetch all posts with Supabase storage URLs
        print(f"\n📂 Fetching posts with Supabase storage URLs...")

        query = self.supabase.table('v2_social_media_posts')\
            .select('id, offline_image_url')\
            .like('offline_image_url', f'%{SUPABASE_URL}%')\
            .not_.is_('offline_image_url', 'null')

        posts = fetch_all_rows(query, batch_size=1000)

        self.stats['total'] = len(posts)

        print(f"   ✅ Found {len(posts)} posts to migrate")
        print(f"   ℹ️  Already migrated: {len(self.progress['migrated_ids'])} posts")
        print(f"   ℹ️  Previous failures: {len(self.progress['failed_ids'])} posts")

        if not posts:
            print("\n✅ No posts to migrate!")
            return

        # Filter out already migrated
        posts_to_migrate = [p for p in posts if p['id'] not in self.progress['migrated_ids']]
        print(f"   📋 Remaining to migrate: {len(posts_to_migrate)} posts")

        if not posts_to_migrate:
            print("\n✅ All posts already migrated!")
            self.print_summary()
            return

        # Migrate in batches with parallel uploads
        print(f"\n🔄 Starting migration with {self.concurrent_uploads} concurrent uploads...")

        for i in range(0, len(posts_to_migrate), self.batch_size):
            batch = posts_to_migrate[i:i + self.batch_size]
            batch_num = (i // self.batch_size) + 1
            total_batches = (len(posts_to_migrate) + self.batch_size - 1) // self.batch_size

            print(f"\n📦 Batch {batch_num}/{total_batches} ({len(batch)} posts)")

            # Process batch in parallel chunks
            for chunk_start in range(0, len(batch), self.concurrent_uploads):
                chunk = batch[chunk_start:chunk_start + self.concurrent_uploads]

                # Process chunk in parallel
                tasks = [self.migrate_post(post) for post in chunk]
                await asyncio.gather(*tasks)

                print(f"   ✅ Processed {min(chunk_start + self.concurrent_uploads, len(batch))}/{len(batch)} posts in this batch")

            # Flush database updates for this batch
            if not self.dry_run:
                self.flush_db_updates()

            # Save progress after each batch
            self.save_progress()
            print(f"   💾 Progress saved")

        print("\n" + "=" * 80)
        self.print_summary()
        print("=" * 80)

    def print_summary(self):
        """Print migration summary"""
        print("\n📊 MIGRATION SUMMARY:")
        print(f"   Total posts:         {self.stats['total']}")
        print(f"   Already migrated:    {self.stats['already_migrated']}")
        print(f"   Downloaded:          {self.stats['downloaded']}")
        print(f"   Uploaded to R2:      {self.stats['uploaded']}")
        print(f"   Database updated:    {self.stats['updated']}")
        print(f"   Skipped:             {self.stats['skipped']}")
        print(f"   Failed:              {self.stats['failed']}")

        if self.stats['errors']:
            print(f"\n⚠️  ERRORS ({len(self.stats['errors'])}):")
            for error in self.stats['errors'][:10]:
                print(f"   - {error}")
            if len(self.stats['errors']) > 10:
                print(f"   ... and {len(self.stats['errors']) - 10} more")

        if self.stats['failed'] == 0 and not self.dry_run:
            print(f"\n✅ MIGRATION COMPLETE!")
            print(f"\n💡 Next steps:")
            print(f"   1. Verify images are accessible at: {self.r2_public_url}")
            print(f"   2. Test a few posts in the app to confirm images load")
            print(f"   3. Once verified, you can delete images from Supabase storage")
            print(f"   4. Cancel your Supabase paid plan to save $25/month!")


async def main():
    parser = argparse.ArgumentParser(description='Migrate images from Supabase to Cloudflare R2')
    parser.add_argument('--dry-run', action='store_true', help='Run without making changes')
    parser.add_argument('--batch-size', type=int, default=100, help='Batch size for migration')
    parser.add_argument('--concurrent', type=int, default=20, help='Number of concurrent uploads (default: 20)')
    args = parser.parse_args()

    migrator = R2ImageMigrator(
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        concurrent_uploads=args.concurrent
    )
    await migrator.run()


if __name__ == '__main__':
    asyncio.run(main())
