"""
Instagram Profile Scraper using Scrapfly
Scrapes Instagram profile data for selected actors using the scrape_user() function
"""
import asyncio
import os
import re
import json
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
from utils.database import get_supabase
import jmespath
from loguru import logger as log
from scrapfly import ScrapeConfig, ScrapflyClient

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
        print(f"✅ Scrapfly API initialized for Instagram profile scraping")
except KeyError:
    print("❌ SCRAPFLY_KEY environment variable is not set.")
    SCRAPFLY = None

# Base configuration
BASE_CONFIG = {"asp": True, "country": "US", "cache": False}
INSTAGRAM_APP_ID = "936619743392459"

# JMESPath query for parsing profile data - based on scrapfly examples
PROFILE_JMESPATH = """
{
    name: full_name,
    username: username,
    id: id,
    category: category_name,
    business_category: business_category_name,
    phone: business_phone_number,
    email: business_email,
    bio: biography,
    bio_links: bio_links[].url,
    homepage: external_url,
    followers: edge_followed_by.count,
    follows: edge_follow.count,
    facebook_id: fbid,
    is_private: is_private,
    is_verified: is_verified,
    profile_image: profile_pic_url_hd,
    video_count: edge_felix_video_timeline.count,
    image_count: edge_owner_to_timeline_media.count,
    saved_count: edge_saved_media.count,
    collections_count: edge_saved_media.count,
    related_profiles: edge_related_profiles.edges[].node.username,
    scraped_at: scraped_at,
    scraping_method: scraping_method
}
"""

async def scrape_instagram_user(username: str) -> Optional[Dict]:
    """
    Scrape Instagram user profile data using Scrapfly
    Based on the scrape_user() function from scrapfly documentation
    """
    if not SCRAPFLY:
        raise Exception("Scrapfly client not initialized")
    
    log.info(f"🔍 Scraping Instagram profile for @{username}")
    
    try:
        result = await SCRAPFLY.async_scrape(
            ScrapeConfig(
                f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
                headers={
                    "x-ig-app-id": INSTAGRAM_APP_ID,
                },
                **BASE_CONFIG,
            )
        )
        
        data = json.loads(result.content)
        
        if not data.get("data") or not data["data"].get("user"):
            log.warning(f"❌ Profile @{username} not found or is private")
            return {"error": "profile_not_found", "username": username}
        
        # Add metadata
        data["scraped_at"] = datetime.now().isoformat()
        data["scraping_method"] = "scrapfly_instagram_api"
        
        # Parse using JMESPath
        parsed_profile = jmespath.search(PROFILE_JMESPATH, data["data"]["user"])
        
        if parsed_profile:
            log.info(f"✅ Successfully scraped profile @{username}")
            log.info(f"   - Full Name: {parsed_profile.get('name', 'N/A')}")
            log.info(f"   - Followers: {parsed_profile.get('followers', 0):,}")
            log.info(f"   - Following: {parsed_profile.get('follows', 0):,}")
            log.info(f"   - Posts: {parsed_profile.get('image_count', 0):,}")
            log.info(f"   - Verified: {'✅' if parsed_profile.get('is_verified') else '❌'}")
            log.info(f"   - Private: {'🔒' if parsed_profile.get('is_private') else '🔓'}")
            
            return parsed_profile
        else:
            log.warning(f"⚠️ Could not parse profile data for @{username}")
            return {"error": "parsing_failed", "username": username}
            
    except Exception as e:
        error_message = str(e)
        if "404" in error_message or "Page not found" in error_message:
            log.warning(f"Instagram account @{username} not found (404)")
            return {"error": "account_not_found", "username": username}
        elif "403" in error_message or "private" in error_message.lower():
            log.warning(f"Instagram account @{username} is private or restricted")
            return {"error": "account_private", "username": username}
        else:
            log.error(f"Error scraping @{username}: {e}")
            return {"error": "scraping_failed", "username": username, "message": str(e)}

