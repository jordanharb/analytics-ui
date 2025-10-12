#!/usr/bin/env python3
"""
Enhanced event deduplication using pre-computed duplicate groups from SQL view
This is much more efficient than searching for duplicates one by one
"""

import os
import sys
import json
import time
from datetime import datetime
from typing import List, Dict, Tuple, Optional
import google.generativeai as genai
import argparse
from pathlib import Path

# Add repo root to path for imports
CURRENT_FILE = Path(__file__).resolve()
SCRIPTS_DIR = CURRENT_FILE.parent
AUTOMATION_DIR = SCRIPTS_DIR.parent
ANALYTICS_UI_DIR = AUTOMATION_DIR.parent
WEB_DIR = ANALYTICS_UI_DIR.parent
REPO_ROOT = WEB_DIR.parent

for candidate in (REPO_ROOT, WEB_DIR, ANALYTICS_UI_DIR):
    candidate_str = str(candidate)
    if candidate_str not in sys.path:
        sys.path.insert(0, candidate_str)

from utils.database import get_supabase
from config.settings import GOOGLE_API_KEY

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)

# Initialize model - using 2.5 flash for cost efficiency
model = genai.GenerativeModel('gemini-2.5-flash')

class GroupBasedDeduplicator:
    """Process pre-computed duplicate groups with Gemini"""
    
    def __init__(self, dry_run=True, verbose=False):
        self.supabase = get_supabase()
        self.dry_run = dry_run
        self.verbose = verbose
        self.processed_groups = set()
        self.merge_count = 0
        self.skip_count = 0
        
    def refresh_duplicate_groups(self):
        """Refresh the materialized view with latest data"""
        print("🔄 Refreshing duplicate groups view...")
        try:
            result = self.supabase.rpc('refresh_duplicate_groups').execute()
            print("✅ Duplicate groups refreshed")
            return True
        except Exception as e:
            print(f"⚠️ Could not refresh view: {e}")
            return False
    
    def get_duplicate_groups(self, min_score=0.5, confidence_level=None, limit=None):
        """Fetch duplicate groups from the view"""
        print("📊 Fetching duplicate groups from database...")
        
        query = self.supabase.table('v2_potential_duplicate_groups').select('*')
        
        # Filter by minimum score
        if min_score:
            query = query.gte('max_similarity_score', min_score)
        
        # Filter by confidence if specified
        if confidence_level:
            query = query.eq('confidence_level', confidence_level)
        
        # Order by group size first (larger groups more important), then by score
        query = query.order('group_size', desc=True).order('max_similarity_score', desc=True)
        
        if limit:
            query = query.limit(limit)
        
        result = query.execute()
        groups = result.data or []
        
        print(f"✅ Found {len(groups)} duplicate groups")
        return groups
    
    def get_group_details(self, group_id):
        """Get all event pairs in a duplicate group"""
        result = self.supabase.table('v2_duplicate_group_pairs').select('*').eq('group_id', group_id).execute()
        return result.data or []
    
    def get_event_details(self, event_ids: List[str]):
        """Fetch full details for multiple events"""
        result = self.supabase.table('v2_events').select(
            'id, event_name, event_date, city, state, event_description, created_at, category_tags'
        ).in_('id', event_ids).execute()
        
        # Create a dict for easy lookup
        events_dict = {event['id']: event for event in (result.data or [])}
        return events_dict
    
    def analyze_duplicate_group(self, group: Dict) -> List[Tuple[str, str, str]]:
        """Analyze a group of potential duplicates with Gemini"""
        
        # Get all event IDs in this group
        event_ids = group['event_ids']
        
        if len(event_ids) < 2:
            return []
        
        # Get full event details
        events = self.get_event_details(event_ids)
        
        if len(events) < 2:
            return []
        
        # Get group pair details for similarity scores
        group_details = self.get_group_details(group['group_id'])
        
        # Check if this is an electioneering group
        is_electioneering = group.get('has_electioneering', False)
        
        # Build prompt for Gemini
        prompt = f"""You are an expert at identifying duplicate events. Analyze this group of potentially duplicate events.

GROUP INFORMATION:
- Number of events in group: {group.get('group_size', len(events))}
- Maximum similarity score: {group.get('max_similarity_score', 0):.2%}
- Average similarity score: {group.get('avg_similarity_score', 0):.2%}
- Confidence level: {group.get('confidence_level', 'unknown')}
- Contains electioneering: {is_electioneering}

IMPORTANT: This group may contain multiple distinct events that happen to be similar. Your job is to:
1. Identify which events are TRUE duplicates (same event reported multiple times)
2. Keep distinct events separate (e.g., daily canvassing sessions)
3. When merging, choose the most specific/detailed event as master

EVENTS IN GROUP:
"""
        
        # Add each event's details
        for i, event_id in enumerate(event_ids, 1):
            if event_id in events:
                event = events[event_id]
                prompt += f"""
{i}. EVENT {event_id}:
   - Name: {event.get('event_name', 'Unknown')}
   - Date: {event.get('event_date', 'Unknown')}
   - Location: {event.get('city', 'Unknown')}, {event.get('state', 'Unknown')}
   - Description: {(event.get('event_description') or 'No description')[:500]}
   - Tags: {', '.join(event.get('category_tags', [])) if event.get('category_tags') else 'None'}
   - Created: {event.get('created_at', 'Unknown')}
"""
        
        # Add similarity details
        prompt += "\n\nPAIRWISE SIMILARITIES:\n"
        for detail in group_details[:10]:  # Limit to first 10 pairs
            prompt += f"""
- "{detail['event1_name']}" vs "{detail['event2_name']}":
  • Name similarity: {detail['name_similarity']:.1%}
  • Date proximity: {detail['date_proximity_score']:.1%}
  • Location match: {detail['location_score']:.1%}
  • Overall score: {detail['overall_similarity_score']:.1%}
"""
        
        # Add special instructions for electioneering
        if is_electioneering:
            prompt += """

⚠️ IMPORTANT - ELECTIONEERING EVENTS DETECTED:
These appear to be electioneering/canvassing events that happen FREQUENTLY.
- DO NOT merge unless they are on the EXACT SAME DATE and EXACT SAME LOCATION
- Different dates = different canvassing sessions, even if names are identical
- Be VERY conservative with electioneering merges
"""
        
        prompt += """

TASK: Determine which events should be merged together.

MASTER SELECTION RULES:
1. Choose the event with the MOST SPECIFIC and detailed name
2. Prefer events with complete descriptions and location details
3. Consider which has more tags/categorization
4. If all else equal, keep the earliest created event

Respond in JSON format:
{
  "merge_groups": [
    {
      "master_event_id": "uuid-of-master",
      "duplicate_event_ids": ["uuid-of-dup1", "uuid-of-dup2"],
      "confidence": "high/medium/low",
      "reasoning": "Explanation of why these are duplicates and why this master was chosen"
    }
  ],
  "keep_separate": [
    {
      "event_ids": ["uuid1", "uuid2"],
      "reasoning": "Why these should NOT be merged"
    }
  ]
}

Be conservative - only merge if you're confident they're the same event.
"""
        
        try:
            response = model.generate_content(prompt)
            response_text = response.text
            
            # Extract JSON from response
            if '```json' in response_text:
                json_str = response_text.split('```json')[1].split('```')[0].strip()
            elif '{' in response_text:
                start = response_text.index('{')
                end = response_text.rindex('}') + 1
                json_str = response_text[start:end]
            else:
                print(f"⚠️ Could not parse Gemini response")
                return []
            
            result_data = json.loads(json_str)
            
            # Process merge decisions
            merge_pairs = []
            
            for merge_group in result_data.get('merge_groups', []):
                master_id = merge_group.get('master_event_id')
                duplicate_ids = merge_group.get('duplicate_event_ids', [])
                reasoning = merge_group.get('reasoning', '')
                confidence = merge_group.get('confidence', 'unknown')
                
                if confidence in ['high', 'medium']:
                    for dup_id in duplicate_ids:
                        merge_pairs.append((master_id, dup_id, reasoning))
                        
                    if self.verbose:
                        master_name = events.get(master_id, {}).get('event_name', 'Unknown')
                        print(f"  🔄 Will merge {len(duplicate_ids)} events into: {master_name}")
                        print(f"     Confidence: {confidence}")
                        print(f"     Reason: {reasoning}")
            
            # Show keep-separate decisions if verbose
            if self.verbose:
                for keep_sep in result_data.get('keep_separate', []):
                    event_ids = keep_sep.get('event_ids', [])
                    reasoning = keep_sep.get('reasoning', '')
                    if event_ids:
                        print(f"  ✓ Keeping separate: {len(event_ids)} events")
                        print(f"     Reason: {reasoning}")
            
            return merge_pairs
            
        except Exception as e:
            print(f"⚠️ Error asking Gemini: {e}")
            return []
    
    def merge_events(self, master_id: str, duplicate_id: str, reason: str):
        """Merge duplicate event into master event"""
        if self.dry_run:
            # Get event names for display
            master = self.supabase.table('v2_events').select('event_name, category_tags').eq('id', master_id).execute()
            duplicate = self.supabase.table('v2_events').select('event_name, category_tags').eq('id', duplicate_id).execute()
            
            if master.data and duplicate.data:
                print(f"  🔍 [DRY RUN] Would merge:")
                print(f"     From: {duplicate.data[0]['event_name'][:80]}")
                print(f"     Into: {master.data[0]['event_name'][:80]}")
                
                # Show tag merging
                master_tags = master.data[0].get('category_tags', []) or []
                duplicate_tags = duplicate.data[0].get('category_tags', []) or []
                merged_tags = list(set(master_tags + duplicate_tags))
                if len(merged_tags) > len(master_tags):
                    print(f"     Tags would be merged: {len(master_tags)} → {len(merged_tags)} unique tags")
                
                print(f"     Reason: {reason[:200]}")
            return
        
        # Actual merge logic
        print(f"  🔄 Merging {duplicate_id} into {master_id}")
        
        try:
            # Get both events' data
            master_data = self.supabase.table('v2_events').select('*').eq('id', master_id).execute().data[0]
            duplicate_data = self.supabase.table('v2_events').select('*').eq('id', duplicate_id).execute().data[0]
            
            print(f"     From: {duplicate_data['event_name'][:80]}")
            print(f"     Into: {master_data['event_name'][:80]}")
            
            # 1. Merge category tags
            master_tags = master_data.get('category_tags', []) or []
            duplicate_tags = duplicate_data.get('category_tags', []) or []
            merged_tags = list(set(master_tags + duplicate_tags))
            
            if len(merged_tags) > len(master_tags):
                self.supabase.table('v2_events').update({
                    'category_tags': merged_tags
                }).eq('id', master_id).execute()
                print(f"     ✓ Merged tags: {len(master_tags)} → {len(merged_tags)} unique tags")
            
            # 2. Merge description if master is missing one
            if not master_data.get('event_description') and duplicate_data.get('event_description'):
                self.supabase.table('v2_events').update({
                    'event_description': duplicate_data['event_description']
                }).eq('id', master_id).execute()
                print(f"     ✓ Copied missing description from duplicate")
            
            # 3. Merge location if master is missing it
            if not master_data.get('city') and duplicate_data.get('city'):
                self.supabase.table('v2_events').update({
                    'city': duplicate_data['city']
                }).eq('id', master_id).execute()
                print(f"     ✓ Copied missing city from duplicate")
            
            # 4. Handle v2_event_post_links - delete duplicates since they likely share posts
            try:
                # First, get all post links from the duplicate
                dup_links = self.supabase.table('v2_event_post_links').select('post_id').eq('event_id', duplicate_id).execute()
                
                if dup_links.data:
                    # Check which posts are already linked to master
                    master_links = self.supabase.table('v2_event_post_links').select('post_id').eq('event_id', master_id).execute()
                    master_post_ids = {link['post_id'] for link in (master_links.data or [])}
                    
                    # Move only the posts that aren't already linked to master
                    new_posts = [link['post_id'] for link in dup_links.data if link['post_id'] not in master_post_ids]
                    
                    if new_posts:
                        # Insert new links to master
                        for post_id in new_posts:
                            self.supabase.table('v2_event_post_links').insert({
                                'event_id': master_id,
                                'post_id': post_id
                            }).execute()
                        print(f"     ✓ Added {len(new_posts)} new post links to master")
                    
                    # Delete all duplicate's post links
                    self.supabase.table('v2_event_post_links').delete().eq('event_id', duplicate_id).execute()
                    print(f"     ✓ Removed {len(dup_links.data)} post links from duplicate")
            except Exception as e:
                print(f"     ⚠️ Issue with post links: {e}")
            
            # 5. Handle v2_event_actor_links - merge unique actors only
            try:
                # Get actor links from duplicate
                dup_actors = self.supabase.table('v2_event_actor_links').select('*').eq('event_id', duplicate_id).execute()
                
                if dup_actors.data:
                    # Get existing actor links from master - need to check unknown_actor_id too for constraint
                    master_actors = self.supabase.table('v2_event_actor_links')\
                        .select('actor_handle, platform, unknown_actor_id')\
                        .eq('event_id', master_id)\
                        .execute()
                    
                    # Create sets for both handle/platform and unknown_actor_id checks
                    master_actor_keys = {(a['actor_handle'], a['platform']) for a in (master_actors.data or [])}
                    master_unknown_ids = {a['unknown_actor_id'] for a in (master_actors.data or []) if a.get('unknown_actor_id')}
                    
                    # Add only unique actors to master
                    new_actors = 0
                    skipped_actors = 0
                    for actor in dup_actors.data:
                        key = (actor['actor_handle'], actor['platform'])
                        unknown_id = actor.get('unknown_actor_id')
                        
                        # Check both constraints
                        skip = False
                        if key in master_actor_keys:
                            skip = True  # Handle/platform already exists
                        if unknown_id and unknown_id in master_unknown_ids:
                            skip = True  # Unknown actor already linked (unique constraint)
                        
                        if not skip:
                            try:
                                # Insert new actor link to master
                                self.supabase.table('v2_event_actor_links').insert({
                                    'event_id': master_id,
                                    'actor_handle': actor['actor_handle'],
                                    'actor_type': actor.get('actor_type'),
                                    'platform': actor['platform'],
                                    'actor_id': actor.get('actor_id'),
                                    'unknown_actor_id': unknown_id
                                }).execute()
                                new_actors += 1
                                
                                # Add to tracking sets so we don't try to insert duplicates
                                if unknown_id:
                                    master_unknown_ids.add(unknown_id)
                            except Exception as insert_error:
                                if 'duplicate key' in str(insert_error):
                                    skipped_actors += 1
                                else:
                                    raise insert_error
                        else:
                            skipped_actors += 1
                    
                    if new_actors > 0:
                        print(f"     ✓ Added {new_actors} new actor links to master")
                    if skipped_actors > 0:
                        print(f"     ⏭️ Skipped {skipped_actors} duplicate actor links")
                    
                    # IMPORTANT: Delete duplicate's actor links BEFORE deleting the event
                    # This prevents foreign key constraint violations
                    self.supabase.table('v2_event_actor_links').delete().eq('event_id', duplicate_id).execute()
                    print(f"     ✓ Removed all actor links from duplicate event")
            except Exception as e:
                # If we can't handle actor links properly, we need to clean them up first
                print(f"     ⚠️ Issue with actor links: {e}")
                print(f"     🧹 Cleaning up duplicate's actor links before deletion...")
                try:
                    # Force delete all actor links for the duplicate to avoid FK constraint
                    self.supabase.table('v2_event_actor_links').delete().eq('event_id', duplicate_id).execute()
                    print(f"     ✓ Cleaned up actor links")
                except Exception as cleanup_error:
                    print(f"     ❌ Failed to clean up actor links: {cleanup_error}")
                    # Don't proceed with event deletion if we can't clean up links
                    return
            
            # 6. Delete the duplicate event (only after actor links are removed)
            try:
                self.supabase.table('v2_events').delete().eq('id', duplicate_id).execute()
                print(f"     ✓ Deleted duplicate event")
            except Exception as delete_error:
                print(f"     ❌ Failed to delete duplicate event: {delete_error}")
                # This might happen if there are still references we didn't handle
            
            self.merge_count += 1
            
        except Exception as e:
            print(f"     ❌ Error merging: {e}")
    
    def process_all_groups(self, min_score=0.5, limit=None):
        """Process all duplicate groups"""
        print("\n" + "="*60)
        print("🤖 GROUP-BASED EVENT DEDUPLICATION")
        print("="*60)
        
        if self.dry_run:
            print("🔍 Running in DRY RUN mode - no changes will be made")
        else:
            print("⚠️ Running in LIVE mode - changes will be made!")
        
        # Optionally refresh the view
        if not self.dry_run:
            self.refresh_duplicate_groups()
        
        # Get duplicate groups
        groups = self.get_duplicate_groups(min_score=min_score, limit=limit)
        
        if not groups:
            print("✅ No duplicate groups found")
            return
        
        print(f"\n🔄 Processing {len(groups)} duplicate groups...")
        print("-"*60)
        
        total_merges = 0
        
        for i, group in enumerate(groups, 1):
            num_events = len(group['event_ids'])
            print(f"\n[{i}/{len(groups)}] Processing group with {num_events} events")
            print(f"  📊 Max similarity: {group['max_similarity_score']:.1%}")
            print(f"  🎯 Confidence: {group.get('confidence_level', 'unknown')}")
            
            # Analyze with Gemini
            merge_decisions = self.analyze_duplicate_group(group)
            
            if merge_decisions:
                print(f"  🎯 Found {len(merge_decisions)} duplicates to merge")
                for master_id, dup_id, reason in merge_decisions:
                    self.merge_events(master_id, dup_id, reason)
                    total_merges += 1
            else:
                print(f"  ✅ No duplicates confirmed by Gemini")
            
            # Rate limiting
            if not self.dry_run and i % 5 == 0:
                time.sleep(1)  # Pause every 5 groups
        
        # Summary
        print("\n" + "="*60)
        print("📊 DEDUPLICATION SUMMARY")
        print("="*60)
        print(f"Total groups processed: {len(groups)}")
        print(f"Total merges performed: {total_merges}")
        
        if self.dry_run:
            print("\n🔍 This was a DRY RUN - no actual changes were made")
            print("Run with --live to perform actual merges")

