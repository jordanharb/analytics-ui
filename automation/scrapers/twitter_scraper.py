"""
Twitter Scraper - Database-integrated version
Scrapes Twitter accounts based on database settings and uploads to Supabase storage
Triggered by the web interface after users select handles for scraping
"""
import sys
from pathlib import Path

# Ensure both repo and analytics-ui directories are on sys.path so we can import
# shared helpers like scripts.utils.database regardless of where the script runs.
CURRENT_FILE = Path(__file__).resolve()
SCRAPERS_DIR = CURRENT_FILE.parent
AUTOMATION_DIR = SCRAPERS_DIR.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

for candidate in (REPO_ROOT, WEB_DIR, ANALYTICS_UI_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

import pandas as pd
import csv
import asyncio
import os
import re
from twscrape import API
from datetime import datetime, timedelta, timezone
import json
import uuid
import logging
from utils.database import get_supabase
from config.settings import COOKIE_CSV, NUM_ACCOUNTS, MAX_RESULTS_PER_USER, OUTPUT_DIR, TWITTER_CONCURRENT_BATCH_SIZE, TWITTER_BATCH_DELAY, TWITTER_SAVE_BATCH_SIZE

# Configure logging to suppress verbose HTTP request logs
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
logging.getLogger('twscrape').setLevel(logging.WARNING)

class TwitterScraper:
    def __init__(self):
        self.supabase = get_supabase()
        self.stats = {
            'accounts_processed': 0,
            'tweets_scraped': 0,
            'failed_accounts': 0,
            'files_uploaded': 0
        }
        self.pending_tweets = []  # Buffer for tweets awaiting upload
        self.successfully_uploaded_handles = []  # Track which handles were successfully uploaded
        self.no_tweets_found_handles = []  # Track handles with no tweets found
        self.job_id = None  # Will be set by Celery task
        # Behavior flags
        self.clear_pool_on_start = os.getenv('TW_CLEAR_TWSCRAPE_CACHE', '1') in ('1', 'true', 'True')
        self.cookie_mode = os.getenv('TW_COOKIE_MODE', 'auto').lower()  # 'auto' | 'cookies' | 'none'
        self.allow_cookieless_fallback = os.getenv('TW_COOKIELESS_FALLBACK', '1') in ('1', 'true', 'True')
        self.is_cookie_less = False

    def check_cancellation_signal(self):
        """Check if job should be cancelled"""
        if not self.job_id:
            return False
            
        try:
            result = self.supabase.table('v2_batches')\
                .select('control_signal, status')\
                .eq('id', self.job_id)\
                .execute()
                
            if result.data and len(result.data) > 0:
                job = result.data[0]
                if job.get('control_signal') == 'cancel' or job.get('status') == 'cancelling':
                    print(f"🛑 Cancellation signal received for job {self.job_id}")
                    return True
        except Exception as e:
            print(f"⚠️ Failed to check cancellation signal: {e}")
            
        return False

    def clean_twitter_handle(self, raw_handle: str):
        """Cleans and validates a Twitter handle from various formats."""
        if not isinstance(raw_handle, str):
            return None
        val = raw_handle.strip()
        if not val:
            return None
        if "twitter.com/" in val:
            val = val.split("twitter.com/")[-1].split("/")[0]
        val = val.lstrip('@')
        val = re.sub(r'[^A-Za-z0-9_]', '', val)[:15]
        return val if val else None

    def get_twitter_handles_from_database(self):
        """Gets Twitter handles marked for scraping from the database (should_scrape = TRUE)"""

        try:
            # Check for handle limit (for testing)
            handle_limit = int(os.getenv('TWITTER_HANDLE_LIMIT', '0'))

            # Query for Twitter handles where should_scrape is TRUE
            query = self.supabase.table('v2_actor_usernames')\
                .select('username, actor_id, actor_type, last_scrape')\
                .eq('platform', 'twitter')\
                .eq('should_scrape', True)

            if handle_limit > 0:
                query = query.limit(handle_limit)

            result = query.execute()

            twitter_data = []
            for record in result.data:
                handle = self.clean_twitter_handle(record['username'])
                if handle:
                    twitter_data.append({
                        "actor_id": record['actor_id'],
                        "actor_type": record['actor_type'],
                        "handle": handle,
                        "last_scrape": record.get('last_scrape')
                    })

            limit_msg = f" (limited to {handle_limit})" if handle_limit > 0 else ""
            print(f"📋 Found {len(twitter_data)} Twitter handles marked for scraping{limit_msg}")
            if len(twitter_data) == 0:
                print("💡 Use the Scraping Manager web interface to select handles for scraping")

            return twitter_data
            
        except Exception as e:
            print(f"❌ Error loading Twitter handles from database: {e}")
            return []

    def _clear_local_twscrape_cache(self):
        """Attempt to clear any local twscrape cache in the project directory.
        Avoids touching user-level caches outside the repo.
        """
        try:
            base = os.getcwd()
            candidates = [
                os.path.join(base, '.twscrape'),
                os.path.join(base, 'twscrape.db'),
                os.path.join(base, 'accounts.db'),
            ]
            removed = 0
            import shutil
            for path in candidates:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                    removed += 1
                elif os.path.isfile(path):
                    try:
                        os.remove(path)
                        removed += 1
                    except Exception:
                        pass
            if removed:
                print(f"   🧹 Cleared local twscrape cache artifacts ({removed} items)")
        except Exception as e:
            print(f"   ⚠️  Could not clear local twscrape cache: {e}")

    async def setup_api(self, clear_cache: bool | None = None):
        """Initializes the twscrape API with accounts from the cookie file."""
        print("🔧 Setting up Twitter API accounts...")

        # Cookie-less mode: skip accounts entirely
        if self.cookie_mode == 'none':
            print("   🟡 Cookie mode: none — proceeding without cookies (reduced throughput).")
            self.is_cookie_less = True
            return API()

        # Optionally clear any cached/loaded accounts to avoid stale/expired sessions
        flag = self.clear_pool_on_start if clear_cache is None else bool(clear_cache)
        if flag:
            self._clear_local_twscrape_cache()

        api = API()
        
        try:
            # Look for cookies in data directory (local backup) or main directory
            cookie_paths = [
                os.path.join('data', 'cookies_master.csv'),
                'cookies_master.csv',
                COOKIE_CSV
            ]
            
            df = None
            for path in cookie_paths:
                if os.path.exists(path):
                    df = pd.read_csv(path)
                    print(f"   📄 Found cookies at: {path}")
                    break
            
            if df is None:
                print(f"❌ Cookie file not found. Tried paths: {cookie_paths}")
                return None
                
        except Exception as e:
            print(f"❌ Error reading cookie file: {e}")
            return None
            
        # Function to add a sampled set of accounts and try login, returning active count
        async def add_and_login(sample_df):
            for _, row in sample_df.iterrows():
                try:
                    await api.pool.add_account(
                        username=row.get("username", "unknown"),
                        password="placeholder_password",
                        email="placeholder_email@example.com",
                        email_password="placeholder",
                        cookies=row.get("cookie_header", "")
                    )
                except Exception as e:
                    print(f"   ⚠️  Skipped adding account {row.get('username')}: {e}")
            print("🔑 Logging in API accounts...")
            try:
                await api.pool.login_all()
            except Exception as e:
                print(f"   ⚠️  login_all reported issues: {e}")
            # Inspect pool statuses
            active = 0; suspended = 0; locked = 0; other = 0
            try:
                accounts = await api.pool.get_all()
                for acc in accounts:
                    status = getattr(acc, 'status', '')
                    if status == 'active':
                        active += 1
                    elif status == 'suspended':
                        suspended += 1
                    elif status == 'locked':
                        locked += 1
                    else:
                        other += 1
            except Exception as e:
                print(f"   ⚠️  Could not list account statuses: {e}")
            print(f"   📈 Pool status after login: active={active}, suspended={suspended}, locked={locked}, other={other}")
            return active

        # Use more accounts for better speed and redundancy; attempt up to 3 samples until we get active accounts
        num_accounts_to_use = min(NUM_ACCOUNTS, len(df))
        attempts = 0
        max_attempts = min(3, len(df) // max(1, num_accounts_to_use)) or 1
        active_count = 0
        while attempts < max_attempts and active_count == 0:
            attempts += 1
            sample_df = df.sample(n=num_accounts_to_use)
            print(f"   🔑 Attempt {attempts}/{max_attempts}: setting up {len(sample_df)} Twitter accounts...")
            active_count = await add_and_login(sample_df)

        if active_count == 0:
            msg = "❌ No active accounts available after login. Cookies may be expired."
            if self.cookie_mode == 'cookies' and not self.allow_cookieless_fallback:
                print(msg + " Aborting due to cookie-only mode.")
                return api
            if self.allow_cookieless_fallback:
                print(msg + " Falling back to cookie-less mode (single worker).")
                self.is_cookie_less = True
            else:
                print(msg + " Update cookies_master.csv or enable fallback.")
        else:
            print("✅ API setup complete with active accounts.")

        return api

    async def scrape_user_tweets(self, api, user_data, job_id=None):
        """Scrapes tweets for a single user with a per-account probe and optional pool refresh."""
        actor_id = user_data["actor_id"]
        actor_type = user_data["actor_type"]
        handle = user_data["handle"]
        last_scrape = user_data.get("last_scrape")

        # Update job progress if job_id provided
        if job_id:
            self.update_scraping_job_progress(job_id, self.stats['accounts_processed'], handle)

        start_date = "2018-01-01"
        if last_scrape:
            try:
                last_dt = datetime.fromisoformat(str(last_scrape))
                # Go back one day to avoid missing posts near the boundary
                start_date = (last_dt - timedelta(days=1)).strftime('%Y-%m-%d')
            except Exception:
                pass

        try:
            # Step 1: Probe account existence and attempt search
            tweets = await self._search_with_probe(api, handle, start_date, MAX_RESULTS_PER_USER)

            if not tweets:
                return [], {"actor_id": actor_id, "handle": handle, "reason": "No tweets found"}

            # Transform tweet objects into rows
            tweets_data = []
            for tweet in tweets:
                try:
                    record = self._convert_tweet_to_record(tweet, actor_id, actor_type, handle)
                    tweets_data.append(record)
                except Exception as media_error:
                    print(f"   ⚠️ Warning: Error processing tweet {getattr(tweet, 'id', 'unknown')}: {media_error}")

            if not tweets_data:
                return [], {"actor_id": actor_id, "handle": handle, "reason": "No tweets found"}

            return tweets_data, None

        except Exception as e:
            return [], {"actor_id": actor_id, "handle": handle, "reason": str(e)}

    async def _search_with_probe(self, api, handle: str, start_date: str, limit: int):
        """Check account status with user_by_login, then search. If empty but account exists with tweets,
        refresh the pool via a fresh API and retry once.
        """
        # Probe existence
        user_obj = None
        try:
            user_obj = await api.user_by_login(handle)
        except Exception as e:
            print(f"   ⚠️ user_by_login error for @{handle}: {e}")

        if not user_obj:
            # As a sanity fallback, try a quick search limit 1 without date bounds
            try:
                async for t in api.search(f"from:{handle}", limit=1):
                    # If we can fetch one tweet, proceed with normal search
                    return await self._fetch_tweets_for_handle(api, handle, start_date, limit)
            except Exception:
                pass
            return []

        # Protected accounts cannot be scraped
        if getattr(user_obj, 'protected', False):
            print(f"   🔒 @{handle} is protected; skipping.")
            return []

        # Normal search
        tweets = await self._fetch_tweets_for_handle(api, handle, start_date, limit)
        if tweets:
            return tweets

        # If user has tweets but we couldn't fetch any, refresh and retry once
        statuses = getattr(user_obj, 'statusesCount', None)
        if isinstance(statuses, int) and statuses > 0:
            if not self.is_cookie_less:
                print(f"   🔁 @{handle}: user exists with {statuses} tweets but none returned; refreshing pool and retrying once...")
                try:
                    fresh_api = await self.setup_api(clear_cache=False)
                    if fresh_api:
                        # Re-probe to avoid 404/rename cases
                        try:
                            u2 = await fresh_api.user_by_login(handle)
                            if u2 and not getattr(u2, 'protected', False):
                                tweets = await self._fetch_tweets_for_handle(fresh_api, handle, start_date, limit)
                                if tweets:
                                    return tweets
                        except Exception as e:
                            print(f"   ⚠️ Retry probe failed for @{handle}: {e}")
                except Exception as e:
                    print(f"   ⚠️ Pool refresh failed: {e}")

        return []

    async def _fetch_tweets_for_handle(self, api, handle: str, start_date: str, limit: int):
        """Fetch tweets for a handle using the provided API and date bounds."""
        query = f"(from:{handle}) since:{start_date} until:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        tweets = []
        async for tweet in api.search(query, limit=limit):
            tweets.append(tweet)
        return tweets

    def _convert_tweet_to_record(self, tweet, actor_id, actor_type, handle):
        """Convert a twscrape tweet object to our record with media extraction."""
        media_urls = []
        try:
            if hasattr(tweet, 'media') and tweet.media:
                media_list = tweet.media if isinstance(tweet.media, list) else [tweet.media]
                for media in media_list:
                    if hasattr(media, 'url') and media.url:
                        media_urls.append(media.url)
                    elif hasattr(media, 'fullUrl') and media.fullUrl:
                        media_urls.append(media.fullUrl)
                    elif hasattr(media, 'mediaUrl') and media.mediaUrl:
                        media_urls.append(media.mediaUrl)

            if hasattr(tweet, 'photos') and tweet.photos:
                photos_list = tweet.photos if isinstance(tweet.photos, list) else [tweet.photos]
                media_urls.extend([photo.url for photo in photos_list if hasattr(photo, 'url')])

            if hasattr(tweet, 'videos') and tweet.videos:
                videos_list = tweet.videos if isinstance(tweet.videos, list) else [tweet.videos]
                for video in videos_list:
                    if hasattr(video, 'url') and video.url:
                        media_urls.append(video.url)
                    elif hasattr(video, 'thumbnailUrl') and video.thumbnailUrl:
                        media_urls.append(video.thumbnailUrl)
        except Exception as media_error:
            print(f"   ⚠️ Warning: Error extracting media for tweet {getattr(tweet, 'id', 'unknown')}: {media_error}")

        return {
            "actor_id": actor_id,
            "actor_type": actor_type,
            "handle": handle,
            "id": tweet.id,
            "date": tweet.date.isoformat() if tweet.date else None,
            "tweet content": tweet.rawContent,
            "url": tweet.url,
            "likeCount": tweet.likeCount,
            "replyCount": tweet.replyCount,
            "retweetCount": tweet.retweetCount,
            "username": tweet.user.username if tweet.user else handle,
            "display_name": tweet.user.displayname if tweet.user else "",
            "mentionedUsers": json.dumps([user.username for user in tweet.mentionedUsers]) if tweet.mentionedUsers else "[]",
            "hashtags": ";".join([tag for tag in tweet.hashtags]) if tweet.hashtags else "",
            "media_urls": json.dumps(media_urls) if media_urls else "[]"
        }

    def upload_to_supabase_storage(self, data, filename):
        """Upload CSV data to Supabase storage bucket"""
        try:
            if not data:
                print(f"   ⚠️  No data to upload for {filename}")
                return False
                
            # Convert data to CSV string
            df = pd.DataFrame(data)
            csv_string = df.to_csv(index=False)
            
            # Upload to raw-twitter-data bucket
            self.supabase.storage.from_('raw-twitter-data').upload(
                filename, 
                csv_string.encode('utf-8'),
                file_options={"content-type": "text/csv"}
            )
            
            print(f"   ☁️  Uploaded {filename} to Supabase storage (raw-twitter-data bucket)")
            self.stats['files_uploaded'] += 1
            return True
            
        except Exception as e:
            print(f"   ❌ Error uploading {filename} to Supabase storage: {e}")
            return False
    
    def save_batch_data(self, batch_number=None):
        """Save current pending tweets to storage and update timestamps for successful uploads"""
        if not self.pending_tweets:
            return True

        timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
        batch_suffix = f"_batch{batch_number}" if batch_number is not None else ""
        filename = f"twitter_{timestamp}{batch_suffix}_scraped.csv"

        print(f"\n💾 Saving batch with {len(self.pending_tweets)} tweets...")

        # Upload to Supabase storage (primary)
        upload_success = self.upload_to_supabase_storage(self.pending_tweets, filename)

        # Save local backup regardless
        local_success = self.save_local_backup(self.pending_tweets, filename)

        if upload_success:
            print(f"✅ Batch saved successfully: {len(self.pending_tweets)} tweets")

            # Update last_scrape timestamps ONLY for handles that had tweets in this batch
            unique_actor_ids = set()
            for tweet in self.pending_tweets:
                unique_actor_ids.add(tweet['actor_id'])

            # Use bulk RPC function instead of individual updates
            try:
                actor_ids_list = list(unique_actor_ids)
                result = self.supabase.rpc('bulk_update_last_scrape', {
                    'actor_ids': actor_ids_list
                }).execute()

                updated_count = result.data if result.data is not None else 0
                print(f"   📅 Updated {updated_count} handle timestamps in single bulk query")

                # Track successfully uploaded handles
                for tweet in self.pending_tweets:
                    if tweet['handle'] not in self.successfully_uploaded_handles:
                        self.successfully_uploaded_handles.append(tweet['handle'])
            except Exception as e:
                print(f"   ⚠️ Bulk timestamp update failed: {e}")
                print(f"   ⏭️  Falling back to individual updates...")
                # Fallback to old method if RPC fails
                successful_updates = 0
                for actor_id in unique_actor_ids:
                    # Find a handle for this actor_id
                    handle = next((t['handle'] for t in self.pending_tweets if t['actor_id'] == actor_id), None)
                    if handle and self.update_last_scrape_timestamp(actor_id, handle):
                        successful_updates += 1
                        if handle not in self.successfully_uploaded_handles:
                            self.successfully_uploaded_handles.append(handle)
                print(f"   📅 Updated {successful_updates}/{len(unique_actor_ids)} handle timestamps (fallback)")

            # Clear the pending tweets after successful upload
            self.pending_tweets = []
            return True
        else:
            print(f"❌ Failed to upload batch - keeping tweets in buffer")
            return False

    def save_local_backup(self, data, filename):
        """Save local backup of scraped data"""
        try:
            if not data:
                return False
                
            # Ensure output directory exists
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            local_path = os.path.join(OUTPUT_DIR, filename)
            
            # Save as CSV
            df = pd.DataFrame(data)
            df.to_csv(local_path, index=False)
            
            print(f"   💾 Local backup saved: {local_path}")
            return True
            
        except Exception as e:
            print(f"   ⚠️  Failed to save local backup: {e}")
            return False

    def create_scraping_job_record(self, total_handles):
        """Create a record in the v2_batches table to track progress"""
        try:
            job_id = str(uuid.uuid4())
            job_record = {
                'id': job_id,
                'job_type': 'twitter_scraping',
                'status': 'running',
                'started_at': datetime.now(timezone.utc).isoformat(),
                'total_posts': 0,
                'posts_processed': 0,
                'accounts_scraped': 0,
                'total_accounts': total_handles,
                'message': f'Starting Twitter scraping for {total_handles} handles',
                'current_batch': 0,
                'total_batches': max(1, total_handles),
                'worker_stats': json.dumps(self.stats),
                'batch_progress': json.dumps({"total": total_handles, "current": 0, "stats": self.stats}),
                'error_count': 0,
                'config': json.dumps({"platform": "twitter", "total_handles": total_handles})
            }
            
            result = self.supabase.table('v2_batches').insert(job_record).execute()
            
            if result.data:
                print(f"📋 Created v2_batch job record: {job_id}")
                return job_id
            
            return None
            
        except Exception as e:
            print(f"⚠️  Could not create job record: {e}")
            return None

    def update_scraping_job_progress(self, job_id, completed_handles, current_handle, status='running'):
        """Update progress in the v2_batches table - called after EVERY account"""
        if not job_id:
            return
            
        try:
            # Build the progress message
            total_accounts = getattr(self, 'total_handles', completed_handles)
            progress_msg = f'Processing @{current_handle} ({completed_handles}/{total_accounts})' if current_handle else f'Processed {completed_handles} handles'
            
            update_data = {
                'status': status,
                'posts_processed': self.stats.get('tweets_scraped', 0),
                'total_posts': self.stats.get('tweets_scraped', 0),
                'accounts_scraped': completed_handles,
                'message': progress_msg,
                'current_batch': completed_handles,
                'worker_stats': json.dumps(self.stats),
                'batch_progress': json.dumps({
                    "total": total_accounts,
                    "current": completed_handles,
                    "stats": self.stats
                }),
                'error_count': self.stats.get('failed_accounts', 0)
            }
            
            if status in ['completed', 'failed']:
                update_data['completed_at'] = datetime.now(timezone.utc).isoformat()
                update_data['message'] = f'Twitter scraping {status}: {self.stats.get("tweets_scraped", 0)} tweets from {completed_handles} handles'
            
            self.supabase.table('v2_batches').update(update_data).eq('id', job_id).execute()

        except Exception as e:
            print(f"⚠️  Could not update job progress: {e}")

    def update_last_scrape_timestamp(self, actor_id, handle):
        """Update the last_scrape timestamp for a handle - only called after successful upload"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            print(f"DEBUG: Updating last_scrape for @{handle} to {now}")
            result = self.supabase.table('v2_actor_usernames')\
                .update({'last_scrape': now})\
                .eq('actor_id', actor_id)\
                .eq('username', handle)\
                .eq('platform', 'twitter')\
                .execute()

            print(f"DEBUG: Update result: {result.data}")
            if result.data:
                print(f"   📅 Updated last_scrape timestamp for @{handle}")
                return True
            return False

        except Exception as e:
            print(f"   ⚠️ Could not update last_scrape for @{handle}: {e}")
            return False

    async def run_scraping_session(self):
        """Main scraping function - called by web interface or directly"""
        print("🚀 Starting Twitter Database Scraper\n")
        
        # Get handles from database where should_scrape = TRUE
        twitter_data = self.get_twitter_handles_from_database()
        if not twitter_data:
            print("❌ No Twitter handles found for scraping.")
            print("💡 To fix this:")
            print("   1. Open the Scraping Manager web interface")
            print("   2. Use the quick selectors or individual selection")
            print("   3. Re-run this scraper")
            return
        
        # Store total handles for progress tracking
        self.total_handles = len(twitter_data)
        
        # Create job record for tracking
        job_id = self.create_scraping_job_record(len(twitter_data))

        if hasattr(self, 'job_progress'):
            self.job_progress["total_accounts"] = len(twitter_data)
        
        # Setup Twitter API
        api = await self.setup_api()
        if api is None:
            print("❌ API setup failed. Check your cookies_master.csv file.")
            if job_id:
                self.update_scraping_job_progress(job_id, 0, None, 'failed')
            return
        
        # Process users concurrently for better speed
        print(f"\n🔄 Processing {len(twitter_data)} Twitter accounts concurrently...\n")
        
        all_tweets = []
        no_data_log = []
        
        # Process in concurrent batches to balance speed and rate limiting
        concurrent_batch_size = min(TWITTER_CONCURRENT_BATCH_SIZE, len(twitter_data))  # Process up to N accounts at once
        if self.is_cookie_less:
            concurrent_batch_size = 1
            print("   ⚠️ Cookie-less mode: limiting concurrency to 1 to avoid rate limits.")
        
        for batch_start in range(0, len(twitter_data), concurrent_batch_size):
            # Check for cancellation signal before processing each batch
            if self.check_cancellation_signal():
                print("🛑 Scraping cancelled by user - finishing current batch...")
                # Save any pending tweets before stopping
                if self.pending_tweets:
                    self.save_batch_data()
                # Update job status
                self.update_scraping_job_progress(job_id, len(twitter_data), None, 'cancelled')
                return
                
            batch_end = min(batch_start + concurrent_batch_size, len(twitter_data))
            batch = twitter_data[batch_start:batch_end]
            
            # Create tasks for concurrent execution
            tasks = []
            for user_data in batch:
                task = self.scrape_user_tweets(api, user_data, job_id)
                tasks.append(task)
            
            # Execute batch concurrently
            batch_results = await asyncio.gather(*tasks)
            
            # Collect batch statistics
            batch_tweets = 0
            batch_success = 0
            batch_failed = 0
            batch_failures = []  # Track failure reasons
            
            # Process results
            for i, (user_data, (tweets, error_log)) in enumerate(zip(batch, batch_results)):
                handle = user_data['handle']
                absolute_index = batch_start + i + 1

                if tweets:
                    all_tweets.extend(tweets)
                    self.pending_tweets.extend(tweets)  # Add to pending buffer
                    self.stats['tweets_scraped'] += len(tweets)
                    self.stats['accounts_processed'] += 1
                    batch_tweets += len(tweets)
                    batch_success += 1
                else:
                    self.stats['failed_accounts'] += 1
                    batch_failed += 1
                    if error_log:
                        reason = error_log.get('reason', 'Unknown error')
                        batch_failures.append(f"@{handle}: {reason}")
                        
                        # Track handles with no tweets found specifically
                        if "No tweets found" in reason:
                            self.no_tweets_found_handles.append({
                                'handle': handle,
                                'actor_id': user_data.get('actor_id'),
                                'actor_type': user_data.get('actor_type'),
                                'timestamp': datetime.now(timezone.utc).isoformat()
                            })

                if error_log:
                    no_data_log.append(error_log)
                
                # Update v2_batches progress after EVERY account
                if job_id:
                    self.update_scraping_job_progress(job_id, absolute_index, handle, 'running')

                if hasattr(self, 'job_progress'):
                    self.job_progress.update({
                        "total_tweets": len(all_tweets),
                        "completed_accounts": absolute_index,
                        "current_handle": f"✅ {handle}"
                    })
                
                # Periodically save batches to avoid data loss
                if len(self.pending_tweets) >= TWITTER_SAVE_BATCH_SIZE:
                    batch_num = (absolute_index // TWITTER_SAVE_BATCH_SIZE) + 1
                    self.save_batch_data(batch_num)
            
            # Print batch summary
            print(f"📊 Batch {batch_start//concurrent_batch_size + 1} complete: {batch_success} accounts scraped, {batch_tweets} tweets collected, {batch_failed} failed [{batch_start+1}-{batch_end}/{len(twitter_data)}]")
            
            # Show failure reasons if any
            if batch_failures:
                # Group failures by reason for cleaner output
                failure_counts = {}
                for failure in batch_failures:
                    # Extract reason pattern
                    if "No tweets found" in failure:
                        reason = "No tweets found"
                    elif "User not found" in failure:
                        reason = "User not found"
                    elif "suspended" in failure.lower():
                        reason = "Account suspended"
                    elif "protected" in failure.lower():
                        reason = "Protected account"
                    elif "rate limit" in failure.lower():
                        reason = "Rate limited"
                    else:
                        reason = failure.split(": ", 1)[-1][:50]  # First 50 chars of error
                    
                    failure_counts[reason] = failure_counts.get(reason, 0) + 1
                
                # Print failure summary
                failure_summary = ", ".join([f"{count}x {reason}" for reason, count in failure_counts.items()])
                print(f"   ⚠️  Failures: {failure_summary}")

            # Delay between batches to avoid overwhelming the API
            if batch_end < len(twitter_data):
                await asyncio.sleep(TWITTER_BATCH_DELAY)
                print(f"⏸️  Brief pause ({TWITTER_BATCH_DELAY}s) before next batch...\n")
        
        # Save any remaining tweets in the final batch
        if self.pending_tweets:
            print(f"\n💾 Saving final batch with {len(self.pending_tweets)} tweets...")
            self.save_batch_data()
        
        if all_tweets:
            print(f"\n✅ Total tweets scraped and saved: {len(all_tweets)}")
            print(f"   📁 Files uploaded: {self.stats['files_uploaded']}")
            print(f"   📅 Handles with updated timestamps: {len(set(self.successfully_uploaded_handles))}")
        else:
            print("\n❌ No tweets were scraped in this session.")
        
        # Save error log if any failures
        if no_data_log:
            # Group failures by reason for summary
            failure_summary = {}
            for error in no_data_log:
                reason = error.get('reason', 'Unknown error')
                if "No tweets found" in reason:
                    reason = "No tweets found"
                elif "User not found" in reason:
                    reason = "User not found"
                elif "suspended" in reason.lower():
                    reason = "Account suspended"
                elif "protected" in reason.lower():
                    reason = "Protected account"
                elif "rate limit" in reason.lower():
                    reason = "Rate limited"
                
                failure_summary[reason] = failure_summary.get(reason, 0) + 1
            
            print(f"\n📊 Failure Summary ({len(no_data_log)} total failures):")
            for reason, count in sorted(failure_summary.items(), key=lambda x: -x[1]):
                print(f"   • {count}x {reason}")
            
            # Skip saving error log file to avoid issues
            print(f"   ℹ️  Error details: {len(no_data_log)} accounts had issues")
        
        # Final job update
        final_status = 'completed' if self.stats['accounts_processed'] > 0 else 'failed'
        self.update_scraping_job_progress(job_id, len(twitter_data), None, final_status)

        if hasattr(self, 'job_progress'):
            self.job_progress.update({
                "status": final_status,
                "total_tweets": len(all_tweets),
                "completed_accounts": len(twitter_data),
                "current_handle": None
            })
        
        # Print final statistics
        print("\n" + "="*50)
        print("📊 TWITTER SCRAPING SUMMARY")
        print("="*50)
        print(f"✅ Accounts processed: {self.stats['accounts_processed']}")
        print(f"🐦 Total tweets scraped: {self.stats['tweets_scraped']}")
        print(f"☁️  Files uploaded to Supabase: {self.stats['files_uploaded']}")
        print(f"📅 Handles with updated last_scrape: {len(set(self.successfully_uploaded_handles))}")
        if len(set(self.successfully_uploaded_handles)) < self.stats['accounts_processed']:
            failed_updates = self.stats['accounts_processed'] - len(set(self.successfully_uploaded_handles))
            print(f"⚠️  {failed_updates} handles will be re-scraped on next run (timestamp not updated)")
        print(f"❌ Failed accounts: {self.stats['failed_accounts']}")
        
        if self.stats['tweets_scraped'] > 0:
            avg_tweets = self.stats['tweets_scraped'] / max(self.stats['accounts_processed'], 1)
            print(f"📈 Average tweets per account: {avg_tweets:.1f}")
        
        print("\n🎉 Twitter scraping complete!")
        print("💡 Next steps:")
        print("   1. Run the post processor to process the scraped data")
        print("   2. Use the Actor Classifier to review any unknown actors")
        print("   3. Run the event processor to extract events from posts")
        
        if len(set(self.successfully_uploaded_handles)) < len(twitter_data):
            remaining = len(twitter_data) - len(set(self.successfully_uploaded_handles))
            print(f"\n⚠️  NOTE: {remaining} accounts may need re-scraping (timestamps not updated due to upload failures)")
        
        # Save log of accounts with no tweets found
        if hasattr(self, 'no_tweets_found_handles') and self.no_tweets_found_handles:
            self.save_no_tweets_log()
        elif hasattr(self, 'no_tweets_found_handles'):
            print(f"✅ All {self.stats['accounts_processed']} processed accounts had tweets found")

    def save_no_tweets_log(self):
        """Save log of accounts with no tweets found to file and database"""
        import os
        import json
        from datetime import datetime
        
        if not hasattr(self, 'no_tweets_found_handles') or not self.no_tweets_found_handles:
            return
        
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            # Create logs directory if it doesn't exist
            logs_dir = "data/logs/twitter_scraper"
            os.makedirs(logs_dir, exist_ok=True)
            
            # Save to file
            log_filename = f"{logs_dir}/no_tweets_found_{timestamp}.json"
            log_data = {
                'timestamp': datetime.now().isoformat(),
                'job_id': getattr(self, 'job_id', 'unknown'),
                'total_accounts_processed': self.stats.get('accounts_processed', 0),
                'accounts_with_no_tweets': len(self.no_tweets_found_handles),
                'accounts': self.no_tweets_found_handles
            }
            
            with open(log_filename, 'w') as f:
                json.dump(log_data, f, indent=2)
            
            print(f"\n📄 Saved no-tweets log: {log_filename}")
            print(f"   📊 {len(self.no_tweets_found_handles)} accounts had no tweets found")
            
            # Also save to database for easy querying
            try:
                self.supabase.table('v2_scraper_logs').insert({
                    'job_id': getattr(self, 'job_id', 'unknown'),
                    'platform': 'twitter',
                    'log_type': 'no_tweets_found',
                    'log_data': log_data,
                    'accounts_count': len(self.no_tweets_found_handles),
                    'created_at': datetime.now().isoformat()
                }).execute()
                print(f"   💾 Log also saved to database (v2_scraper_logs table)")
            except Exception as db_error:
                print(f"   ⚠️  Could not save to database: {db_error}")
                
        except Exception as e:
            print(f"❌ Error saving no-tweets log: {e}")

    def reset_scraping_selections(self):
        """Reset all should_scrape flags to False (utility function)"""
        try:
            result = self.supabase.table('v2_actor_usernames')\
                .update({'should_scrape': False})\
                .eq('platform', 'twitter')\
                .execute()
            
            count = len(result.data) if result.data else 0
            print(f"🔄 Reset {count} Twitter handles to should_scrape = False")
            return count
            
        except Exception as e:
            print(f"❌ Error resetting scraping selections: {e}")
            return 0

async def main():
    """Main async function - can be called directly or from API"""
    scraper = TwitterScraper()
    await scraper.run_scraping_session()

if __name__ == "__main__":
    asyncio.run(main())