class InstagramProfileScraper:
    def __init__(self):
        self.supabase = get_supabase()
        self.stats = {
            'total_handles': 0,
            'successful_scrapes': 0,
            'failed_scrapes': 0,
            'skipped_private': 0,
            'accounts_not_found': 0,
            'already_scraped': 0,
            'skipped_errors': 0
        }

    def clean_instagram_handle(self, raw_handle: str) -> Optional[str]:
        """Cleans and validates an Instagram handle from various formats."""
        if not isinstance(raw_handle, str):
            return None
        val = raw_handle.strip()
        if not val:
            return None
        if "instagram.com/" in val:
            val = val.split("instagram.com/")[-1].split("/")[0]
        val = val.lstrip('@')
        val = re.sub(r'[^A-Za-z0-9_.]', '', val)
        return val if val else None

    def get_instagram_handles_needing_profiles(self, force_rescrape: bool = False) -> List[Dict]:
        """Gets Instagram handles that need profile data scraped - includes both unknown and known actors"""
        print("📋 Loading Instagram handles that need profile scraping...")
        
        try:
            # First, get Instagram handles from v2_actor_usernames for KNOWN actors with JOIN
            print("🔍 Checking known actors (v2_actors) for missing Instagram profiles...")
            
            # Use JOIN to get all actor data in a single query
            known_handles_query = self.supabase.table('v2_actor_usernames')\
                .select('id, username, actor_id, platform, v2_actors!inner(id, name, instagram_profile_data, about)')\
                .eq('platform', 'instagram')\
                .not_.is_('username', 'null')
            
            # If not force rescraping, only get handles without recent profile data
            if not force_rescrape:
                thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat()
                known_handles_query = known_handles_query.or_(f'last_profile_update.is.null,last_profile_update.lt.{thirty_days_ago}')
            
            print("  📊 Fetching all actor data in single query...")
            known_handles_result = known_handles_query.execute()
            
            # Process results to find who needs profiles
            known_actors_needing_profiles = []
            actors_needing_full_scrape = 0
            
            for handle_record in known_handles_result.data:
                # Actor data is already included in the response
                actor = handle_record.get('v2_actors')
                if not actor:
                    continue
                
                needs_scrape = False
                reason = ""
                
                # LOGIC: Only scrape if NO profile data exists
                # Skip anyone who already has profile data (unless force rescrape)
                if not actor.get('instagram_profile_data'):
                    needs_scrape = True
                    reason = "missing Instagram profile data"
                    actors_needing_full_scrape += 1
                elif force_rescrape:
                    needs_scrape = True
                    reason = "force re-scraping"
                # SKIP if they already have profile data - we don't care about missing 'about'
                
                if needs_scrape:
                    known_actors_needing_profiles.append({
                        'handle_id': handle_record['id'],
                        'actor_id': handle_record['actor_id'],
                        'actor_type': 'v2_actor',
                        'handle': handle_record['username'],
                        'actor_name': actor['name'],
                        'has_about': bool(actor.get('about'))
                    })
                    
                    # Only print first 10 to avoid spam
                    if len(known_actors_needing_profiles) <= 10:
                        print(f"  ✅ {actor['name']} (@{handle_record['username']}) - {reason}")
                    elif len(known_actors_needing_profiles) == 11:
                        print(f"  ... and more actors needing profiles")
            
            print(f"📊 Found {len(known_actors_needing_profiles)} known actors needing Instagram profile scraping")
            if actors_needing_full_scrape > 0:
                print(f"   - {actors_needing_full_scrape} missing profile data entirely")
            if force_rescrape:
                print(f"   - Force re-scraping all profiles")
            
            # Then get Instagram handles marked for scraping (original logic for unknown actors)
            print("🔍 Checking unknown actors for Instagram profile scraping...")
            handles_query = self.supabase.table('actor_usernames')\
                .select('id, username, actor_id, actor_type, last_profile_update')\
                .eq('platform', 'instagram')\
                .eq('should_scrape', True)
            
            # If not force rescraping, only get handles without recent profile data
            if not force_rescrape:
                thirty_days_ago = (datetime.now() - timedelta(days=30)).isoformat()
                handles_query = handles_query.or_(f'last_profile_update.is.null,last_profile_update.lt.{thirty_days_ago}')
            
            handles_result = handles_query.execute()
            
            print(f"📊 Found {len(handles_result.data)} Instagram handles marked for scraping")
            
            instagram_handles = []
            skipped_errors = 0
            
            for record in handles_result.data:
                handle = self.clean_instagram_handle(record['username'])
                if not handle:
                    continue
                    
                # Check if actor has error data in their profile BEFORE adding to list
                table_name = f"{record['actor_type']}s"  # people, organizations, chapters
                
                try:
                    actor_result = self.supabase.table(table_name)\
                        .select('instagram_profile_data')\
                        .eq('id', record['actor_id'])\
                        .execute()
                    
                    if actor_result.data and actor_result.data[0].get('instagram_profile_data'):
                        profile_data = actor_result.data[0]['instagram_profile_data']
                        
                        # Check if profile data contains "error" - simple string check
                        if isinstance(profile_data, dict) and 'error' in profile_data:
                            if not force_rescrape:  # Only skip if not forcing
                                error_type = profile_data.get('error', 'unknown')
                                print(f"⏭️ Skipping @{handle} - has error: {error_type}")
                                skipped_errors += 1
                                continue
                            else:
                                error_type = profile_data.get('error', 'unknown')
                                print(f"🔄 Force processing @{handle} despite error: {error_type}")
                                
                except Exception as e:
                    print(f"⚠️ Error checking profile data for @{handle}: {e}")
                    # Continue processing if we can't check - don't skip on error
                
                print(f"✅ Will process @{handle}")
                instagram_handles.append({
                    "handle_id": record['id'],
                    "actor_id": record['actor_id'],
                    "actor_type": record['actor_type'],
                    "handle": handle,
                    "last_profile_update": record.get('last_profile_update')
                })
            
            # Combine both known and unknown actor handles
            all_handles = known_actors_needing_profiles + instagram_handles
            
            print(f"\n📊 Overall Results:")
            print(f"✅ Known actors to process: {len(known_actors_needing_profiles)}")
            print(f"✅ Unknown actors to process: {len(instagram_handles)}")
            print(f"✅ Total handles to process: {len(all_handles)}")
            if skipped_errors > 0:
                print(f"⏭️ Skipped due to errors: {skipped_errors}")
                if not force_rescrape:
                    print(f"💡 Use 'Update Profiles' button to force re-scrape accounts with errors")
                
            # Update stats
            self.stats['skipped_errors'] = skipped_errors
            
            if len(all_handles) == 0:
                if force_rescrape:
                    print("💡 No Instagram handles found that need scraping")
                else:
                    print("💡 All Instagram handles already have recent profile data or errors")
                print("   Both known and unknown actors have been checked")
                if skipped_errors > 0:
                    print(f"   Use 'Update Profiles' to retry {skipped_errors} handles with errors")
            
            return all_handles
            
        except Exception as e:
            print(f"❌ Error loading Instagram handles: {e}")
            import traceback
            traceback.print_exc()
            return []

    def update_actor_profile_data(self, actor_id: str, actor_type: str, profile_data: Dict, handle_id: str, has_about: bool = True) -> bool:
        """Updates the Instagram profile data in the actor table and handle record"""
        try:
            if actor_type == 'v2_actor':
                # For v2_actors, update the main v2_actors table
                update_data = {
                    'instagram_profile_data': profile_data,
                    'last_profile_update': datetime.now().isoformat()
                }
                
                # If about is empty and we have a bio, populate it
                if not has_about and profile_data.get('bio'):
                    update_data['about'] = profile_data['bio']
                    print(f"  📝 Populated empty 'about' field with Instagram bio")
                
                self.supabase.table('v2_actors')\
                    .update(update_data)\
                    .eq('id', actor_id)\
                    .execute()
                
                # Update the v2_actor_usernames table
                self.supabase.table('v2_actor_usernames')\
                    .update({'last_profile_update': datetime.now().isoformat()})\
                    .eq('id', handle_id)\
                    .execute()
            else:
                # Original logic for unknown actors (people, organizations, chapters)
                table_name = f"{actor_type}s"
                
                # Update the main actor table with profile data
                self.supabase.table(table_name)\
                    .update({
                        'instagram_profile_data': profile_data,
                        'last_profile_update': datetime.now().isoformat()
                    })\
                    .eq('id', actor_id)\
                    .execute()
                
                # Update the actor_usernames table with last_profile_update
                self.supabase.table('actor_usernames')\
                    .update({'last_profile_update': datetime.now().isoformat()})\
                    .eq('id', handle_id)\
                    .execute()
            
            log.info(f"✅ Updated profile data for {actor_type} {actor_id}")
            return True
                
        except Exception as e:
            log.error(f"❌ Error updating profile data for {actor_id}: {e}")
            return False

    async def run_profile_scraping(self, force_rescrape: bool = False) -> bool:
        """Main function to run Instagram profile scraping"""
        print("🚀 Starting Instagram Profile Scraper\n")
        
        # Check if Scrapfly is configured
        if not SCRAPFLY:
            print("❌ Scrapfly API not configured. Cannot scrape Instagram profiles.")
            return False
        
        # Get handles that need profile data
        instagram_handles = self.get_instagram_handles_needing_profiles(force_rescrape)
        if not instagram_handles:
            print("✅ No Instagram handles need profile scraping.")
            return True
        
        self.stats['total_handles'] = len(instagram_handles)
        
        print(f"\n🔄 Scraping profiles for {len(instagram_handles)} Instagram handles...\n")
        
        for i, handle_data in enumerate(instagram_handles, 1):
            handle = handle_data['handle']
            handle_id = handle_data['handle_id']
            actor_id = handle_data['actor_id']
            actor_type = handle_data['actor_type']
            has_about = handle_data.get('has_about', True)  # Default to True for unknown actors
            actor_name = handle_data.get('actor_name', '')  # Name for known actors
            
            if actor_name:
                print(f"[{i}/{len(instagram_handles)}] Scraping @{handle} ({actor_name})... ", end="")
            else:
                print(f"[{i}/{len(instagram_handles)}] Scraping @{handle}... ", end="")
            
            try:
                profile_data = await scrape_instagram_user(handle)
                
                if profile_data:
                    if 'error' in profile_data:
                        error_type = profile_data['error']
                        if error_type == 'account_not_found':
                            print("❌ Account not found")
                            self.stats['accounts_not_found'] += 1
                            # Still update database to mark as attempted
                            profile_data['attempted_at'] = datetime.now().isoformat()
                            self.update_actor_profile_data(actor_id, actor_type, profile_data, handle_id, has_about)
                        elif error_type == 'account_private':
                            print("🔒 Account is private")
                            self.stats['skipped_private'] += 1
                            # Still update database to mark as attempted
                            profile_data['attempted_at'] = datetime.now().isoformat()
                            self.update_actor_profile_data(actor_id, actor_type, profile_data, handle_id, has_about)
                        else:
                            print(f"❌ Error: {profile_data.get('message', 'Unknown error')}")
                            self.stats['failed_scrapes'] += 1
                    else:
                        # Successful scrape
                        success = self.update_actor_profile_data(actor_id, actor_type, profile_data, handle_id, has_about)
                        if success:
                            follower_count = profile_data.get('followers', 0)
                            verification = '✅' if profile_data.get('is_verified') else ''
                            print(f"✅ Success ({follower_count:,} followers) {verification}")
                            self.stats['successful_scrapes'] += 1
                        else:
                            print("❌ Database update failed")
                            self.stats['failed_scrapes'] += 1
                else:
                    print("❌ No profile data returned")
                    self.stats['failed_scrapes'] += 1
                
            except Exception as e:
                print(f"❌ Error: {e}")
                self.stats['failed_scrapes'] += 1
            
            # Rate limiting delay
            await asyncio.sleep(3)
        
        # Print final statistics
        print("\n" + "="*60)
        print("📊 INSTAGRAM PROFILE SCRAPING SUMMARY")
        print("="*60)
        print(f"📱 Total handles processed: {self.stats['total_handles']}")
        print(f"✅ Successful scrapes: {self.stats['successful_scrapes']}")
        print(f"❌ Failed scrapes: {self.stats['failed_scrapes']}")
        print(f"🔒 Private accounts: {self.stats['skipped_private']}")
        print(f"❓ Accounts not found: {self.stats['accounts_not_found']}")
        print(f"⏭️ Already had recent data: {self.stats['already_scraped']}")
        print(f"⏭️ Skipped previous errors: {self.stats['skipped_errors']}")
        
        success_rate = (self.stats['successful_scrapes'] / self.stats['total_handles'] * 100) if self.stats['total_handles'] > 0 else 0
        print(f"📈 Success rate: {success_rate:.1f}%")
        
        if self.stats['skipped_errors'] > 0:
            print(f"\n💡 To retry profiles with previous errors, use 'Update Profiles' button")
        
        print("\n🎉 Instagram profile scraping complete!")
        print("💡 Profile data saved to actor tables (people, organizations, chapters)")
        print("💡 Accounts with errors are permanently skipped to save API calls")
        print("💡 Use 'Update Profiles' button to force re-scrape accounts with errors")
        
        return True

async def main():
    """Main async function with command line argument support"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Instagram Profile Scraper for TPUSA Social Monitoring')
    parser.add_argument('--force', action='store_true', 
                       help='Force rescrape all profiles, including those with errors (same as Update Profiles button)')
    parser.add_argument('--limit', type=int, 
                       help='Limit number of profiles to scrape (for testing)')
    
    args = parser.parse_args()
    
    scraper = InstagramProfileScraper()
    await scraper.run_profile_scraping(force_rescrape=args.force)

if __name__ == "__main__":
    asyncio.run(main())
