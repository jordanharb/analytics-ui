"""
Profile Scraper - Twitter profile scraper for unknown actors
Simplified version for post-processing integration
"""
import pandas as pd
import csv
import asyncio
import os
import re
import sys
from pathlib import Path
from twscrape import API, User
from datetime import datetime, timezone
import hashlib
import json

# Ensure repo + analytics-ui directories are importable for shared helpers
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

from utils.database import get_supabase, fetch_all_rows
from config.settings import (
    COOKIE_CSV,
    NUM_ACCOUNTS,
    OUTPUT_DIR,
    TEST_MODE,
    PROFILE_SCRAPER_CONCURRENCY,
)

# Configuration constants (instead of importing from config)
FORCE_RESCRAPE = False  # Set to True if you want to re-scrape existing profiles
DAYS_BEFORE_RECHECK = 30  # Days to wait before re-checking non-existent accounts
TEST_PROFILES_LIMIT = 10

class UnknownActorProfileManager:
    def __init__(self):
        self.supabase = get_supabase()
        self.stats = {
            'profiles_scraped': 0,
            'profiles_updated': 0,
            'accounts_nonexistent': 0,
            'accounts_private': 0,
            'accounts_suspended': 0,
            'errors': 0,
            'profile_data_populated': 0,
            'known_actors_processed': 0,
            'known_actors_about_populated': 0
        }

    def get_unknown_twitter_actors(self):
        """Fetch unknown Twitter actors that need profile scraping using pagination"""
        print("📋 Fetching unknown Twitter actors from database...")
        
        try:
            # Get unknown actors from Twitter platform that are pending review
            query = self.supabase.table('v2_unknown_actors')\
                .select('id, detected_username, platform, mention_count, author_count, x_profile_data')\
                .eq('platform', 'twitter')\
                .eq('review_status', 'pending')
            
            # Use fetch_all_rows to handle pagination automatically
            rows = fetch_all_rows(query)
            print(f"📋 Loaded {len(rows)} unknown Twitter actors from database (using pagination)")
            
            unknown_actors = []
            skipped_count = 0
            
            for record in rows:
                username = record['detected_username']
                if username and username.strip():
                    
                    # Check if already scraped recently
                    should_skip = self.check_if_recently_scraped(record)
                    
                    if should_skip:
                        skipped_count += 1
                        continue
                    
                    actor_data = {
                        'id': record['id'],
                        'username': username.strip(),
                        'mention_count': record.get('mention_count', 0),
                        'author_count': record.get('author_count', 0),
                        'existing_profile_data': record.get('x_profile_data')
                    }
                    
                    unknown_actors.append(actor_data)
            
            # Limit for test mode
            if TEST_MODE:
                unknown_actors = unknown_actors[:TEST_PROFILES_LIMIT]
                print(f"\n🧪 TEST MODE: Processing only {len(unknown_actors)} unknown actors")
                for actor in unknown_actors[:5]:  # Show first 5
                    print(f"   - @{actor['username']} (mentions: {actor['mention_count']}, posts: {actor['author_count']})")
                if len(unknown_actors) > 5:
                    print(f"   ... and {len(unknown_actors) - 5} more")
                print()
            else:
                print(f"✅ Found {len(unknown_actors)} unknown Twitter actors to process")
                if skipped_count > 0:
                    print(f"⏭️  Skipped {skipped_count} actors already scraped recently")
            
            # Sort by priority (mention_count + author_count)
            unknown_actors.sort(key=lambda x: x['mention_count'] + x['author_count'] * 2, reverse=True)
            
            if not TEST_MODE and len(unknown_actors) > 0:
                print(f"   📊 Processing in priority order (highest mention/author counts first)")
                print(f"   🥇 Top priority: @{unknown_actors[0]['username']} ({unknown_actors[0]['mention_count']} mentions, {unknown_actors[0]['author_count']} posts)")
            
            return unknown_actors
            
        except Exception as e:
            print(f"❌ Error fetching unknown actors: {e}")
            return []

    def check_if_recently_scraped(self, record):
        """Check if this unknown actor was recently scraped"""
        existing_profile_data = record.get('x_profile_data')
        
        if not existing_profile_data:
            return False
        
        # Check if it's a placeholder for non-accessible account
        if existing_profile_data.get('is_placeholder') and existing_profile_data.get('account_status') in ['non_existent', 'private', 'suspended']:
            
            # Check if enough time has passed to re-check non-existent accounts
            if existing_profile_data.get('checked_at'):
                try:
                    from datetime import datetime, timedelta
                    checked_date = datetime.fromisoformat(existing_profile_data['checked_at'].replace('Z', '+00:00'))
                    days_since_check = (datetime.now(checked_date.tzinfo) - checked_date).days
                    
                    if days_since_check >= DAYS_BEFORE_RECHECK:
                        print(f"   🔄 Re-checking @{existing_profile_data.get('username', 'unknown')} (last checked {days_since_check} days ago)")
                        return False  # Don't skip, re-check the account
                except:
                    pass  # If we can't parse the date, proceed with re-checking
            
            return True  # Skip this account
        
        # If it has real profile data and not forcing rescrape, skip
        if existing_profile_data.get('scraped_at') and not existing_profile_data.get('is_placeholder'):
            return True
        
        return False
    
    def get_known_actors_needing_profiles(self):
        """Fetch known actors (v2_actors) that need Twitter profile scraping"""
        print("\n🎯 Fetching known actors (v2_actors) that need Twitter profiles...")
        
        try:
            # Get Twitter handles with actor data in a single query using a join
            handles_query = self.supabase.table('v2_actor_usernames')\
                .select('id, username, actor_id, platform, v2_actors!inner(id, name, x_profile_data, about)')\
                .eq('platform', 'twitter')\
                .not_.is_('username', 'null')
            
            # If not forcing rescrape, only get handles without recent profile data
            if not FORCE_RESCRAPE:
                from datetime import datetime, timedelta
                thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat()
                handles_query = handles_query.or_(f'last_profile_update.is.null,last_profile_update.lt.{thirty_days_ago}')
            
            print("  📊 Fetching all actor data in single query...")
            handles_result = handles_query.execute()
            
            known_actors_needing_profiles = []
            actors_needing_twitter = 0
            actors_needing_about = 0
            
            for handle_record in handles_result.data:
                # Actor data is already included in the response
                actor = handle_record.get('v2_actors')
                if not actor:
                    continue
                    
                needs_profile = False
                reason = ""
                
                # Check if profile data is missing or empty
                if not actor.get('x_profile_data'):
                    needs_profile = True
                    reason = "missing Twitter profile data"
                    actors_needing_twitter += 1
                elif FORCE_RESCRAPE:
                    needs_profile = True
                    reason = "force re-scraping"
                elif not actor.get('about'):
                    # Also scrape if 'about' is empty, so we can populate it with bio
                    needs_profile = True
                    reason = "missing 'about' text"
                    actors_needing_about += 1
                
                if needs_profile:
                    known_actors_needing_profiles.append({
                        'id': handle_record['actor_id'],
                        'handle_id': handle_record['id'],
                        'username': handle_record['username'].strip().lstrip('@'),
                        'actor_name': actor['name'],
                        'has_about': bool(actor.get('about')),
                        'is_known_actor': True
                    })
                    
                    # Only print first 10 to avoid spam
                    if len(known_actors_needing_profiles) <= 10:
                        print(f"  ✅ {actor['name']} (@{handle_record['username']}) - {reason}")
                    elif len(known_actors_needing_profiles) == 11:
                        print(f"  ... and more actors needing profiles")
            
            print(f"📊 Found {len(known_actors_needing_profiles)} known actors needing Twitter profiles")
            if actors_needing_twitter > 0:
                print(f"   - {actors_needing_twitter} missing Twitter profile data")
            if actors_needing_about > 0:
                print(f"   - {actors_needing_about} missing 'about' text")
            return known_actors_needing_profiles
            
        except Exception as e:
            print(f"❌ Error fetching known actors: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def update_known_actor_profile(self, actor_id: str, handle_id: str, profile_data: dict, has_about: bool):
        """Update a known actor's Twitter profile data in v2_actors table"""
        try:
            from datetime import datetime
            
            # Prepare update data for v2_actors
            update_data = {
                'x_profile_data': profile_data,
                'last_profile_update': datetime.now().isoformat()
            }
            
            # If about is empty and we have a bio, populate it
            if not has_about and profile_data and not profile_data.get('is_placeholder'):
                bio = profile_data.get('rawDescription', '').strip()
                if bio and bio.lower() not in ['', 'null', 'none']:
                    # Clean up bio
                    bio = re.sub(r'[✩⭐️🇺🇸🦅🔥💪🙏❤️⚡️🌟🎉👑💎🚨⚔️🛡️]', '', bio)
                    bio = re.sub(r'\s+', ' ', bio).strip()
                    if len(bio) > 500:
                        bio = bio[:500] + '...'
                    update_data['about'] = bio
                    print(f"  📝 Populated empty 'about' field with Twitter bio")
                    self.stats['known_actors_about_populated'] += 1
            
            # Update v2_actors table
            result = self.supabase.table('v2_actors')\
                .update(update_data)\
                .eq('id', actor_id)\
                .execute()
            
            # Also update the v2_actor_usernames table
            if handle_id:
                self.supabase.table('v2_actor_usernames')\
                    .update({'last_profile_update': datetime.now().isoformat()})\
                    .eq('id', handle_id)\
                    .execute()
            
            if result.data:
                self.stats['known_actors_processed'] += 1
                if not profile_data.get('is_placeholder'):
                    self.stats['profiles_scraped'] += 1
                return True
            else:
                print(f"   ⚠️  No rows updated for known actor {actor_id}")
                return False
                
        except Exception as e:
            print(f"   ❌ Error updating known actor profile: {e}")
            self.stats['errors'] += 1
            return False
    
    def create_nonexistent_account_placeholder(self, username: str, reason: str = "not_found"):
        """Create placeholder JSON data for non-existent accounts"""
        status_mapping = {
            "not_found": "non_existent",
            "private": "private", 
            "suspended": "suspended"
        }
        
        placeholder_data = {
            "account_status": status_mapping.get(reason, "non_existent"),
            "username": username,
            "checked_at": datetime.now().isoformat(),
            "reason": reason,
            "is_placeholder": True,
            "message": f"Twitter account @{username} was confirmed as {status_mapping.get(reason, 'non-existent')} on {datetime.now().strftime('%Y-%m-%d')}"
        }
        
        return placeholder_data

    def extract_profile_fields(self, profile_data: dict):
        """Extract and clean profile fields from JSON data"""
        displayname = profile_data.get('displayname', '').strip()
        bio = profile_data.get('rawDescription', '').strip()
        location = profile_data.get('location', '').strip()
        
        # Clean displayname
        if not displayname or displayname.lower() in ['', 'null', 'none']:
            displayname = None
        
        # Clean and truncate bio
        if bio and bio.lower() not in ['', 'null', 'none']:
            # Remove excessive emoji and clean up
            bio = re.sub(r'[✩⭐️🇺🇸🦅🔥💪🙏❤️⚡️🌟🎉👑💎🚨⚔️🛡️]', '', bio)
            bio = re.sub(r'\s+', ' ', bio).strip()
            if len(bio) > 500:
                bio = bio[:500] + '...'
        else:
            bio = None
        
        # Clean location
        if not location or location.lower() in ['', 'null', 'none']:
            location = None
        
        return displayname, bio, location

    def update_unknown_actor_profile(self, actor_id: str, profile_data: dict, is_placeholder: bool = False):
        """Update the unknown actor's profile data in the database"""
        try:
            # Prepare update data
            update_data = {
                'x_profile_data': profile_data
            }

            # If it's real profile data, extract and populate the profile fields
            if not is_placeholder and profile_data:
                displayname, bio, location = self.extract_profile_fields(profile_data)
                
                update_data.update({
                    'profile_displayname': displayname,
                    'profile_bio': bio,
                    'profile_location': location
                })
                
                self.stats['profile_data_populated'] += 1
            
            # Debug: ensure we're not sending columns the table lacks
            # Remove keys with None values to avoid unnecessary updates
            update_data = {k: v for k, v in update_data.items() if v is not None}

            result = self.supabase.table('v2_unknown_actors')\
                .update(update_data)\
                .eq('id', actor_id)\
                .execute()
            
            if result.data:
                self.stats['profiles_updated'] += 1
                
                # Track different types of updates
                if is_placeholder:
                    account_status = profile_data.get('account_status', 'unknown')
                    if account_status == 'non_existent':
                        self.stats['accounts_nonexistent'] += 1
                    elif account_status == 'private':
                        self.stats['accounts_private'] += 1
                    elif account_status == 'suspended':
                        self.stats['accounts_suspended'] += 1
                else:
                    self.stats['profiles_scraped'] += 1
                
                return True
            else:
                print(f"   ⚠️  No rows updated for unknown actor {actor_id}")
                return False
                
        except Exception as e:
            print(f"   ❌ Error updating unknown actor profile: {e}")
            self.stats['errors'] += 1
            return False

def _parse_netscape_cookie_file_to_df(file_path: str) -> pd.DataFrame:
    """Parse cookies.txt-like files (Netscape or JSON) into a DataFrame."""
    keys_of_interest = {"personalization_id", "gt", "kdt", "auth_token", "ct0", "twid"}
    domains = ("x.com", ".x.com", "twitter.com", ".twitter.com")
    accounts: dict[str, dict[str, str]] = {}
    current_key: str | None = None
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        raw = f.read()

    # Try JSON first
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and 'cookies' in data:
            data = data['cookies']
        if isinstance(data, list):
            bucket = {}
            for c in data:
                name = c.get('name')
                value = c.get('value')
                dom = c.get('domain', '')
                if name in keys_of_interest and (not dom or any(d in dom for d in domains)):
                    bucket[name] = value
            if bucket:
                accounts['json'] = bucket
        elif isinstance(data, dict):
            bucket = {k: v for k, v in data.items() if k in keys_of_interest}
            if bucket:
                accounts['json'] = bucket
    except Exception:
        # Fallback to Netscape 7-field format
        for line in raw.splitlines():
            if not line.strip() or line.startswith('#'):
                continue
            parts = line.strip().split('\t')
            if len(parts) != 7:
                continue
            domain, _, _, _, _, name, value = parts
            if not any(d in domain for d in domains):
                continue
            if name not in keys_of_interest:
                continue

            identifier = None
            if name == 'auth_token':
                identifier = value
            elif name == 'twid':
                identifier = value
            elif name == 'ct0':
                identifier = value
            elif current_key:
                identifier = current_key

            if identifier is None:
                current_key = None
                continue

            current_key = identifier
            account = accounts.setdefault(identifier, {})
            account[name] = value

    rows = []
    for idx, (identifier, jar) in enumerate(accounts.items()):
        if 'auth_token' not in jar or 'ct0' not in jar:
            continue
        order = ["personalization_id", "gt", "kdt", "auth_token", "ct0", "twid"]
        header_parts = [f"{k}={jar[k]}" for k in order if k in jar]
        if not header_parts:
            header_parts = [f"{k}={v}" for k, v in jar.items()]
        header = '; '.join(header_parts)
        suffix_source = identifier or f"idx{idx}"
        suffix = hashlib.sha1(suffix_source.encode()).hexdigest()[:8]
        rows.append({
            "username": f"cookie_{suffix}",
            "password": "",
            "email": "",
            "email_password": "",
            "cookie_string": header,
            "cookie_header": header,
        })

    if not rows:
        raise RuntimeError("No X/Twitter cookies found in provided file")

    return pd.DataFrame(rows)


def _normalize_cookie_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    records = []
    seen_usernames: set[str] = set()

    for idx, row in df.iterrows():
        cookie_value = row.get('cookie_string') or row.get('cookie_header')
        if not isinstance(cookie_value, str) or not cookie_value.strip():
            continue
        if 'auth_token' not in cookie_value or 'ct0' not in cookie_value:
            continue

        username = str(row.get('username') or '').strip()
        if not username:
            suffix = hashlib.sha1((cookie_value + str(idx)).encode()).hexdigest()[:10]
            username = f"cookie_{suffix}"
        elif username in seen_usernames:
            suffix = hashlib.sha1((username + cookie_value + str(idx)).encode()).hexdigest()[:6]
            username = f"{username}_{suffix}"

        seen_usernames.add(username)

        records.append({
            'username': username,
            'password': row.get('password', '') or '',
            'email': row.get('email', '') or '',
            'email_password': row.get('email_password', '') or '',
            'cookie_string': cookie_value,
            'cookie_header': row.get('cookie_header', '') or cookie_value
        })

    return pd.DataFrame(records)

async def setup_api():
    """Initialize the twscrape API with accounts from the cookie file"""
    print("🔧 Setting up Twitter API accounts...")
    api = API()

    try:
        # Look for cookies in multiple locations
        cookie_paths = [
            os.path.join('data', 'cookies_master.csv'),
            'cookies_master.csv',
            os.getenv('COOKIE_CSV') or COOKIE_CSV,
            os.path.join('data', 'cookies.txt'),
            'cookies.txt',
            os.getenv('COOKIE_TXT'),
            os.getenv('TW_COOKIES_FILE')
        ]

        cookie_paths = [p for p in cookie_paths if p]

        df = None
        for path in cookie_paths:
            if os.path.exists(path):
                try:
                    if path.lower().endswith('.txt'):
                        print(f"   📄 Found Netscape cookies file: {path}")
                        df = _parse_netscape_cookie_file_to_df(path)
                    else:
                        df = pd.read_csv(path)
                        print(f"   📄 Found CSV cookies file: {path}")
                except Exception as e:
                    print(f"   ⚠️  Failed parsing {path} as CSV: {e}")
                    # Fallback: try Netscape/JSON parse even if extension is .csv
                    try:
                        df = _parse_netscape_cookie_file_to_df(path)
                        print(f"   📄 Parsed {path} as Netscape/JSON cookie file")
                    except Exception as alt_err:
                        print(f"   ⚠️  Also failed Netscape/JSON parse for {path}: {alt_err}")
                        df = None
                        continue
                break

        if df is None:
            print(f"❌ Cookie file not found. Tried paths: {cookie_paths}")
            return None

    except Exception as e:
        print(f"❌ Error reading cookie file: {e}")
        return None

    df = _normalize_cookie_dataframe(df)
    if df.empty:
        print("❌ No valid cookies (auth_token + ct0) found after parsing.")
        return None

    sample_df = df.sample(n=min(NUM_ACCOUNTS, len(df)))

    for _, row in sample_df.iterrows():
        await api.pool.add_account(
            username=row.get("username", "unknown"), 
            password=row.get("password", ""),
            email=row.get("email", ""), 
            email_password=row.get("email_password", "placeholder"),
            cookies=row.get("cookie_header") or row.get("cookie_string", "")
        )
    
    print("🔑 Logging in API accounts...")
    await api.pool.login_all()
    print("✅ API setup complete.")
    return api

def make_dict_json_safe(profile_dict):
    """Convert non-serializable items in the dict to strings"""
    safe_dict = {}
    for key, value in profile_dict.items():
        if isinstance(value, datetime):
            safe_dict[key] = value.isoformat()
        elif isinstance(value, list) and value and hasattr(value[0], '__dict__'):
            safe_dict[key] = [item.__dict__ for item in value]
        else:
            safe_dict[key] = value
            
    # Remove internal type key
    safe_dict.pop('_type', None)
    return safe_dict

async def scrape_known_actor_profile(api: API, actor_data: dict, profile_manager: UnknownActorProfileManager):
    """Scrape and save a known actor's Twitter profile"""
    username = actor_data['username']
    actor_id = actor_data['id']
    handle_id = actor_data.get('handle_id')
    has_about = actor_data.get('has_about', True)
    
    try:
        # Get the profile from Twitter
        user_profile = await api.user_by_login(username)
        
        if user_profile:
            # Convert to dict for JSON storage
            profile_dict = user_profile.dict() if hasattr(user_profile, 'dict') else user_profile.__dict__
            
            # Make it JSON safe
            safe_profile_dict = make_dict_json_safe(profile_dict)
            
            # Update the known actor's profile
            success = profile_manager.update_known_actor_profile(
                actor_id=actor_id,
                handle_id=handle_id,
                profile_data=safe_profile_dict,
                has_about=has_about
            )
            
            if success:
                followers = safe_profile_dict.get('followersCount', 0)
                verification = '✅' if safe_profile_dict.get('verified', False) else ''
                print(f"✅ Success ({followers:,} followers) {verification}")
                
                # Save backup if enabled
                if OUTPUT_DIR:
                    try:
                        profile_path = os.path.join(OUTPUT_DIR, f"known_actor_{actor_id}_{username}.json")
                        os.makedirs(OUTPUT_DIR, exist_ok=True)
                        with open(profile_path, "w", encoding='utf-8') as f:
                            json.dump(safe_profile_dict, f, indent=2, ensure_ascii=False, default=str)
                    except:
                        pass
            else:
                print(f"❌ Database update failed")
            
            return safe_profile_dict, None
            
        else:
            # Account doesn't exist
            print(f"❌ Account not found")
            
            # Create placeholder for non-existent account
            placeholder = profile_manager.create_nonexistent_account_placeholder(username, "not_found")
            profile_manager.update_known_actor_profile(
                actor_id=actor_id,
                handle_id=handle_id,
                profile_data=placeholder,
                has_about=has_about
            )
            
            return None, {"username": username, "actor_id": actor_id, "reason": "not_found"}
            
    except Exception as e:
        error_msg = str(e)
        
        # Handle different error types
        if "private" in error_msg.lower():
            print(f"🔒 Account is private")
            placeholder = profile_manager.create_nonexistent_account_placeholder(username, "private")
            profile_manager.update_known_actor_profile(
                actor_id=actor_id,
                handle_id=handle_id,
                profile_data=placeholder,
                has_about=has_about
            )
            return None, {"username": username, "actor_id": actor_id, "reason": "private"}
            
        elif "suspended" in error_msg.lower():
            print(f"⚠️ Account suspended")
            placeholder = profile_manager.create_nonexistent_account_placeholder(username, "suspended")
            profile_manager.update_known_actor_profile(
                actor_id=actor_id,
                handle_id=handle_id,
                profile_data=placeholder,
                has_about=has_about
            )
            return None, {"username": username, "actor_id": actor_id, "reason": "suspended"}
            
        else:
            print(f"❌ Error: {e}")
            profile_manager.stats['errors'] += 1
            return None, {"username": username, "actor_id": actor_id, "reason": str(e)}

async def scrape_unknown_actor_profile(api: API, actor_data: dict, profile_manager: UnknownActorProfileManager):
    """Scrape profile for a single unknown actor and update database"""
    username = actor_data['username']
    actor_id = actor_data['id']
    mention_count = actor_data['mention_count']
    author_count = actor_data['author_count']
    
    print(f"🔍 Scraping @{username} (mentions: {mention_count}, posts: {author_count})")
    
    try:
        user: User | None = await api.user_by_login(username)
        
        if user is None:
            # Account doesn't exist or is private - create placeholder
            print(f"   ❌ @{username} not found or private")
            placeholder_data = profile_manager.create_nonexistent_account_placeholder(username, "not_found")
            
            success = profile_manager.update_unknown_actor_profile(actor_id, placeholder_data, is_placeholder=True)
            
            if success:
                print(f"   📝 Marked @{username} as non-existent in database")
            
            return None, {"username": username, "actor_id": actor_id, "reason": "Account not found"}

        # Check if account is suspended or private from the profile data
        profile_data = user.__dict__
        
        # Handle suspended accounts
        if hasattr(user, 'suspended') and user.suspended:
            print(f"   ⚠️  @{username} is suspended")
            placeholder_data = profile_manager.create_nonexistent_account_placeholder(username, "suspended")
            success = profile_manager.update_unknown_actor_profile(actor_id, placeholder_data, is_placeholder=True)
            
            if success:
                print(f"   📝 Marked @{username} as suspended in database")
            
            return None, {"username": username, "actor_id": actor_id, "reason": "Account suspended"}
        
        # Handle private accounts (if we can detect them)
        if hasattr(user, 'protected') and user.protected:
            print(f"   🔒 @{username} is private")
            placeholder_data = profile_manager.create_nonexistent_account_placeholder(username, "private")
            success = profile_manager.update_unknown_actor_profile(actor_id, placeholder_data, is_placeholder=True)
            
            if success:
                print(f"   📝 Marked @{username} as private in database")
            
            return None, {"username": username, "actor_id": actor_id, "reason": "Account private"}
        
        # Account exists and is accessible - process normally
        safe_profile_data = make_dict_json_safe(profile_data)
        
        # Add metadata to indicate this is real profile data
        safe_profile_data['is_placeholder'] = False
        safe_profile_data['scraped_at'] = datetime.now().isoformat()
        
        # Update the unknown actor's profile in database
        success = profile_manager.update_unknown_actor_profile(actor_id, safe_profile_data, is_placeholder=False)
        
        if success:
            displayname = safe_profile_data.get('displayname', username)
            bio_preview = safe_profile_data.get('rawDescription', '')[:50] + '...' if safe_profile_data.get('rawDescription') else 'No bio'
            print(f"   ✅ Updated profile for @{username}")
            print(f"      📝 Name: {displayname}")
            print(f"      📄 Bio: {bio_preview}")
            
            # Optional: Save backup JSON file
            if OUTPUT_DIR:
                try:
                    backup_filename = os.path.join(OUTPUT_DIR, f"{username}_unknown_actor.json")
                    os.makedirs(OUTPUT_DIR, exist_ok=True)
                    with open(backup_filename, "w", encoding="utf-8") as f:
                        json.dump(safe_profile_data, f, ensure_ascii=False, indent=2)
                except:
                    pass  # Don't fail on backup errors
            
            return safe_profile_data, None
        else:
            return None, {"username": username, "actor_id": actor_id, "reason": "Database update failed"}
        
    except Exception as e:
        error_message = str(e).lower()
        
        # Try to detect specific error types
        if "not found" in error_message or "does not exist" in error_message:
            print(f"   ❌ @{username} confirmed non-existent")
            placeholder_data = profile_manager.create_nonexistent_account_placeholder(username, "not_found")
            success = profile_manager.update_unknown_actor_profile(actor_id, placeholder_data, is_placeholder=True)
            
            if success:
                print(f"   📝 Marked @{username} as non-existent in database")
            
            return None, {"username": username, "actor_id": actor_id, "reason": "Confirmed non-existent"}
        
        elif "suspended" in error_message:
            print(f"   ⚠️  @{username} is suspended")
            placeholder_data = profile_manager.create_nonexistent_account_placeholder(username, "suspended")
            success = profile_manager.update_unknown_actor_profile(actor_id, placeholder_data, is_placeholder=True)
            
            if success:
                print(f"   📝 Marked @{username} as suspended in database")
            
            return None, {"username": username, "actor_id": actor_id, "reason": "Account suspended"}
        
        else:
            # Generic error - don't mark as non-existent, might be temporary
            print(f"   ❌ Error scraping @{username}: {e}")
            profile_manager.stats['errors'] += 1
            return None, {"username": username, "actor_id": actor_id, "reason": str(e)}

async def main():
    """Main function - scrapes both unknown AND known actors"""
    print("🚀 Starting Twitter Profile Scraper (Unknown + Known Actors)\n")
    
    print("⚙️  Configuration:")
    print(f"   🧪 Test mode: {'ENABLED - Only 10 actors' if TEST_MODE else 'Disabled'}")
    print(f"   📁 Backup files: {'Enabled' if OUTPUT_DIR else 'Disabled'}")
    print(f"   🔄 Force re-scrape: {'Yes' if FORCE_RESCRAPE else 'No'}")
    print(f"   📅 Re-check non-existent after: {DAYS_BEFORE_RECHECK} days")
    
    if TEST_MODE:
        print("\n🧪 TEST MODE ACTIVE:")
        print(f"   - Will process maximum {TEST_PROFILES_LIMIT} actors")
        print("   - Perfect for testing before full run")
        print("   - Set TEST_MODE = False for production run")
    
    print()
    
    # Initialize profile manager
    try:
        profile_manager = UnknownActorProfileManager()
    except Exception as e:
        print(f"❌ {e}")
        return
    
    # Get KNOWN actors that need profiles
    known_actors = profile_manager.get_known_actors_needing_profiles()
    
    # Get all unknown Twitter actors from database
    unknown_actors = profile_manager.get_unknown_twitter_actors()
    
    # Combine both lists
    all_actors = []
    
    # Add known actors first (higher priority)
    for actor in known_actors:
        all_actors.append(actor)
    
    # Add unknown actors
    for actor in unknown_actors:
        all_actors.append(actor)
    
    if not all_actors:
        print("❌ No actors found that need Twitter profile scraping.")
        print("💡 This means all actors (both known and unknown) already have profile data.")
        return
    
    # Setup Twitter API
    api = await setup_api()
    if api is None:
        print("❌ API setup failed. Make sure you have cookies_master.csv")
        return
    
    # Apply test mode limit if needed
    if TEST_MODE and len(all_actors) > TEST_PROFILES_LIMIT:
        all_actors = all_actors[:TEST_PROFILES_LIMIT]
        print(f"🧪 Testing with {len(all_actors)} actors (limited from {len(known_actors) + len(unknown_actors)} total)...\n")
    else:
        print(f"\n🔄 Processing {len(all_actors)} actor profiles ({len(known_actors)} known, {len(unknown_actors)} unknown)...\n")

    # Use batch processing instead of pure concurrency to avoid SQLite database conflicts
    # SQLite (used by twscrape) can't handle many concurrent writes
    batch_size = min(3, len(all_actors))  # Safe limit for SQLite concurrent access
    if batch_size > 1:
        print(f"⚡️ Processing {batch_size} profiles per batch to avoid database conflicts.\n")

    no_data_log = []
    total_actors = len(all_actors)

    async def process_actor(actor_data, index):
        """Scrape a single actor."""
        error_log = None
        actor_username = actor_data.get('username', 'unknown')
        actor_type = "Known" if actor_data.get('is_known_actor', False) else "Unknown"

        try:
            if actor_data.get('is_known_actor', False):
                actor_name = actor_data.get('actor_name', '')
                print(f"[{index}/{total_actors}] {actor_type} - {actor_name} (@{actor_username}): ", end="")
            else:
                print(f"[{index}/{total_actors}] {actor_type} - @{actor_username}: ", end="")

            is_known = actor_data.get('is_known_actor', False)
            if is_known:
                _, error_log = await scrape_known_actor_profile(api, actor_data, profile_manager)
            else:
                _, error_log = await scrape_unknown_actor_profile(api, actor_data, profile_manager)

        except Exception as unexpected_error:
            print(f"   ❌ Unexpected error scraping @{actor_username}: {unexpected_error}")
            profile_manager.stats['errors'] += 1
            error_log = {
                "username": actor_username,
                "actor_id": actor_data.get('id'),
                "reason": str(unexpected_error)
            }

        return error_log

    # Process in batches to avoid SQLite concurrent write issues
    results = []
    for batch_start in range(0, len(all_actors), batch_size):
        batch_end = min(batch_start + batch_size, len(all_actors))
        batch = all_actors[batch_start:batch_end]

        # Create tasks for this batch
        tasks = []
        for i, actor_data in enumerate(batch):
            index = batch_start + i + 1
            tasks.append(process_actor(actor_data, index))

        # Process batch concurrently
        batch_results = await asyncio.gather(*tasks, return_exceptions=False)
        results.extend(batch_results)

        # Small delay between batches
        if batch_end < len(all_actors):
            await asyncio.sleep(0.5)

    for result in results:
        if result:
            no_data_log.append(result)
    
    # Save error log
    if no_data_log and OUTPUT_DIR:
        try:
            error_log_path = os.path.join(OUTPUT_DIR, f"unknown_actor_scrape_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")
            os.makedirs(OUTPUT_DIR, exist_ok=True)
            with open(error_log_path, "w", newline='', encoding='utf-8') as logf:
                fieldnames = ["username", "actor_id", "reason"]
                writer = csv.DictWriter(logf, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(no_data_log)
            print(f"\n📄 Saved error log with {len(no_data_log)} entries: {error_log_path}")
        except:
            pass  # Don't fail on logging errors
    
    # Print final statistics
    print("\n" + "="*50)
    print("📊 PROFILE SCRAPING SUMMARY")
    print("="*50)
    print(f"✅ Profiles scraped successfully: {profile_manager.stats['profiles_scraped']}")
    print(f"📝 Unknown actors updated: {profile_manager.stats['profiles_updated']}")
    print(f"🎯 Known actors updated: {profile_manager.stats['known_actors_processed']}")
    print(f"📄 'About' fields populated from bio: {profile_manager.stats['known_actors_about_populated']}")
    print(f"👤 Unknown actor profile data populated: {profile_manager.stats['profile_data_populated']}")
    print(f"\n📋 Account Status Breakdown:")
    print(f"   ❌ Non-existent accounts: {profile_manager.stats['accounts_nonexistent']}")
    print(f"   🔒 Private accounts: {profile_manager.stats['accounts_private']}")
    print(f"   ⚠️  Suspended accounts: {profile_manager.stats['accounts_suspended']}")
    print(f"   🚨 Other errors: {profile_manager.stats['errors']}")
    
    if OUTPUT_DIR:
        print(f"\n💾 Backup JSON files saved to: {OUTPUT_DIR}")
    
    print("\n🎉 Profile scraping complete!")
    if profile_manager.stats['profiles_scraped'] > 0:
        print("\n💡 Next steps:")
        print("   1. Review updated actors in web interface")
        if profile_manager.stats['profiles_updated'] > 0:
            print("   2. Promote valuable unknown actors using the promotion system")
        if profile_manager.stats['known_actors_about_populated'] > 0:
            print(f"   3. Review {profile_manager.stats['known_actors_about_populated']} known actors with newly populated 'about' fields")

# Function that can be called by post processor
async def scrape_new_unknown_actors():
    """Called by post processor to scrape newly discovered actors"""
    await main()

if __name__ == "__main__":
    asyncio.run(main())
