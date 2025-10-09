#!/usr/bin/env python3
"""
Instagram Media Downloader - Optimized Version
Downloads media files from Instagram posts and stores them in Supabase storage bucket.
Updates the database with offline_image_url links.

Optimizations:
- Efficient bucket file checking using direct API calls
- URL validation before download attempts
- Circuit breaker for expired URL domains
- Handles posts with no offline_media_url, BROKEN, or other non-URL values
"""

import os
import sys
import json
import asyncio
import aiohttp
from datetime import datetime, timezone
from typing import List, Dict, Set, Optional, Tuple
from urllib.parse import urlparse, unquote
import hashlib
from collections import defaultdict
import time

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.database import get_supabase

class InstagramMediaDownloader:
    def __init__(self):
        self.supabase = get_supabase()
        self.bucket_name = 'instagram-media'
        self.existing_files = set()
        self.session = None
        self.download_semaphore = asyncio.Semaphore(200)  # EXTREME: 200 concurrent downloads
        self.upload_semaphore = asyncio.Semaphore(100)  # EXTREME: 100 concurrent uploads
        self.bulk_updates = []  # Collect updates for bulk operation
        self.bulk_update_lock = asyncio.Lock()
        self.stats = {
            'posts_processed': 0,
            'media_downloaded': 0,
            'media_skipped': 0,
            'download_errors': 0,
            'posts_updated': 0,
            'expired_urls': 0,
            'broken_urls_fixed': 0,
            'posts_marked_expired': 0
        }
        
    async def initialize(self):
        """Initialize async session and load existing files"""
        # EXTREME connection limits for maximum speed
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=5, connect=2),  # AGGRESSIVE: 5s total, 2s connect
            connector=aiohttp.TCPConnector(
                limit=300,  # EXTREME: 300 total connections
                limit_per_host=100,  # EXTREME: 100 per host
                ttl_dns_cache=300,  # Cache DNS for 5 minutes
                enable_cleanup_closed=True,
                force_close=True  # Force connection closure for speed
            )
        )
        await self.load_existing_files()
        
    async def cleanup(self):
        """Clean up async session"""
        if self.session:
            await self.session.close()
            
    def is_valid_url(self, url: str) -> bool:
        """Check if a string is a valid URL"""
        if not url or not isinstance(url, str):
            return False
        
        # List of known non-URL values
        non_url_values = ['BROKEN', 'EXPIRED', 'PERMANENTLY_EXPIRED', 'ERROR', 'NONE', 'NULL', '']
        if url.upper() in non_url_values:
            return False
            
        try:
            result = urlparse(url)
            return all([result.scheme, result.netloc])
        except:
            return False
    
    async def load_existing_files(self):
        """Load all existing files from the bucket efficiently"""
        print(f"📂 Loading existing files from bucket '{self.bucket_name}'...")
        
        try:
            all_files = []
            limit = 1000
            offset = 0
            
            while True:
                result = self.supabase.storage.from_(self.bucket_name).list(
                    path='',
                    options={
                        'limit': limit,
                        'offset': offset
                    }
                )
                
                if not result:
                    break
                    
                all_files.extend(result)
                
                if len(result) < limit:
                    break
                    
                offset += limit
                print(f"  📄 Loaded {len(all_files)} files so far...")
            
            # Extract just the filenames
            self.existing_files = {
                file['name'] for file in all_files 
                if isinstance(file, dict) and 'name' in file
            }
            
            print(f"✅ Loaded {len(self.existing_files)} existing files from bucket")
            
        except Exception as e:
            print(f"❌ Error loading existing files: {e}")
            self.existing_files = set()
    
    async def get_posts_needing_download(self) -> List[Dict]:
        """Get all Instagram posts that need media download - OPTIMIZED with DB filtering"""
        print("🔍 Finding Instagram posts needing media download (PRE-FILTERED)...")
        
        try:
            # OPTIMIZATION: Filter directly in database query
            all_posts = []
            batch_size = 1000
            offset = 0
            
            while True:
                # Query ONLY posts that actually need download
                result = self.supabase.table('v2_social_media_posts')\
                    .select('id, post_id, media_urls, offline_image_url, created_at')\
                    .eq('platform', 'instagram')\
                    .not_.is_('media_urls', 'null')\
                    .or_("offline_image_url.is.null,offline_image_url.in.(BROKEN,ERROR,EXPIRED)")\
                    .order('created_at', desc=True)\
                    .range(offset, offset + batch_size - 1)\
                    .execute()
                
                if not result.data:
                    break
                
                # All results already need download (pre-filtered)
                all_posts.extend(result.data)
                
                print(f"  📊 Found {len(all_posts)} posts needing download...")
                
                if len(result.data) < batch_size:
                    break
                    
                offset += batch_size
            
            print(f"✅ Found {len(all_posts)} posts needing media download")
            return all_posts
            
        except Exception as e:
            print(f"❌ Error getting posts: {e}")
            return []
    
    def get_filename_for_url(self, url: str, post_id: str, index: int = 0) -> str:
        """Generate a filename for storing the media"""
        # Extract file extension from URL
        parsed = urlparse(url)
        path = unquote(parsed.path)
        
        # Try to get extension from URL
        ext = '.jpg'  # default
        if '.' in path:
            ext = path.split('.')[-1]
            if len(ext) > 4 or not ext.isalnum():
                ext = 'jpg'
            ext = f'.{ext}'
        
        # Create filename using post_id and index
        if index > 0:
            filename = f"{post_id}_{index}{ext}"
        else:
            filename = f"{post_id}{ext}"
            
        return filename
    
    async def download_media(self, url: str, filename: str) -> Tuple[Optional[bytes], bool]:
        """Download media from URL. Returns (content, is_expired)"""
        domain = urlparse(url).netloc
        print(f"  📥 Downloading {filename} from {domain}...")
        
        async with self.download_semaphore:
            try:
                async with self.session.get(url) as response:
                    if response.status == 200:
                        content = await response.read()
                        print(f"  ✅ Downloaded {filename} ({len(content):,} bytes)")
                        return content, False
                    elif response.status in [403, 404, 410]:
                        # URL is expired (but don't blacklist the whole domain for Instagram)
                        self.stats['expired_urls'] += 1
                        print(f"  🚫 HTTP {response.status} for {filename} - URL expired")
                        return None, True
                    else:
                        print(f"  ⚠️ HTTP {response.status} for {filename}")
                        return None, False
                        
            except asyncio.TimeoutError:
                print(f"  ⏱️ Timeout downloading {filename}")
                return None, False
            except Exception as e:
                print(f"  ❌ Error downloading {filename}: {str(e)[:100]}")
                return None, False
    
    async def flush_bulk_updates(self):
        """Flush all pending bulk updates to database"""
        if not self.bulk_updates:
            return
        
        try:
            print(f"  💾 Bulk updating {len(self.bulk_updates)} posts...")
            # Perform bulk upsert
            result = self.supabase.table('v2_social_media_posts')\
                .upsert(self.bulk_updates)\
                .execute()
            
            if result.data:
                print(f"  ✅ Bulk updated {len(self.bulk_updates)} posts successfully")
            
            # Clear the bulk updates
            self.bulk_updates = []
            
        except Exception as e:
            print(f"  ❌ Error in bulk update: {str(e)[:100]}")
            # Fall back to individual updates if bulk fails
            for update in self.bulk_updates:
                try:
                    self.supabase.table('v2_social_media_posts')\
                        .update({'offline_image_url': update['offline_image_url']})\
                        .eq('id', update['id'])\
                        .execute()
                except:
                    pass
            self.bulk_updates = []
    
    async def upload_to_bucket(self, filename: str, content: bytes) -> Optional[str]:
        """Upload file to Supabase bucket"""
        async with self.upload_semaphore:
            try:
                # Upload to bucket
                result = self.supabase.storage.from_(self.bucket_name).upload(
                    file=content,
                    path=filename,
                    file_options={"content-type": "image/jpeg"}
                )
                
                # Get public URL
                public_url = self.supabase.storage.from_(self.bucket_name).get_public_url(filename)
                return public_url
                
            except Exception as e:
                error_msg = str(e)
                if 'duplicate' in error_msg.lower():
                    # File already exists, get its URL
                    public_url = self.supabase.storage.from_(self.bucket_name).get_public_url(filename)
                    return public_url
                else:
                    print(f"  ❌ Error uploading {filename}: {error_msg[:100]}")
                    return None
    
    async def process_post(self, post: Dict) -> bool:
        """Process a single post - download media and update database"""
        post_id = post['post_id']
        media_urls = json.loads(post['media_urls']) if isinstance(post['media_urls'], str) else post['media_urls']
        
        if not media_urls:
            return False
        
        downloaded_urls = []
        expired_count = 0
        valid_url_count = 0
        
        # Process each media URL
        for index, url in enumerate(media_urls):
            if not url or not self.is_valid_url(url):
                continue
            
            valid_url_count += 1
            filename = self.get_filename_for_url(url, post_id, index)
            
            # Skip if already in bucket
            if filename in self.existing_files:
                public_url = self.supabase.storage.from_(self.bucket_name).get_public_url(filename)
                downloaded_urls.append(public_url)
                self.stats['media_skipped'] += 1
                print(f"  ✓ {filename} already in bucket")
                continue
            
            # Download media
            content, is_expired = await self.download_media(url, filename)
            if not content:
                self.stats['download_errors'] += 1
                if is_expired:
                    expired_count += 1
                continue
            
            # Upload to bucket
            public_url = await self.upload_to_bucket(filename, content)
            if public_url:
                downloaded_urls.append(public_url)
                self.existing_files.add(filename)
                self.stats['media_downloaded'] += 1
            else:
                self.stats['download_errors'] += 1
        
        # Determine if all URLs are expired
        all_urls_expired = valid_url_count > 0 and expired_count == valid_url_count
        
        # Debug logging
        if valid_url_count > 0 and expired_count > 0:
            print(f"  📊 Post {post_id}: {expired_count}/{valid_url_count} URLs expired")
        
        # Collect update for bulk operation instead of immediate update
        try:
            if downloaded_urls:
                # Add to bulk updates instead of immediate update
                async with self.bulk_update_lock:
                    self.bulk_updates.append({
                        'id': post['id'],
                        'offline_image_url': downloaded_urls[0]
                    })
                    self.stats['posts_updated'] += 1
                    
                    # Flush bulk updates if we have 100+
                    if len(self.bulk_updates) >= 100:
                        await self.flush_bulk_updates()
                
                return True
            elif all_urls_expired and media_urls:
                print(f"  🔴 All URLs expired for post {post_id}, marking as EXPIRED")
                # Add to bulk updates for expired posts
                current_status = post.get('offline_image_url', '')
                status = 'PERMANENTLY_EXPIRED' if current_status and current_status.upper() == 'EXPIRED' else 'EXPIRED'
                
                async with self.bulk_update_lock:
                    self.bulk_updates.append({
                        'id': post['id'],
                        'offline_image_url': status
                    })
                    self.stats['posts_updated'] += 1
                    self.stats['posts_marked_expired'] += 1
                    
                    # Flush bulk updates if we have 100+
                    if len(self.bulk_updates) >= 100:
                        await self.flush_bulk_updates()
                
                return True
            else:
                # No URLs to process or no action taken
                if not downloaded_urls and not all_urls_expired:
                    print(f"  ⚠️ Post {post_id}: No action taken (expired: {expired_count}/{valid_url_count})")
                    
        except Exception as e:
            print(f"  ❌ Error updating post {post_id}: {str(e)[:100]}")
        
        return False
    
    async def process_batch(self, posts: List[Dict], batch_num: int, total_batches: int):
        """Process a batch of posts concurrently"""
        print(f"\n📦 Processing batch {batch_num}/{total_batches} ({len(posts)} posts)...")
        
        tasks = []
        for post in posts:
            task = self.process_post(post)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Count successes
        success_count = sum(1 for r in results if r is True)
        error_count = sum(1 for r in results if isinstance(r, Exception))
        
        if error_count > 0:
            print(f"  ⚠️ Batch {batch_num}: {success_count} succeeded, {error_count} errors")
        else:
            print(f"  ✅ Batch {batch_num}: {success_count} posts updated")
    
    async def run(self, batch_size: int = 500, max_posts: Optional[int] = None):
        """Main function to download media for all posts needing it - ULTRA TURBO MODE"""
        print("🚀 Starting Instagram Media Downloader (ULTRA TURBO MODE)\n")
        print(f"⚡ Batch size: {batch_size} concurrent operations")
        print(f"🔥 Max connections: 300 total, 100 per host")
        print(f"💨 Concurrent downloads: 200")
        print(f"📦 Bulk updates: Every 100 posts")
        
        try:
            await self.initialize()
            
            # Get posts needing download
            posts = await self.get_posts_needing_download()
            
            if not posts:
                print("✅ No posts need media download!")
                return
            
            # Limit posts if specified
            if max_posts:
                posts = posts[:max_posts]
                print(f"📊 Limited to {max_posts} posts")
            
            # Process in batches
            total_batches = (len(posts) + batch_size - 1) // batch_size
            
            for i in range(0, len(posts), batch_size):
                batch = posts[i:i + batch_size]
                batch_num = (i // batch_size) + 1
                
                await self.process_batch(batch, batch_num, total_batches)
                self.stats['posts_processed'] += len(batch)
                
                # NO DELAY between batches for maximum speed
                # await asyncio.sleep(0.2)  # REMOVED for speed
            
            # Flush any remaining bulk updates
            async with self.bulk_update_lock:
                if self.bulk_updates:
                    print(f"\n📝 Flushing final {len(self.bulk_updates)} updates...")
                    await self.flush_bulk_updates()
            
            # Print final statistics
            self.print_stats()
            
        except Exception as e:
            print(f"❌ Critical error: {e}")
            import traceback
            traceback.print_exc()
            
        finally:
            await self.cleanup()
    
    def print_stats(self):
        """Print download statistics"""
        print("\n" + "="*50)
        print("📊 INSTAGRAM MEDIA DOWNLOAD SUMMARY")
        print("="*50)
        print(f"📝 Posts processed: {self.stats['posts_processed']}")
        print(f"✅ Posts updated: {self.stats['posts_updated']}")
        print(f"🖼️ Media downloaded: {self.stats['media_downloaded']}")
        print(f"⏭️ Media skipped (already exists): {self.stats['media_skipped']}")
        print(f"❌ Download errors: {self.stats['download_errors']}")
        print(f"🚫 Expired URLs skipped: {self.stats['expired_urls']}")
        print(f"🔧 Broken URLs fixed: {self.stats['broken_urls_fixed']}")
        print(f"⏰ Posts marked as EXPIRED: {self.stats['posts_marked_expired']}")
        
        if self.stats['posts_processed'] > 0:
            success_rate = (self.stats['posts_updated'] / self.stats['posts_processed']) * 100
            print(f"📈 Success rate: {success_rate:.1f}%")

async def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Download Instagram media files to Supabase storage"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Number of posts to process concurrently (default: 500 ULTRA MODE)"
    )
    parser.add_argument(
        "--max-posts",
        type=int,
        help="Maximum number of posts to process"
    )
    
    args = parser.parse_args()
    
    downloader = InstagramMediaDownloader()
    await downloader.run(
        batch_size=args.batch_size,
        max_posts=args.max_posts
    )

if __name__ == "__main__":
    asyncio.run(main())