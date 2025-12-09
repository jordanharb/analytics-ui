"""
Instagram Post Scraper using Scrapfly - FIXED VERSION WITH PROPER ERROR SKIPPING
Now properly skips accounts that have profile errors (like account_not_found)
"""
import sys
from pathlib import Path

# Ensure repo + analytics-ui directories are present on sys.path so imports work
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

import argparse
import asyncio
import os
import json
import time
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
from utils.database import get_supabase
from automation.utils.database import fetch_all_rows
from loguru import logger as log
from scrapfly import ScrapeConfig, ScrapflyClient
import jmespath
from urllib.parse import urlencode

# Load environment variables
load_dotenv()

# --- Scrapfly API Configuration ---
try:
    SCRAPFLY_KEY = os.environ["SCRAPFLY_KEY"]
    if SCRAPFLY_KEY == "your_scrapfly_api_key_here":
        print("❌ SCRAPFLY_KEY is set to placeholder value. Please update your .env file.")
        SCRAPFLY = None
    else:
        SCRAPFLY = ScrapflyClient(key=SCRAPFLY_KEY)
        print(f"✅ Scrapfly API initialized for Instagram post scraping")
except KeyError:
    print("❌ SCRAPFLY_KEY environment variable is not set.")
    SCRAPFLY = None

# Base configuration for Scrapfly requests
BASE_CONFIG = {"asp": True, "country": "US", "cache": False}
INSTAGRAM_ACCOUNT_DOCUMENT_ID = "9310670392322965"

def parse_instagram_user_posts(data: Dict) -> Dict:
    """Parse Instagram user posts data using JMESPath"""
    result = jmespath.search(
        """{
        id: id,
        shortcode: code,
        src_url: image_versions2.candidates[0].url,
        alt_text: accessibility_caption,
        is_video: media_type,
        like_count: like_count,
        comment_count: comment_count,
        taken_at: taken_at,
        caption: caption.text,
        owner: {
            id: user.pk,
            username: user.username,
            name: user.full_name
        },
        location: location.name,
        tagged_users: usertags.in[].user.username,
        hashtags: caption_hashtags[].hashtag.name,
        post_url: join('', ['https://www.instagram.com/p/', code, '/'])
    }""",
        data,
    )
    return result

