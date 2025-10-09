"""
Optimized Social Media Post Processor
Uses database-side deduplication and batch operations for better performance
"""

import pandas as pd
import json
import os
import re
import uuid
import io
import argparse
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Set
from utils.database import get_supabase, fetch_all_rows
from config.settings import TEST_MODE, MAX_TEST_RECORDS, OUTPUT_DIR
import hashlib


class SocialMediaProcessor:
    def __init__(self, skip_cache_loading=False, load_post_ids=False):
        self.supabase = get_supabase()
        self.stats = {
            "files_processed": 0,
            "posts_processed": 0,
            "posts_inserted": 0,
            "new_actors_discovered": 0,
            "mention_count_updates": 0,
            "duplicates_skipped": 0,
            "post_actor_links_created": 0,
            "hashtags_processed": 0,
            "new_hashtags_discovered": 0,
            "hashtag_actor_links_created": 0,
            "unknown_actor_links_created": 0,
            "files_moved_to_processed": 0,
            "errors": 0,
        }
        
        # For backward compatibility, allow loading all post IDs if requested
        self.existing_post_ids = set()
        if load_post_ids:
            print("📋 Loading existing post IDs (this may take a while)...")
            self.existing_post_ids = self.load_existing_post_ids()

        if not skip_cache_loading:
            # Only load essential caches
            print("📋 Loading known usernames...")
            self.known_usernames = self.load_known_usernames()
            
            print("🔗 Building actor lookup cache...")
            self.actor_lookup_cache = self.build_actor_lookup_cache()
            
            print("📋 Loading existing unknown actors...")
            self.unknown_actors_cache = self.load_existing_unknown_actors()
        else:
            self.known_usernames = set()
            self.actor_lookup_cache = {}
            self.unknown_actors_cache = {}

        # Instead of loading all post IDs, we'll track only the current session
        self.session_post_ids = set()
        
        # Batch duplicate checks
        self.duplicate_check_batch = []
        self.duplicate_check_batch_size = 1000

    def load_existing_post_ids(self):
        """Load all existing post IDs into memory for duplicate checking"""
        try:
            print("   📋 Loading post IDs from database...")
            query = self.supabase.table("v2_social_media_posts").select("post_id, platform")
            rows = fetch_all_rows(query)
            
            existing = set()
            for record in rows:
                platform = self.normalize_platform_name(record["platform"])
                post_id = record["post_id"]
                existing.add(f"{platform}:{post_id}")
            
            print(f"   📋 Loaded {len(existing)} existing post IDs")
            return existing
            
        except Exception as e:
            print(f"   ⚠️  Warning: Could not load existing post IDs: {e}")
            return set()
    
    def clean_emoji_symbols(self, text):
        """Clean emoji symbols and special characters from text"""
        if not text:
            return ""
        # Basic cleaning - remove control characters
        text = ''.join(char for char in text if ord(char) >= 32 or char == '\n')
        return text.strip()
    
    def parse_mentioned_users(self, mentioned_users_raw):
        """Parse mentioned users from various formats and normalize them"""
        if not mentioned_users_raw:
            return []
        
        mentions = []
        try:
            if isinstance(mentioned_users_raw, str):
                # Try parsing as JSON first
                if mentioned_users_raw.startswith('['):
                    raw_mentions = json.loads(mentioned_users_raw)
                else:
                    # Otherwise split by semicolon
                    raw_mentions = [u.strip() for u in mentioned_users_raw.split(';') if u.strip()]
            elif isinstance(mentioned_users_raw, list):
                raw_mentions = mentioned_users_raw
            else:
                return []
            
            # Normalize each mention (lowercase, strip @)
            for mention in raw_mentions:
                if mention:
                    normalized = str(mention).strip().lstrip('@').lower()
                    if normalized:
                        mentions.append(normalized)
        except:
            pass
        
        return mentions
    
    def parse_hashtags(self, hashtags_raw):
        """Parse hashtags from field"""
        if not hashtags_raw:
            return []
        
        try:
            if isinstance(hashtags_raw, str):
                # Split by semicolon
                return [h.strip() for h in hashtags_raw.split(';') if h.strip()]
            elif isinstance(hashtags_raw, list):
                return hashtags_raw
        except:
            pass
        
        return []
    
    def extract_hashtags_from_text(self, text):
        """Extract hashtags from text content"""
        if not text:
            return []
        
        # Find all hashtags
        hashtags = re.findall(r'#\w+', text)
        return list(set(hashtags))
    
    def force_utc(self, timestamp):
        """Force a timestamp to UTC timezone"""
        if not timestamp:
            return None
        
        try:
            if isinstance(timestamp, str):
                # Parse ISO format
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            elif isinstance(timestamp, (int, float)):
                # Handle Unix timestamps (seconds since epoch)
                # Instagram uses Unix timestamps for taken_at field
                dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
            elif isinstance(timestamp, datetime):
                dt = timestamp
            else:
                return None
            
            # Ensure UTC timezone
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            
            return dt.isoformat()
        except:
            return None
    
    def normalize_platform_name(self, platform):
        """Normalize platform names to handle variations"""
        platform_lower = platform.lower()
        
        if platform_lower in ["twitter", "x"]:
            return "twitter"
        elif platform_lower == "instagram":
            return "instagram"
        elif platform_lower == "tiktok":
            return "tiktok"
        elif platform_lower in ["truth_social", "truthsocial", "truth"]:
            return "truth_social"
        else:
            return platform_lower

    def load_known_usernames(self):
        """Load all known usernames from actor_usernames table"""
        try:
            query = self.supabase.table("v2_actor_usernames").select("username, platform")
            rows = fetch_all_rows(query)
            
            known = set()
            for record in rows:
                platform = self.normalize_platform_name(record["platform"])
                username = record["username"].strip().lstrip("@").lower()
                known.add(f"{platform}:{username}")
            
            print(f"📋 Loaded {len(known)} known usernames")
            return known
            
        except Exception as e:
            print(f"⚠️  Warning: Could not load known usernames: {e}")
            return set()

    def load_existing_unknown_actors(self):
        """Load existing unknown actors keyed by platform:username"""
        try:
            query = self.supabase.table("v2_unknown_actors").select(
                "id, detected_username, platform, mention_count, author_count"
            )
            rows = fetch_all_rows(query)
            
            existing = {}
            for record in rows:
                platform = self.normalize_platform_name(record["platform"])
                username = record["detected_username"].strip().lstrip("@").lower()
                key = f"{platform}:{username}"
                existing[key] = {
                    "id": record["id"],
                    "mention_count": record.get("mention_count", 0) or 0,
                    "author_count": record.get("author_count", 0) or 0,
                }
            
            print(f"📋 Loaded {len(existing)} existing unknown actors")
            return existing
            
        except Exception as e:
            print(f"⚠️  Warning: Could not load existing unknown actors: {e}")
            return {}

    def build_actor_lookup_cache(self):
        """Build a lookup cache for actors by username and platform"""
        cache = {}
        
        try:
            # Load all actor usernames with their actor details
            query = self.supabase.table("v2_actor_usernames").select(
                "username, platform, actor_id, actor_type"
            )
            rows = fetch_all_rows(query)
            
            for record in rows:
                platform = self.normalize_platform_name(record["platform"])
                username = record["username"].strip().lstrip("@").lower()
                key = f"{platform}:{username}"
                cache[key] = {
                    "actor_id": record["actor_id"],
                    "actor_type": record["actor_type"],
                }
            
            print(f"🔗 Built actor lookup cache with {len(cache)} entries")
            
        except Exception as e:
            print(f"⚠️  Warning: Could not build actor lookup cache: {e}")
        
        return cache

    def check_duplicates_batch(self, posts):
        """Check for duplicates in batch using database query"""
        if not posts:
            return set()
        
        # Extract unique post_id and platform pairs
        post_ids_by_platform = {}
        for post in posts:
            platform = self.normalize_platform_name(post.get("platform", ""))
            post_id = post.get("post_id", "")
            if post_id and platform:
                if platform not in post_ids_by_platform:
                    post_ids_by_platform[platform] = []
                post_ids_by_platform[platform].append(post_id)
        
        if not post_ids_by_platform:
            return set()
        
        duplicates = set()
        
        # Check each platform's posts in batches using IN operator
        for platform, post_ids in post_ids_by_platform.items():
            # Process in chunks to avoid URL length limits
            chunk_size = 50
            for i in range(0, len(post_ids), chunk_size):
                chunk = post_ids[i:i+chunk_size]
                try:
                    # Use IN operator for batch checking
                    result = self.supabase.table("v2_social_media_posts")\
                        .select("post_id, platform")\
                        .eq("platform", platform)\
                        .in_("post_id", chunk)\
                        .execute()
                    
                    # Add found posts to duplicates set
                    for row in (result.data or []):
                        lookup_key = f"{platform}:{row['post_id']}"
                        duplicates.add(lookup_key)
                        
                except Exception as e:
                    print(f"   ⚠️  Error checking batch of {len(chunk)} posts: {e}")
        
        return duplicates

    def is_duplicate_post(self, post_id, platform):
        """Check if a post is duplicate - checks session cache first, then database"""
        platform = self.normalize_platform_name(platform)
        lookup_key = f"{platform}:{post_id}"
        
        # Check session cache first
        if lookup_key in self.session_post_ids:
            return True
        
        # For batch checking
        self.duplicate_check_batch.append({"post_id": post_id, "platform": platform})
        
        # If batch is full, check database
        if len(self.duplicate_check_batch) >= self.duplicate_check_batch_size:
            duplicates = self.check_duplicates_batch(self.duplicate_check_batch)
            for d in duplicates:
                self.session_post_ids.add(d)
            self.duplicate_check_batch = []
        
        return lookup_key in self.session_post_ids

    def insert_posts_with_upsert(self, posts_to_insert):
        """Insert posts - check duplicates first then insert new ones"""
        if not posts_to_insert:
            return []
        
        # First, check which posts already exist
        print(f"   🔍 Checking for existing posts...")
        existing_lookup_keys = self.check_duplicates_batch(posts_to_insert)
        
        # Filter out duplicates
        new_posts = []
        for post in posts_to_insert:
            platform = self.normalize_platform_name(post["platform"])
            lookup_key = f"{platform}:{post['post_id']}"
            if lookup_key not in existing_lookup_keys and lookup_key not in self.session_post_ids:
                new_posts.append(post)
            else:
                self.stats["duplicates_skipped"] += 1
        
        if not new_posts:
            print(f"   ℹ️  All {len(posts_to_insert)} posts already exist (skipped)")
            return []
        
        print(f"   📝 Inserting {len(new_posts)} new posts ({len(posts_to_insert) - len(new_posts)} duplicates skipped)...")
        
        inserted_posts = []
        batch_size = 1000
        
        for i in range(0, len(new_posts), batch_size):
            batch = new_posts[i:i+batch_size]
            
            try:
                # Simple insert (no upsert needed since we already filtered duplicates)
                result = self.supabase.table("v2_social_media_posts")\
                    .insert(batch)\
                    .execute()
                
                if result.data:
                    inserted_posts.extend(result.data)
                    
                    # Add to session cache
                    for post in result.data:
                        platform = self.normalize_platform_name(post["platform"])
                        lookup_key = f"{platform}:{post['post_id']}"
                        self.session_post_ids.add(lookup_key)
                    
                    print(f"   ✅ Batch {i//batch_size + 1}/{(len(new_posts)-1)//batch_size + 1}: Inserted {len(result.data)} posts")
                
            except Exception as e:
                error_msg = str(e)
                if "duplicate" in error_msg.lower():
                    # This shouldn't happen since we filtered, but handle it anyway
                    print(f"   ℹ️  Batch {i//batch_size + 1}: Unexpected duplicates found")
                    self.stats["duplicates_skipped"] += len(batch)
                else:
                    print(f"   ⚠️  Error in batch {i//batch_size + 1}: {e}")
                    # Try individual inserts for debugging
                    for post in batch[:3]:  # Just try first 3 to see what's wrong
                        try:
                            result = self.supabase.table("v2_social_media_posts")\
                                .insert([post])\
                                .execute()
                            if result.data:
                                inserted_posts.extend(result.data)
                        except Exception as individual_error:
                            print(f"      Individual insert error: {individual_error}")
                            self.stats["duplicates_skipped"] += 1
                            break
        
        return inserted_posts

    def process_csv_file_optimized(self, file_content, filename, platform="twitter"):
        """Process a CSV file with optimized duplicate checking"""
        try:
            df = pd.read_csv(io.StringIO(file_content))
            
            if df.empty:
                print(f"   ⚠️  Empty file: {filename}")
                return
            
            print(f"   📊 Processing {len(df)} posts from {filename}")
            
            # Prepare posts for batch processing
            posts_to_check = []
            
            for index, row in df.iterrows():
                if TEST_MODE and index >= MAX_TEST_RECORDS:
                    break
                
                post_data = self.prepare_post_data(row, platform)
                if post_data:
                    posts_to_check.append(post_data)
            
            # Skip duplicate checking - let UPSERT handle it
            posts_to_insert = posts_to_check
            
            # Insert using upsert (will handle duplicates automatically)
            if posts_to_insert:
                inserted = self.insert_posts_with_upsert(posts_to_insert)
                self.stats["posts_inserted"] += len(inserted)
                
                # Process related data for inserted posts
                self.process_related_data(inserted)
            
            self.stats["posts_processed"] += len(posts_to_check)
            
        except Exception as e:
            print(f"   ❌ Error processing {filename}: {e}")
            self.stats["errors"] += 1

    def prepare_post_data(self, row, platform):
        """Prepare post data from CSV row"""
        try:
            # Clean the content text
            content_text = self.clean_emoji_symbols(
                str(row.get("tweet content", "") or row.get("content", ""))
            )
            
            # Skip posts with empty content
            if not content_text or content_text.strip() == "" or content_text.strip().lower() == "nan":
                return None
            
            author_handle = str(row.get("username", "")).strip()
            
            # Parse mentioned users
            mentioned_users_raw = row.get("mentionedUsers", "")
            mentioned_users = self.parse_mentioned_users(mentioned_users_raw)
            
            # Parse hashtags from dedicated field and from tweet text
            field_hashtags = self.parse_hashtags(row.get("hashtags", ""))
            text_hashtags = self.extract_hashtags_from_text(content_text)
            hashtags = list(dict.fromkeys(field_hashtags + text_hashtags))
            
            # Parse media URLs
            media_urls_raw = row.get("media_urls", "[]")
            try:
                if isinstance(media_urls_raw, str):
                    media_urls = json.loads(media_urls_raw) if media_urls_raw else []
                else:
                    media_urls = media_urls_raw or []
            except:
                media_urls = []
            
            # Handle special ID formats (like UUID@domain.org from calendar events)
            post_id = str(row.get("id", ""))
            if "@" in post_id:
                # Extract just the UUID part before @ sign
                post_id = post_id.split("@")[0]
            
            # Create post record
            return {
                "id": str(uuid.uuid4()),
                "post_id": post_id,
                "platform": platform,
                "post_url": str(row.get("url", "")),
                "author_handle": author_handle,
                "author_name": self.clean_emoji_symbols(str(row.get("display_name", ""))),
                "content_text": content_text,
                "post_timestamp": self.force_utc(row.get("date")),
                "media_urls": media_urls,
                "mentioned_users": mentioned_users,
                "hashtags": hashtags,
                "like_count": int(row.get("likeCount", 0)) if pd.notna(row.get("likeCount", 0)) else 0,
                "reply_count": int(row.get("replyCount", 0)) if pd.notna(row.get("replyCount", 0)) else 0,
                "share_count": int(row.get("retweetCount", 0)) if pd.notna(row.get("retweetCount", 0)) else 0,
                "location": "",
                "preprocessed_at": datetime.now(timezone.utc).isoformat(),
                "processed_for_events": False,
                "other_data": {},
            }
        except Exception as e:
            print(f"   ⚠️  Error preparing post data: {e}")
            return None

    def get_files_from_bucket(self, bucket_name):
        """Get list of ALL files from storage bucket with proper pagination"""
        try:
            all_files = []
            limit = 1000  # Max items per page
            offset = 0
            
            while True:
                # List files with pagination
                result = self.supabase.storage.from_(bucket_name).list(
                    options={"limit": limit, "offset": offset}
                )
                
                if not result:
                    break
                
                # Filter for data files, excluding processed folder
                for f in result:
                    name = f['name']
                    # Skip processed folder
                    if name.startswith('processed/'):
                        continue
                    if name.endswith(('.csv', '.json')):
                        all_files.append(name)
                
                # Check if we got fewer results than the limit (last page)
                if len(result) < limit:
                    break
                    
                offset += limit
                print(f"      📄 Listed {offset} items from {bucket_name}...")
            
            print(f"   📁 Found {len(all_files)} total files in {bucket_name}")
            return all_files
        except Exception as e:
            print(f"   ⚠️  Error listing files in {bucket_name}: {e}")
            return []
    
    def download_file_from_bucket(self, bucket_name, filename):
        """Download file content from storage bucket"""
        try:
            result = self.supabase.storage.from_(bucket_name).download(filename)
            return result
        except Exception as e:
            print(f"   ⚠️  Error downloading {filename} from {bucket_name}: {e}")
            return None
    
    def move_file_to_processed(self, bucket_name, filename):
        """Move file to processed folder with date subfolder in bucket"""
        try:
            # Create processed folder path with today's date
            today = datetime.now().strftime('%Y-%m-%d')
            processed_filename = f"processed/{today}/{filename}"
            
            # Download the file first
            file_content = self.download_file_from_bucket(bucket_name, filename)
            if not file_content:
                return False
            
            # Upload to processed/date folder with upsert to handle duplicates
            self.supabase.storage.from_(bucket_name).upload(
                processed_filename,
                file_content,
                file_options={
                    "content-type": "text/csv" if filename.endswith('.csv') else "application/json",
                    "upsert": "true"  # This will overwrite if file already exists
                }
            )
            
            # Delete original
            self.supabase.storage.from_(bucket_name).remove([filename])
            
            print(f"   📂 Moved {filename} to processed/{today}/")
            return True
            
        except Exception as e:
            print(f"   ⚠️  Error moving {filename} to processed: {e}")
            return False
    
    def prepare_instagram_post_data(self, post):
        """Prepare Instagram post data from JSON"""
        try:
            # Handle different Instagram data formats
            # Format 1: handle/username at top level
            # Format 2: owner dict with username inside (new Scrapfly format)
            
            author_handle = None
            
            # Check for handle/username at top level
            if "handle" in post or "username" in post:
                author_handle = post.get("handle", "") or post.get("username", "")
            # Check for owner dict with username inside (new format)
            elif "owner" in post and isinstance(post["owner"], dict):
                author_handle = post["owner"].get("username", "")
            
            if not author_handle:
                print(f"   ⚠️  Skipping post without handle/username")
                return None
            
            caption_text = self.clean_emoji_symbols(str(post.get("caption", "")))
            
            if not caption_text or caption_text.strip() == "" or caption_text.strip().lower() == "nan":
                return None
            
            # Parse mentioned users
            mentioned_users_raw = post.get("mentioned_users", "[]")
            try:
                if isinstance(mentioned_users_raw, str):
                    mentioned_users = json.loads(mentioned_users_raw)
                else:
                    mentioned_users = mentioned_users_raw or []
            except:
                mentioned_users = []
            
            # Parse hashtags
            hashtags_raw = post.get("hashtags", "")
            if isinstance(hashtags_raw, str) and hashtags_raw:
                field_hashtags = [tag.strip() for tag in hashtags_raw.split(";") if tag.strip()]
            else:
                field_hashtags = hashtags_raw or []
            
            text_hashtags = self.extract_hashtags_from_text(caption_text)
            hashtags = list(dict.fromkeys(list(field_hashtags) + text_hashtags))
            
            # Parse media URLs  
            media_urls_raw = post.get("media_urls", "[]")
            try:
                if isinstance(media_urls_raw, str):
                    media_urls = json.loads(media_urls_raw)
                else:
                    media_urls = media_urls_raw or []
            except:
                media_urls = []
            
            # Ensure we have a post ID
            post_id = str(post.get("id", "") or post.get("post_id", ""))
            if not post_id or post_id == "":
                print(f"   ⚠️  Skipping post without ID")
                return None
            
            # Get post URL (handle both formats)
            post_url = post.get("url", "") or post.get("post_url", "")
            
            # Get timestamp (handle both formats: 'date' or 'taken_at')
            timestamp = post.get("date") or post.get("taken_at")
            
            # Get author name from owner dict if available
            author_name = ""
            if "owner" in post and isinstance(post["owner"], dict):
                author_name = post["owner"].get("name", "")
            if not author_name:
                author_name = self.clean_emoji_symbols(post.get("display_name", ""))
            
            # Get media URLs - new format has src_url instead of media_urls
            if not media_urls and "src_url" in post:
                media_urls = [post["src_url"]]
            
            return {
                "id": str(uuid.uuid4()),
                "post_id": post_id,
                "platform": "instagram",
                "post_url": post_url,
                "author_handle": author_handle,
                "author_name": self.clean_emoji_symbols(author_name),
                "content_text": caption_text,
                "post_timestamp": self.force_utc(timestamp),
                "media_urls": media_urls,
                "mentioned_users": mentioned_users,
                "hashtags": hashtags,
                "like_count": int(post.get("like_count", 0)) if pd.notna(post.get("like_count", 0)) else 0,
                "reply_count": int(post.get("comment_count", 0)) if pd.notna(post.get("comment_count", 0)) else 0,
                "share_count": 0,
                "location": "",
                "preprocessed_at": datetime.now(timezone.utc).isoformat(),
                "processed_for_events": False,
                "other_data": {},
            }
            
        except Exception as e:
            print(f"   ⚠️  Error preparing Instagram post data: {e}")
            return None
    
    def discover_actors_from_posts(self, posts):
        """Aggregate unknown actor info from posts and create links"""
        from collections import defaultdict

        actor_mention_data = defaultdict(
            lambda: {
                "username": "",
                "platform": "",
                "first_seen": None,
                "last_seen": None,
                "context_text": "",
                "post_ids": [],
                "relationship_types": [],
                "mention_count": 0,
                "author_count": 0,
            }
        )

        for post in posts:
            platform = self.normalize_platform_name(post["platform"])
            post_timestamp = post["post_timestamp"]
            content_text = post["content_text"]
            post_id = post["id"]

            # Check author handle against known actors
            if post.get("author_handle"):
                # Normalize username to lowercase for case-insensitive comparison
                username_normalized = post["author_handle"].strip().lstrip("@").lower()
                key = f"{platform}:{username_normalized}"
                
                # Only track if NOT a known actor (case-insensitive check)
                if key not in self.known_usernames:
                    # Also check if this unknown actor already exists (case-insensitive)
                    unknown_key = f"{platform}:{username_normalized}"
                    
                    data = actor_mention_data[unknown_key]
                    data["username"] = username_normalized  # Store normalized version
                    data["platform"] = platform
                    data["context_text"] = data["context_text"] or content_text[:500]
                    data["post_ids"].append(post_id)
                    data["relationship_types"].append("author")
                    data["mention_count"] += 1
                    data["author_count"] += 1
                    if not data["first_seen"] or post_timestamp < data["first_seen"]:
                        data["first_seen"] = post_timestamp
                    if not data["last_seen"] or post_timestamp > data["last_seen"]:
                        data["last_seen"] = post_timestamp

            # Check mentioned users (already normalized)
            for mentioned_user in post.get("mentioned_users", []):
                if not mentioned_user:
                    continue
                # Already normalized in parse_mentioned_users
                username_normalized = mentioned_user
                key = f"{platform}:{username_normalized}"
                
                # Only track if NOT a known actor (case-insensitive check)
                if key not in self.known_usernames:
                    # Also check if this unknown actor already exists (case-insensitive)
                    unknown_key = f"{platform}:{username_normalized}"
                    
                    data = actor_mention_data[unknown_key]
                    data["username"] = username_normalized  # Store normalized version
                    data["platform"] = platform
                    data["context_text"] = data["context_text"] or content_text[:500]
                    data["post_ids"].append(post_id)
                    data["relationship_types"].append("mentioned")
                    data["mention_count"] += 1
                    if not data["first_seen"] or post_timestamp < data["first_seen"]:
                        data["first_seen"] = post_timestamp
                    if not data["last_seen"] or post_timestamp > data["last_seen"]:
                        data["last_seen"] = post_timestamp

        if not actor_mention_data:
            return

        # Separate new and existing unknown actors
        new_entries = {}
        existing_entries = {}
        for key, data in actor_mention_data.items():
            if key in self.unknown_actors_cache:
                existing_entries[key] = data
            else:
                new_entries[key] = data

        combined = {**existing_entries, **new_entries}
        id_map = self.bulk_upsert_unknown_actors(combined)

        # Create post-unknown-actor links
        link_records = []
        for key, data in actor_mention_data.items():
            actor_id = id_map.get(key)
            if not actor_id:
                continue
            for i, post_id in enumerate(data["post_ids"]):
                rel = (
                    data["relationship_types"][i]
                    if i < len(data["relationship_types"])
                    else "mentioned"
                )
                link_records.append(
                    {
                        "id": str(uuid.uuid4()),
                        "post_id": post_id,
                        "unknown_actor_id": actor_id,
                        "mention_context": rel,
                    }
                )

        if link_records:
            self.bulk_insert_unknown_actor_links(link_records)
    
    def bulk_upsert_unknown_actors(self, actor_data):
        """Upsert multiple unknown actors and update cache"""
        if not actor_data:
            return {}

        upsert_records = []
        id_map = {}
        new_count = 0
        updated_count = 0

        for key, data in actor_data.items():
            username = data["username"]
            platform = data["platform"]
            existing = self.unknown_actors_cache.get(key)

            if existing:
                updated_count += 1
                record = {
                    "id": existing["id"],
                    "detected_username": username,
                    "platform": platform,
                    "last_seen_date": data["last_seen"],
                }
                id_map[key] = existing["id"]
            else:
                new_count += 1
                actor_id = str(uuid.uuid4())
                record = {
                    "id": actor_id,
                    "detected_username": username,
                    "platform": platform,
                    "first_seen_date": data["first_seen"],
                    "last_seen_date": data["last_seen"],
                    "mention_count": data["mention_count"],
                    "author_count": data["author_count"],
                    "mention_context": (data["context_text"] or "")[:500],
                    "review_status": "pending",
                }
                id_map[key] = actor_id

            upsert_records.append(record)

        # Process upserts in batches
        batch_size = 1000
        for i in range(0, len(upsert_records), batch_size):
            batch = upsert_records[i:i+batch_size]
            try:
                result = self.supabase.table("v2_unknown_actors")\
                    .upsert(batch)\
                    .execute()
                
                # Update cache with results (case-insensitive keys)
                for row in (result.data or []):
                    # Ensure cache key is lowercase for case-insensitive lookups
                    cache_key = f"{self.normalize_platform_name(row['platform'])}:{row['detected_username'].strip().lstrip('@').lower()}"
                    self.unknown_actors_cache[cache_key] = {
                        "id": row["id"],
                        "mention_count": row.get("mention_count", 0) or 0,
                        "author_count": row.get("author_count", 0) or 0,
                    }
                    
            except Exception as e:
                print(f"   ⚠️  Error upserting unknown actors batch: {e}")

        if new_count:
            self.stats["new_actors_discovered"] += new_count
            print(f"   👥 Discovered {new_count} new unknown actors")
        if updated_count:
            self.stats["mention_count_updates"] += updated_count

        return id_map

    def bulk_insert_unknown_actor_links(self, link_records):
        """Insert post-unknown-actor links in batches, ensuring actors exist first"""
        if not link_records:
            return
        
        # First ensure all unknown actors are properly created
        unknown_actor_ids = set(link['unknown_actor_id'] for link in link_records)
        
        # Verify which actors exist
        existing_ids = set()
        for batch_start in range(0, len(list(unknown_actor_ids)), 1000):
            batch_ids = list(unknown_actor_ids)[batch_start:batch_start+1000]
            try:
                result = self.supabase.table("v2_unknown_actors")\
                    .select("id")\
                    .in_("id", batch_ids)\
                    .execute()
                existing_ids.update(r['id'] for r in (result.data or []))
            except Exception as e:
                print(f"   ⚠️  Error checking unknown actors: {e}")
        
        # Only insert links for actors that exist
        valid_links = [link for link in link_records if link['unknown_actor_id'] in existing_ids]
        
        if len(valid_links) < len(link_records):
            print(f"   ⚠️  Filtered out {len(link_records) - len(valid_links)} links for non-existent unknown actors")
        
        batch_size = 1000
        for i in range(0, len(valid_links), batch_size):
            batch = valid_links[i : i + batch_size]
            try:
                result = self.supabase.table("v2_post_unknown_actors")\
                    .upsert(batch, on_conflict="post_id,unknown_actor_id")\
                    .execute()
                inserted = len(result.data or [])
                self.stats["unknown_actor_links_created"] += inserted
            except Exception as e:
                if "duplicate" not in str(e).lower():
                    print(f"   ⚠️  Error inserting unknown actor links batch: {e}")
    
    def process_hashtags_from_posts(self, posts):
        """Process hashtags - track unique hashtags in hashtag table and create 'tagged' actor links"""
        from collections import defaultdict
        
        unique_hashtags = set()
        hashtag_to_posts = defaultdict(list)
        
        # Collect unique hashtags from posts
        for post in posts:
            platform = self.normalize_platform_name(post["platform"])
            post_id = post["id"]
            
            # Process hashtags from the hashtags field
            post_hashtags = post.get("hashtags", [])
            
            for hashtag in post_hashtags:
                if hashtag and hashtag.strip():
                    # Clean hashtag text and normalize to lowercase
                    clean_hashtag = hashtag.strip().lstrip("#").lower()
                    
                    if not clean_hashtag:
                        continue
                    
                    unique_hashtags.add(clean_hashtag)
                    hashtag_to_posts[clean_hashtag].append({
                        "post_id": post_id,
                        "platform": platform
                    })
        
        # Skip hashtag table tracking since v2_hashtags table doesn't exist
        # Just report the hashtag count for statistics
        if unique_hashtags:
            print(f"   #️⃣  Found {len(unique_hashtags)} unique hashtags (table tracking disabled)")
        
        # Check if any hashtags match known actor usernames and create "tagged" links
        tagged_links = []
        
        for hashtag_text, post_infos in hashtag_to_posts.items():
            # Check each platform for this hashtag
            platforms_seen = set()
            for post_info in post_infos:
                platforms_seen.add(post_info["platform"])
            
            # Check if this hashtag matches any known actor username
            for platform in platforms_seen:
                lookup_key = f"{platform}:{hashtag_text}"  # hashtag already lowercase
                
                # Check if this matches a known actor
                if lookup_key in self.actor_lookup_cache:
                    actor_info = self.actor_lookup_cache[lookup_key]
                    
                    # Create "tagged" relationship for all posts with this hashtag
                    for post_info in post_infos:
                        if post_info["platform"] == platform:
                            tagged_links.append({
                                "id": str(uuid.uuid4()),
                                "post_id": post_info["post_id"],
                                "actor_id": actor_info["actor_id"],
                                "actor_type": actor_info["actor_type"],
                                "relationship_type": "tagged",
                            })
        
        # Insert tagged links in batches
        if tagged_links:
            batch_size = 1000
            for i in range(0, len(tagged_links), batch_size):
                batch = tagged_links[i:i+batch_size]
                try:
                    self.supabase.table("v2_post_actors").insert(batch).execute()
                    self.stats["hashtag_actor_links_created"] += len(batch)
                except Exception as e:
                    if "duplicate" not in str(e).lower():
                        print(f"   ⚠️  Error creating hashtag-actor links: {e}")
            
            print(f"   🏷️  Created {len(tagged_links)} hashtag-to-actor 'tagged' links")
    
    def collect_known_actor_links(self, posts):
        """Create post-actor relationships for known authors and mentions"""
        link_records = []

        for post in posts:
            post_id = post.get("id")
            platform = self.normalize_platform_name(post.get("platform", ""))

            # Link author handle to actor
            author = post.get("author_handle")
            if author:
                username = author.strip().lstrip("@").lower()
                key = f"{platform}:{username}"
                actor_info = self.actor_lookup_cache.get(key)
                if actor_info:
                    link_records.append({
                        "id": str(uuid.uuid4()),
                        "post_id": post_id,
                        "actor_id": actor_info["actor_id"],
                        "actor_type": actor_info["actor_type"],
                        "relationship_type": "author",
                    })

            # Link mentioned users to actors (already normalized)
            for mention in post.get("mentioned_users", []):
                if not mention:
                    continue
                # Already normalized in parse_mentioned_users
                username = mention
                key = f"{platform}:{username}"
                actor_info = self.actor_lookup_cache.get(key)
                if actor_info:
                    link_records.append({
                        "id": str(uuid.uuid4()),
                        "post_id": post_id,
                        "actor_id": actor_info["actor_id"],
                        "actor_type": actor_info["actor_type"],
                        "relationship_type": "mentioned",
                    })

        # Insert in batches
        if link_records:
            batch_size = 1000
            for i in range(0, len(link_records), batch_size):
                batch = link_records[i : i + batch_size]
                try:
                    self.supabase.table("v2_post_actors").insert(batch).execute()
                    self.stats["post_actor_links_created"] += len(batch)
                except Exception as e:
                    if "duplicate" not in str(e).lower():
                        print(f"   ⚠️  Error creating post-actor links: {e}")
    
    def process_related_data(self, posts):
        """Process hashtags, mentions, etc for inserted posts"""
        if not posts:
            return
        
        try:
            # Process unknown actors and mentions
            self.discover_actors_from_posts(posts)
            
            # Process hashtags
            self.process_hashtags_from_posts(posts)
            
            # Create post-actor links for known actors
            self.collect_known_actor_links(posts)
            
        except Exception as e:
            print(f"   ⚠️  Error processing related data: {e}")

    def reprocess_instagram_from_processed(self):
        """Reprocess all Instagram JSON files from processed folders"""
        print("\n" + "=" * 60)
        print("🔄 REPROCESSING INSTAGRAM POSTS FROM PROCESSED FOLDERS")
        print("=" * 60)
        
        start_time = datetime.now()
        bucket_name = "raw-instagram-data"
        
        try:
            # List all files in processed folder and subfolders
            all_processed_files = []
            limit = 1000
            offset = 0
            
            print("📂 Scanning processed folders...")
            
            while True:
                result = self.supabase.storage.from_(bucket_name).list(
                    path="processed",
                    options={"limit": limit, "offset": offset}
                )
                
                if not result:
                    break
                    
                for item in result:
                    # Check if it's a folder (date folder)
                    if item.get('metadata', {}).get('mimetype') is None:
                        # It's a folder, list its contents
                        folder_name = item['name']
                        folder_result = self.supabase.storage.from_(bucket_name).list(
                            path=f"processed/{folder_name}",
                            options={"limit": 1000}
                        )
                        
                        for file_item in folder_result or []:
                            if file_item['name'].endswith('.json'):
                                all_processed_files.append(f"processed/{folder_name}/{file_item['name']}")
                    elif item['name'].endswith('.json'):
                        # Direct file in processed folder
                        all_processed_files.append(f"processed/{item['name']}")
                
                if len(result) < limit:
                    break
                offset += limit
            
            print(f"   📁 Found {len(all_processed_files)} Instagram JSON files to reprocess")
            
            # Process each file
            for filepath in all_processed_files:
                try:
                    print(f"\n📄 Reprocessing: {filepath}")
                    
                    # Download file
                    file_content = self.supabase.storage.from_(bucket_name).download(filepath)
                    if not file_content:
                        continue
                    
                    # Parse JSON
                    content_str = file_content.decode('utf-8')
                    data = json.loads(content_str)
                    
                    posts_to_process = []
                    for post in data:
                        post_data = self.prepare_instagram_post_data(post)
                        if post_data:
                            posts_to_process.append(post_data)
                    
                    if posts_to_process:
                        print(f"   📊 Processing {len(posts_to_process)} posts from {filepath}")
                        inserted = self.insert_posts_with_upsert(posts_to_process)
                        self.stats["posts_inserted"] += len(inserted)
                        self.process_related_data(inserted)
                    else:
                        print(f"   ⚠️  No valid posts found in {filepath}")
                    
                    self.stats["files_processed"] += 1
                    
                except Exception as e:
                    print(f"   ❌ Error reprocessing {filepath}: {e}")
                    self.stats["errors"] += 1
            
        except Exception as e:
            print(f"❌ Error scanning processed folders: {e}")
            return False
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print("\n" + "=" * 60)
        print("📊 REPROCESSING COMPLETE")
        print(f"⏱️  Duration: {duration:.2f} seconds")
        print("=" * 60)
        print(f"📁 Files reprocessed: {self.stats['files_processed']}")
        print(f"📦 Posts processed: {self.stats['posts_processed']}")
        print(f"✅ Posts inserted: {self.stats['posts_inserted']}")
        print(f"🔄 Duplicates skipped: {self.stats['duplicates_skipped']}")
        print(f"👥 New actors discovered: {self.stats['new_actors_discovered']}")
        if self.stats['errors'] > 0:
            print(f"⚠️  Errors encountered: {self.stats['errors']}")
        
        return True
    
    def process_all_files(self, migration=False):
        """Main processing function"""
        print("\n" + "=" * 60)
        print("🚀 OPTIMIZED POST PROCESSOR")
        print("=" * 60)
        
        start_time = datetime.now()
        
        # Get files from storage buckets
        twitter_files = self.get_files_from_bucket("raw-twitter-data")
        instagram_files = self.get_files_from_bucket("raw-instagram-data")
        
        # Process Twitter files
        for filename in twitter_files:
            try:
                print(f"\n📄 Processing Twitter file: {filename}")
                file_content = self.download_file_from_bucket("raw-twitter-data", filename)
                if file_content:
                    self.process_csv_file_optimized(file_content.decode('utf-8'), filename, "twitter")
                    self.stats["files_processed"] += 1
                    
                    # Move to processed folder if not in migration mode
                    if not migration:
                        self.move_file_to_processed("raw-twitter-data", filename)
                        self.stats["files_moved_to_processed"] += 1
            except Exception as e:
                print(f"   ❌ Error processing {filename}: {e}")
                self.stats["errors"] += 1
        
        # Process Instagram files  
        for filename in instagram_files:
            try:
                print(f"\n📄 Processing Instagram file: {filename}")
                file_content = self.download_file_from_bucket("raw-instagram-data", filename)
                if file_content:
                    # Instagram files are JSON
                    content_str = file_content.decode('utf-8')
                    data = json.loads(content_str)
                    
                    posts_to_check = []
                    for post in data:
                        if TEST_MODE and len(posts_to_check) >= MAX_TEST_RECORDS:
                            break
                        
                        post_data = self.prepare_instagram_post_data(post)
                        if post_data:
                            posts_to_check.append(post_data)
                    
                    # Update posts processed counter
                    self.stats["posts_processed"] += len(posts_to_check)
                    
                    # Process the batch - skip duplicate checking, let UPSERT handle it
                    if posts_to_check:
                        inserted = self.insert_posts_with_upsert(posts_to_check)
                        self.stats["posts_inserted"] += len(inserted)
                        self.process_related_data(inserted)
                    
                    self.stats["files_processed"] += 1
                    
                    # Move to processed folder if not in migration mode
                    if not migration:
                        self.move_file_to_processed("raw-instagram-data", filename)
                        self.stats["files_moved_to_processed"] += 1
                        
            except Exception as e:
                print(f"   ❌ Error processing {filename}: {e}")
                self.stats["errors"] += 1
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        print("\n" + "=" * 60)
        print("📊 PROCESSING COMPLETE")
        print(f"⏱️  Duration: {duration:.2f} seconds")
        print("=" * 60)
        print(f"📁 Files processed: {self.stats['files_processed']}")
        print(f"📦 Posts processed: {self.stats['posts_processed']}")
        print(f"✅ Posts inserted: {self.stats['posts_inserted']}")
        print(f"🔄 Duplicates skipped: {self.stats['duplicates_skipped']}")
        print(f"👥 New actors discovered: {self.stats['new_actors_discovered']}")
        print(f"#️⃣  Hashtags processed: {self.stats['hashtags_processed']}")
        print(f"📤 Files moved to processed: {self.stats['files_moved_to_processed']}")
        if self.stats['errors'] > 0:
            print(f"⚠️  Errors encountered: {self.stats['errors']}")
        
        return True


def main():
    """Main function for direct execution"""
    parser = argparse.ArgumentParser(description="Optimized post processor")
    parser.add_argument("--migration", action="store_true")
    parser.add_argument("--skip-cache", action="store_true", 
                      help="Skip loading caches for faster startup")
    parser.add_argument("--reprocess-instagram", action="store_true",
                      help="Reprocess all Instagram JSON files from processed folders")
    args = parser.parse_args()
    
    try:
        processor = SocialMediaProcessor(skip_cache_loading=args.skip_cache)
        
        if args.reprocess_instagram:
            # Reprocess Instagram files from processed folders
            processor.reprocess_instagram_from_processed()
        else:
            processor.process_all_files(migration=args.migration)
        return 0
    except KeyboardInterrupt:
        print("\n⚠️  Processing interrupted by user")
        return 1
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        return 1


if __name__ == "__main__":
    exit(main())