def main():
    parser = argparse.ArgumentParser(description='Deduplicate events using pre-computed groups')
    parser.add_argument('--live', action='store_true', help='Actually perform merges (default is dry run)')
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompt (for automation)')
    parser.add_argument('--verbose', action='store_true', help='Show detailed output')
    parser.add_argument('--min-score', type=float, default=0.5, help='Minimum similarity score (0-1)')
    parser.add_argument('--limit', type=int, help='Limit number of groups to process')
    parser.add_argument('--confidence', choices=['high', 'medium', 'low'], help='Filter by confidence level')

    # Ignored arguments for backwards compatibility with old script
    parser.add_argument('--once', action='store_true', help='(Ignored - for compatibility)')
    parser.add_argument('--sleep-seconds', type=int, help='(Ignored - for compatibility)')

    args = parser.parse_args()

    # Confirm if running in live mode (unless --yes flag is set)
    if args.live and not args.yes:
        print("⚠️ WARNING: This will make actual changes to the database!")
        response = input("Are you sure you want to continue? (yes/no): ")
        if response.lower() != 'yes':
            print("Aborted.")
            return
    
    deduplicator = GroupBasedDeduplicator(
        dry_run=not args.live,
        verbose=args.verbose
    )
    
    deduplicator.process_all_groups(
        min_score=args.min_score,
        limit=args.limit
    )

if __name__ == "__main__":
    main()