async def scrape_instagram_user_posts(username: str, page_size=12, max_pages: Optional[int] = None, stop_before_date: Optional[date] = None):
    """
    Scrape Instagram user posts using Scrapfly - based on scrapfly documentation
    This is the equivalent of the scrape_user_posts function from the examples
    
    Args:
        username: Instagram username to scrape
        page_size: Number of posts per page
        max_pages: Maximum pages to scrape
        stop_before_date: Stop scraping when encountering posts before this date (inclusive)
    """
    if not SCRAPFLY:
        raise Exception("Scrapfly client not initialized")
    
    log.info(f"🔍 Scraping Instagram posts for @{username}")
    if stop_before_date:
        log.info(f"📅 Will stop scraping when reaching posts on or before {stop_before_date}")
    else:
        log.info(f"🆕 Full scrape mode: Will scrape all available posts")
    
    base_url = "https://www.instagram.com/graphql/query/"
    variables = {
        "after": None,
        "before": None,
        "data": {
            "count": page_size,
            "include_reel_media_seen_timestamp": True,
            "include_relationship_info": True,
            "latest_besties_reel_media": True,
            "latest_reel_media": True
        },
        "first": page_size,
        "last": None,
        "username": username,
        "__relay_internal__pv__PolarisIsLoggedInrelayprovider": True,
        "__relay_internal__pv__PolarisShareSheetV3relayprovider": True
    }

    prev_cursor = None
    page_number = 1
    all_posts = []

    while True:
        try:
            # Build query parameters
            params = {
                "doc_id": INSTAGRAM_ACCOUNT_DOCUMENT_ID,
                "variables": json.dumps(variables, separators=(",", ":"))
            }
            
            final_url = f"{base_url}?{urlencode(params)}"
            
            result = await SCRAPFLY.async_scrape(ScrapeConfig(
                final_url, 
                **BASE_CONFIG, 
                method="GET",
                headers={"content-type": "application/x-www-form-urlencoded"}
            ))

            data = json.loads(result.content)
            
            if "data" not in data or not data["data"]:
                log.warning(f"No data found for @{username}")
                break
                
            posts_data = data["data"].get("xdt_api__v1__feed__user_timeline_graphql_connection")
            if not posts_data:
                log.warning(f"No posts data found for @{username}")
                break

            # Parse posts from this page
            posts_this_page = []
            should_stop = False
            
            log.debug(f"Processing {len(posts_data.get('edges', []))} posts from API response")
            
            for post_edge in posts_data.get("edges", []):
                try:
                    raw_post = post_edge["node"]
                    log.debug(f"Raw post keys: {list(raw_post.keys())}")
                    
                    parsed_post = parse_instagram_user_posts(raw_post)
                    if parsed_post:
                        # Check if we should stop based on date (incremental scraping)
                        if stop_before_date and parsed_post.get('taken_at'):
                            # Convert Unix timestamp to date
                            post_date = datetime.fromtimestamp(parsed_post['taken_at']).date()
                            
                            # For incremental scraping: stop when we reach posts older than or equal to last scrape date
                            if post_date <= stop_before_date:
                                log.info(f"📅 Reached post from {post_date} (on or before {stop_before_date}), stopping scrape for @{username}")
                                should_stop = True
                                break
                        
                        posts_this_page.append(parsed_post)
                        all_posts.append(parsed_post)
                        log.debug(f"Added post with shortcode: {parsed_post.get('shortcode', 'unknown')}")
                    else:
                        log.warning(f"Failed to parse post for @{username}")
                except Exception as e:
                    log.warning(f"Error parsing post for @{username}: {e}")
                    continue
            
            log.info(f"📄 Scraped {len(posts_this_page)} posts from page {page_number} for @{username}")
            
            # Stop if we hit the date limit
            if should_stop:
                log.info(f"🛑 Stopping scrape for @{username} due to date limit")
                break

            # Check for next page
            page_info = posts_data.get("page_info", {})
            if not page_info.get("has_next_page"):
                log.info(f"No more pages for @{username}")
                break

            if page_info.get("end_cursor") == prev_cursor:
                log.warning(f"Same cursor detected for @{username}, breaking")
                break

            prev_cursor = page_info.get("end_cursor")
            variables["after"] = prev_cursor
            page_number += 1

            if max_pages and page_number > max_pages:
                log.info(f"Reached max pages limit ({max_pages}) for @{username}")
                break
                
            # Rate limiting
            await asyncio.sleep(2)
            
        except Exception as e:
            error_msg = str(e)
            log.error(f"Error scraping page {page_number} for @{username}: {e}")

            # If this is an API error (401, 403, etc.), raise it so caller knows to not update last_scrape
            if "401" in error_msg or "Invalid API key" in error_msg or "403" in error_msg or "429" in error_msg:
                log.error(f"API authentication/rate limit error for @{username} - will not update last_scrape")
                raise Exception(f"API Error: {error_msg}")

            break

    log.info(f"✅ Scraped {len(all_posts)} total posts from @{username}")
    return all_posts

class InstagramPostScraper:
    def __init__(self, job_id=None):
        self.supabase = get_supabase()
        self.job_id = job_id
        self.console_output = []
        self.progress_callback = None
        self.cancellation_callback = None
        self.stats = {
            'total_handles': 0,
            'valid_handles': 0,
            'skipped_handles': 0,
            'skipped_errors': 0,
            'successful_scrapes': 0,
            'failed_scrapes': 0,
            'total_posts': 0,
            'empty_accounts': 0,
            'stopped_by_date': 0,
            'total_accounts': 0,
            'completed_accounts': 0,
            'current_handle': '',
            'skipped_recent': 0
        }
        self.session_id = None

    def log_console(self, message: str):
        """Add message to console output for real-time monitoring"""
        timestamp = datetime.now().isoformat()
        log_entry = {
            'timestamp': timestamp,
            'message': message
        }
        self.console_output.append(log_entry)
        
        # Also print to regular logs
        print(f"[{timestamp}] {message}")
        
        # Trigger progress callback if available
        if self.progress_callback:
            self.progress_callback(self.stats)

    def update_progress(self):
        """Update progress stats and trigger callback"""
        if self.progress_callback:
            self.progress_callback(self.stats)

    def check_cancellation_signal(self, job_id: str = None):
        """Check if job should be cancelled"""
        # Use provided job_id or instance job_id
        check_job_id = job_id or self.job_id
        if not check_job_id:
            return False
            
        # Use cancellation callback if available (from Celery task)
        if self.cancellation_callback:
            return self.cancellation_callback()
            
        # Fallback to direct database check
        try:
            result = self.supabase.table('v2_batches')\
                .select('control_signal, status')\
                .eq('id', check_job_id)\
                .execute()
                
            if result.data and len(result.data) > 0:
                job = result.data[0]
                if job.get('control_signal') == 'cancel' or job.get('status') == 'cancelling':
                    self.log_console(f"🛑 Cancellation signal received for job {check_job_id}")
                    return True
        except Exception as e:
            self.log_console(f"⚠️ Failed to check cancellation signal: {e}")
            
        return False

    def get_individual_last_scrape_date(self, handle_id: str, username: str) -> Optional[date]:
        """Get the last scrape date for an individual Instagram handle"""
        try:
            result = self.supabase.table('v2_actor_usernames')\
                .select('last_scrape')\
                .eq('id', handle_id)\
                .eq('platform', 'instagram')\
                .execute()
            
            if result.data and len(result.data) > 0:
                last_scrape = result.data[0]['last_scrape']
                if last_scrape:
                    # Extract just the date part
                    last_date = datetime.fromisoformat(last_scrape.replace('Z', '+00:00')).date()
                    print(f"📅 @{username} was last scraped on: {last_date}")
                    print(f"🔄 Incremental mode: Will only scrape posts newer than {last_date}")
                    return last_date
            
            print(f"🆕 @{username} has never been scraped - will scrape all available posts")
            return None
            
        except Exception as e:
            print(f"⚠️ Error checking last scrape date for @{username}: {e}")
            return None
    
    def update_last_scrape_timestamp(self, handle_id: str, username: str):
        """Update the last_scrape timestamp for a specific Instagram handle"""
        try:
            now = datetime.now(timezone.utc).isoformat()
            print(f"DEBUG: Updating last_scrape for @{username} (ID: {handle_id}) to {now}")
            
            result = self.supabase.table('v2_actor_usernames')\
                .update({'last_scrape': now})\
                .eq('id', handle_id)\
                .eq('platform', 'instagram')\
                .execute()

            print(f"DEBUG: Update result: {result.data}")
            if result.data:
                print(f"   📅 Updated last_scrape timestamp for @{username}")
            else:
                print(f"   ⚠️ No rows updated for @{username}")

        except Exception as e:
            print(f"   ⚠️ Could not update last_scrape for @{username}: {e}")
    
    def start_scraping_session(self) -> str:
        """Start a new scraping session and return session ID"""
        try:
            session_data = {
                'session_type': 'instagram_posts',
                'start_time': datetime.now(timezone.utc).isoformat(),
                'status': 'running',
                'platforms': ['instagram'],
                'posts_processed': 0,
                'error_count': 0,
                'configuration': {
                    'incremental': True,
                    'scraper_type': 'instagram_post_scraper_fixed',
                    'individual_handle_tracking': True,
                    'error_skipping': True
                }
            }
            
            result = self.supabase.table('scraping_sessions').insert(session_data).execute()
            
            if result.data and len(result.data) > 0:
                session_id = result.data[0]['id']
                print(f"🚀 Started scraping session: {session_id}")
                return session_id
            else:
                raise Exception("Failed to create scraping session")
                
        except Exception as e:
            print(f"❌ Error starting scraping session: {e}")
            raise
    
    def end_scraping_session(self, session_id: str, success: bool = True):
        """End the scraping session with final stats"""
        try:
            update_data = {
                'end_time': datetime.now(timezone.utc).isoformat(),
                'status': 'completed' if success else 'failed',
                'posts_processed': self.stats['total_posts'],
                'error_count': self.stats['failed_scrapes']
            }
            
            result = self.supabase.table('scraping_sessions')\
                .update(update_data)\
                .eq('id', session_id)\
                .execute()
            
            if result.data:
                status = "completed" if success else "failed"
                print(f"✅ Scraping session {status}: {session_id}")
            else:
                print(f"⚠️ Warning: Could not update session {session_id}")
                
        except Exception as e:
            print(f"❌ Error ending scraping session: {e}")
    
    def check_profile_has_error(self, profile_data: Any) -> bool:
        """
        Check if an actor's Instagram profile data contains an error

        OPTIMIZED VERSION: Uses pre-fetched profile data (no database query)
        """
        if profile_data is None:
            return False

        # Check if profile_data is a string containing 'error'
        if isinstance(profile_data, str) and 'error' in profile_data.lower():
            return True

        # Check if profile_data is a dict with an 'error' key
        if isinstance(profile_data, dict) and 'error' in profile_data:
            return True

        # Check if profile_data is a dict with error-related content
        if isinstance(profile_data, dict):
            profile_json_str = json.dumps(profile_data).lower()
            if 'error' in profile_json_str or 'account_not_found' in profile_json_str:
                return True

        return False
    
    def get_instagram_handles_for_post_scraping(self) -> List[Dict]:
        """
        Get Instagram handles for post scraping, filtering out accounts with profile errors and recently scraped accounts

        OPTIMIZED VERSION: Bulk profile fetch, pagination support, faster verification
        """
        try:
            print("📋 Loading Instagram handles for post scraping...")

            # Use fetch_all_rows for pagination (fetches ALL records, not just 1000)
            query = self.supabase.table('v2_actor_usernames')\
                .select('id, username, actor_id, actor_type, last_scrape')\
                .eq('platform', 'instagram')\
                .eq('should_scrape', True)\
                .order('id')  # Required for stable pagination

            handles_data = fetch_all_rows(query)

            if not handles_data or not isinstance(handles_data, list):
                print("❌ No handles data returned or invalid format")
                return []

            print(f"📊 Found {len(handles_data)} Instagram handles marked for scraping")

            # Bulk-fetch all profile data in batches (URL length limit with .in_() filter)
            print("⚡ Bulk-fetching profile data for validation...")
            actor_ids = list(set([h.get('actor_id') for h in handles_data if isinstance(h, dict) and h.get('actor_id')]))
            profile_data_map = {}

            if actor_ids:
                # Fetch in batches of 100 to avoid URL length limits
                batch_size = 100
                for i in range(0, len(actor_ids), batch_size):
                    batch = actor_ids[i:i + batch_size]
                    profiles_result = self.supabase.table('v2_actors')\
                        .select('id, instagram_profile_data')\
                        .in_('id', batch)\
                        .execute()

                    for profile in profiles_result.data:
                        profile_data_map[profile['id']] = profile.get('instagram_profile_data')

                print(f"✅ Loaded {len(profile_data_map)} profile records from {len(actor_ids)} actors")

            all_handles = []
            valid_handles = []
            skipped_handles = []
            recent_handles = []

            self.stats['total_handles'] = len(handles_data)
            self.stats['skipped_recent'] = 0

            # Calculate 7 days ago (one week)
            from datetime import datetime, timedelta
            seven_days_ago = datetime.now() - timedelta(days=7)

            for i, record in enumerate(handles_data, 1):
                handle_data = {
                    "handle_id": record['id'],
                    "actor_id": record['actor_id'],
                    "actor_type": record['actor_type'],
                    "username": record['username'].strip().lstrip('@'),
                    "last_scrape": record.get('last_scrape')
                }
                all_handles.append(handle_data)

                username = handle_data['username']

                # Show progress every 100 handles
                if i % 100 == 0 or i == len(handles_data):
                    print(f"🔍 Processing handles: {i}/{len(handles_data)}")

                # Check if account was scraped in the last 7 days (one week)
                if handle_data['last_scrape']:
                    try:
                        last_scrape_str = handle_data['last_scrape'].replace('Z', '+00:00')
                        last_scrape_dt = datetime.fromisoformat(last_scrape_str)
                        last_scrape_naive = last_scrape_dt.replace(tzinfo=None)
                        if last_scrape_naive > seven_days_ago:
                            skipped_handles.append(username)
                            recent_handles.append(handle_data)
                            self.stats['skipped_recent'] += 1
                            continue
                    except Exception:
                        pass  # If date parsing fails, proceed to scrape

                # Check if this account has profile errors (using bulk-fetched data)
                profile_data = profile_data_map.get(handle_data['actor_id'])
                if self.check_profile_has_error(profile_data):
                    skipped_handles.append(username)
                    self.stats['skipped_errors'] = self.stats.get('skipped_errors', 0) + 1
                else:
                    valid_handles.append(handle_data)
            
            self.stats['valid_handles'] = len(valid_handles)
            self.stats['skipped_handles'] = len(skipped_handles)
            
            print(f"\n📊 HANDLE FILTERING SUMMARY:")
            print(f"   📱 Total handles: {self.stats['total_handles']}")
            print(f"   ✅ Valid handles: {self.stats['valid_handles']}")
            print(f"   ⏭️ Skipped (errors): {self.stats.get('skipped_errors', 0)}")
            print(f"   ⏭️ Skipped (recent): {self.stats['skipped_recent']}")
            
            if recent_handles:
                print(f"\n📅 SKIPPED HANDLES (RECENTLY SCRAPED):")
                for i, handle in enumerate(recent_handles[:5], 1):  # Show first 5
                    print(f"   {i}. @{handle['username']} ({handle['actor_type']})")
                if len(recent_handles) > 5:
                    print(f"   ... and {len(recent_handles) - 5} more")
            
            return valid_handles
            
        except Exception as e:
            print(f"❌ Error loading Instagram handles: {e}")
            return []

    def save_posts_to_storage(self, username: str, posts: List[Dict]) -> bool:
        """Save posts to local raw-instagram-data directory"""
        try:
            # Save to local raw-instagram-data directory (parallel to data/output for Twitter)
            # Twitter uses data/output, so Instagram uses data/raw-instagram-data
            instagram_output_dir = os.path.join('data', 'raw-instagram-data')
            os.makedirs(instagram_output_dir, exist_ok=True)

            filename = f"{username}_posts.json"
            local_path = os.path.join(instagram_output_dir, filename)
            content = json.dumps(posts, indent=2, ensure_ascii=False)

            # Write to file
            with open(local_path, 'w', encoding='utf-8') as f:
                f.write(content)

            print(f"✅ Saved {len(posts)} posts for @{username} to {local_path}")
            return True

        except Exception as e:
            print(f"❌ Error saving posts for @{username}: {e}")
            return False

    async def run_post_scraping(self, max_pages: Optional[int] = None, force_full_scrape: bool = False) -> bool:
        """Main function to scrape Instagram posts with proper error skipping
        
        Args:
            max_pages: Maximum pages to scrape per account
            force_full_scrape: If True, ignore individual last scrape dates and scrape all posts
        """
        self.log_console("🚀 Starting Instagram Post Scraper (FIXED VERSION - Error Skipping Enabled)")
        
        if not SCRAPFLY:
            self.log_console("❌ Scrapfly API not configured. Cannot scrape Instagram posts.")
            return False
        
        # Start scraping session
        try:
            self.session_id = self.start_scraping_session()
        except Exception as e:
            self.log_console(f"❌ Failed to start scraping session: {e}")
            return False
        
        # Initialize v2_batch job tracking
        job_id = None
        
        try:
            # Get handles for post scraping (now with proper error filtering)
            handles = self.get_instagram_handles_for_post_scraping()
            
            if not handles:
                self.log_console("✅ No valid Instagram handles available for post scraping.")
                self.end_scraping_session(self.session_id, success=True)
                return True
            
            # Update stats
            self.stats['total_accounts'] = len(handles)
            self.stats['total_handles'] = len(handles)
            
            if force_full_scrape:
                self.log_console("🔄 Force full scrape mode: Ignoring all previous scrape dates")
            else:
                self.log_console("🔄 Individual handle tracking mode: Each handle uses its own last scrape date")
            
            self.log_console(f"🔄 Scraping posts for {len(handles)} valid Instagram handles...")
            self.update_progress()
            
            # Create v2_batch job for tracking
            try:
                job_id = str(uuid.uuid4())
                job_record = {
                    'id': job_id,
                    'job_type': 'instagram_scraping',
                    'status': 'running',
                    'started_at': datetime.now(timezone.utc).isoformat(),
                    'total_posts': 0,
                    'posts_processed': 0,
                    'accounts_scraped': 0,
                    'total_accounts': len(handles),
                    'message': f'Starting Instagram scraping for {len(handles)} handles',
                    'current_batch': 0,
                    'total_batches': len(handles),
                    'worker_stats': json.dumps(self.stats),
                    'batch_progress': json.dumps({"total": len(handles), "current": 0, "stats": self.stats}),
                    'error_count': 0,
                    'config': json.dumps({"platform": "instagram", "max_pages": max_pages, "force_full_scrape": force_full_scrape})
                }
                
                result = self.supabase.table('v2_batches').insert(job_record).execute()
                if result.data:
                    print(f"📋 Created v2_batch job record: {job_id}")
            except Exception as e:
                print(f"⚠️ Could not create job tracking: {e}")
            
            for i, handle_data in enumerate(handles, 1):
                username = handle_data['username']
                handle_id = handle_data['handle_id']
                
                # Check for cancellation signal before processing each account
                if self.check_cancellation_signal(job_id):
                    print("🛑 Instagram scraping cancelled by user - stopping gracefully...")
                    # Update job status
                    if job_id:
                        try:
                            self.supabase.table('v2_batches').update({
                                'status': 'cancelled',
                                'completed_at': datetime.now(timezone.utc).isoformat(),
                                'message': f'Scraping cancelled after processing {i-1} accounts',
                                'accounts_scraped': i-1,
                                'updated_at': datetime.now(timezone.utc).isoformat()
                            }).eq('id', job_id).execute()
                        except Exception as e:
                            print(f"⚠️ Could not update job status: {e}")
                    return False
                
                # Update current handle in stats
                self.stats['current_handle'] = username
                self.stats['completed_accounts'] = i - 1
                self.log_console(f"[{i}/{len(handles)}] Scraping posts for @{username}...")
                self.update_progress()
                
                try:
                    # Get individual last scrape date for this handle
                    last_scrape_date = None
                    if not force_full_scrape:
                        last_scrape_date = self.get_individual_last_scrape_date(handle_id, username)
                    
                    # Scrape posts for this handle with its specific date limit
                    posts = await scrape_instagram_user_posts(
                        username, 
                        max_pages=max_pages,
                        stop_before_date=last_scrape_date
                    )
                    
                    if posts:
                        # Save to storage
                        success = self.save_posts_to_storage(username, posts)
                        if success:
                            self.stats['successful_scrapes'] += 1
                            self.stats['total_posts'] += len(posts)
                            self.stats['completed_accounts'] = i
                            self.log_console(f"✅ Successfully scraped {len(posts)} posts for @{username}")
                            self.update_progress()

                            # Update last scrape timestamp for this specific handle
                            self.update_last_scrape_timestamp(handle_id, username)
                        else:
                            self.stats['failed_scrapes'] += 1
                            print(f"❌ Failed to save posts for @{username}")
                    else:
                        print(f"⚠️ No new posts found for @{username}")
                        # Still count as successful (account might be empty, private, or no new posts)
                        self.stats['successful_scrapes'] += 1
                        self.stats['empty_accounts'] += 1
                        self.save_posts_to_storage(username, [])  # Save empty file

                        # Update timestamp even if no new posts (prevents repeated checking)
                        self.update_last_scrape_timestamp(handle_id, username)

                except Exception as e:
                    error_msg = str(e)
                    print(f"❌ Error scraping @{username}: {e}")
                    self.stats['failed_scrapes'] += 1

                    # DO NOT update last_scrape for API errors - let it retry later
                    if "API Error" not in error_msg:
                        # Only for non-API errors, we might want to track this
                        pass
                
                # Update v2_batch progress after EVERY account
                if job_id:
                    try:
                        update_data = {
                            'status': 'running',
                            'posts_processed': self.stats.get('total_posts', 0),
                            'total_posts': self.stats.get('total_posts', 0),
                            'accounts_scraped': i,
                            'message': f'Processing @{username} ({i}/{len(handles)})',
                            'current_batch': i,
                            'worker_stats': json.dumps(self.stats),
                            'batch_progress': json.dumps({
                                "total": len(handles),
                                "current": i,
                                "stats": self.stats
                            }),
                            'error_count': self.stats.get('failed_scrapes', 0)
                        }
                        
                        self.supabase.table('v2_batches').update(update_data).eq('id', job_id).execute()
                    except Exception as e:
                        print(f"⚠️ Could not update job progress: {e}")
                
                # Rate limiting between accounts
                if i < len(handles):
                    print(f"   ⏱️ Waiting 3 seconds before next account...")
                    await asyncio.sleep(3)
            
            # End session successfully
            self.end_scraping_session(self.session_id, success=True)
            
            # Complete v2_batch job
            if job_id:
                try:
                    update_data = {
                        'status': 'completed',
                        'completed_at': datetime.now(timezone.utc).isoformat(),
                        'posts_processed': self.stats.get('total_posts', 0),
                        'total_posts': self.stats.get('total_posts', 0),
                        'accounts_scraped': len(handles),
                        'message': f'Instagram scraping completed: {self.stats.get("successful_scrapes", 0)} handles scraped, {self.stats.get("total_posts", 0)} posts collected',
                        'current_batch': len(handles),
                        'worker_stats': json.dumps(self.stats),
                        'batch_progress': json.dumps({
                            "total": len(handles),
                            "current": len(handles),
                            "stats": self.stats
                        }),
                        'error_count': self.stats.get('failed_scrapes', 0)
                    }
                    
                    self.supabase.table('v2_batches').update(update_data).eq('id', job_id).execute()
                    print(f"✅ V2 Batch job {job_id} marked as completed")
                except Exception as e:
                    print(f"⚠️ Could not complete job tracking: {e}")
            
            # Print final statistics
            self.print_final_stats(force_full_scrape)
            
            return True
            
        except Exception as e:
            print(f"❌ Critical error during scraping: {e}")
            if self.session_id:
                self.end_scraping_session(self.session_id, success=False)
            return False
    
    def print_final_stats(self, force_full_scrape: bool):
        """Print final scraping statistics"""
        print("\n" + "="*60)
        print("📊 INSTAGRAM POST SCRAPING SUMMARY")
        print("="*60)
        print(f"📱 Total handles checked: {self.stats['total_handles']}")
        print(f"✅ Valid handles processed: {self.stats['valid_handles']}")
        print(f"🚨 Skipped (profile errors): {self.stats['skipped_errors']}")
        print(f"📅 Skipped (recent scrapes): {self.stats.get('skipped_recent', 0)}")
        print(f"✅ Successful scrapes: {self.stats['successful_scrapes']}")
        print(f"❌ Failed scrapes: {self.stats['failed_scrapes']}")
        print(f"📄 Total posts scraped: {self.stats['total_posts']}")
        print(f"🔍 Empty accounts: {self.stats['empty_accounts']}")
        
        if force_full_scrape:
            print("🆕 Full scrape mode")
        else:
            print("🔄 Individual handle tracking mode")
        
        if self.stats['valid_handles'] > 0:
            success_rate = (self.stats['successful_scrapes'] / self.stats['valid_handles']) * 100
            print(f"📈 Success rate: {success_rate:.1f}%")
        
        print("\n🎉 Instagram post scraping complete!")
        print("💡 Next steps:")
        print("   1. Use 'Process Data' to clean and import posts to database")
        print("   2. Use 'Event Processing' to extract events from posts")
        print("\n🔧 FIXES APPLIED:")
        print("   ✅ Proper error skipping for accounts with profile errors")
        print("   ✅ Detailed logging to show which accounts are skipped and why")
        print("   ✅ Individual handle last_scrape tracking (like Twitter scraper)")
        print("   ✅ Per-handle timestamp updates after successful scraping")
        print("   ✅ No more scraping of account_not_found accounts")

async def main():
    parser = argparse.ArgumentParser(description='Run Instagram post scraper')
    parser.add_argument(
        '--max-pages',
        type=int,
        default=None,
        help='Maximum pages to scrape per account (<=0 for no limit)'
    )
    parser.add_argument(
        '--force-full-scrape',
        action='store_true',
        help='Ignore last scrape dates and re-scrape all posts'
    )

    args = parser.parse_args()

    scraper = InstagramPostScraper()
    max_pages = args.max_pages if args.max_pages and args.max_pages > 0 else None
    await scraper.run_post_scraping(max_pages=max_pages, force_full_scrape=args.force_full_scrape)

if __name__ == "__main__":
    asyncio.run(main())
