#!/usr/bin/env python3
"""
Deduplicate existing events in the database using Gemini's reasoning capabilities
This script finds potential duplicate events and uses Gemini to make intelligent decisions
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional
import google.generativeai as genai
from collections import defaultdict
import argparse


class QuotaExceededError(Exception):
    """Raised when the Gemini API reports quota exhaustion."""


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.database import get_supabase
from edge_functions.search_similar_events_multifield import (
    search_similar_events_multifield,
    calculate_name_similarity,
    normalize_event_name
)
from config.settings import GOOGLE_API_KEY

# Configure Gemini with dedicated deduplication key when provided
DEDUP_API_KEY = (
    os.getenv('GEMINI_DEDUP_API_KEY')
    or os.getenv('GOOGLE_GEMINI_DEDUP_API_KEY')
    or GOOGLE_API_KEY
)

if not DEDUP_API_KEY:
    raise RuntimeError(
        "Missing Gemini API key. Set GEMINI_DEDUP_API_KEY or GOOGLE_API_KEY in the environment."
    )

genai.configure(api_key=DEDUP_API_KEY)

# Initialize model - using 2.5 flash for cost efficiency
model = genai.GenerativeModel('gemini-2.5-flash')

class GeminiEventDeduplicator:
    """Use Gemini to intelligently deduplicate events"""
    
    def __init__(self, dry_run=True, verbose=False, date_range_days: Optional[int] = 30, auto_confirm: bool = False):
        self.supabase = get_supabase()
        self.dry_run = dry_run
        self.verbose = verbose
        self.merge_decisions = []
        self.skip_decisions = []
        self.processed_pairs = set()  # Track processed event pairs
        self.date_range_days = date_range_days
        self.quota_exhausted = False
        self.auto_confirm = auto_confirm
    
    def get_all_events(self, limit=None, state_filter=None):
        """Fetch all events from database"""
        print("📚 Fetching events from database...")
        
        query = self.supabase.table('v2_events').select(
            'id, event_name, event_date, city, state, event_description, created_at'
        )
        
        # Add filters if specified
        if state_filter:
            query = query.eq('state', state_filter.upper())
        
        if self.date_range_days:
            # Focus on recent events
            cutoff_date = (datetime.now() - timedelta(days=self.date_range_days)).date().isoformat()
            query = query.gte('event_date', cutoff_date)
        
        # Order by date for better processing
        query = query.order('event_date', desc=True)
        
        if limit:
            query = query.limit(limit)
        
        result = query.execute()
        events = result.data or []
        
        print(f"✅ Found {len(events)} events")
        return events
    
    def find_potential_duplicates_for_event(self, event: Dict) -> List[Dict]:
        """Find potential duplicates for a single event"""
        if not event.get('event_name'):
            return []
        
        # Use the improved search function with MUCH broader parameters
        results = search_similar_events_multifield(
            query_text=event['event_name'],
            date=event.get('event_date'),
            city=event.get('city'),
            state=event.get('state'),
            top_k=30,  # Get more candidates
            similarity_threshold=0.2,  # Much lower threshold to catch more candidates
            date_range_days=14  # Search within 2 weeks instead of 1
        )
        
        if not results.get('ok') or not results.get('data'):
            return []
        
        # Filter out the event itself but keep ALL potential matches for Gemini to evaluate
        candidates = []
        for r in results['data']:
            if r['event_id'] != event['id']:
                # Create a sortable pair ID to avoid duplicate processing
                pair_id = tuple(sorted([event['id'], r['event_id']]))
                if pair_id not in self.processed_pairs:
                    candidates.append(r)
                    self.processed_pairs.add(pair_id)
        
        # Sort by confidence and return top candidates
        candidates.sort(key=lambda x: x.get('confidence', 0), reverse=True)
        return candidates[:20]  # Send top 20 to Gemini for evaluation
    
    def ask_gemini_about_duplicates(self, event1: Dict, candidates: List[Dict]) -> List[Tuple[str, str, str]]:
        """Ask Gemini to evaluate if events are duplicates"""
        
        if not candidates:
            return []
        
        # Check if this is an electioneering event
        electioneering_keywords = [
            'canvassing', 'canvas', 'door knocking', 'voter registration',
            'ballot chase', 'chase the vote', 'get out the vote', 'gotv',
            'phone bank', 'phonebank', 'postcards', 'literature drop'
        ]
        
        event1_name_lower = event1.get('event_name', '').lower()
        event1_desc_lower = event1.get('event_description', '').lower()
        is_electioneering = any(kw in event1_name_lower or kw in event1_desc_lower 
                                for kw in electioneering_keywords)
        
        # Prepare the prompt
        prompt = f"""You are an expert at identifying duplicate events. Evaluate if these events are actually the same event that should be merged.

MAIN EVENT:
- Name: {event1.get('event_name', 'Unknown')}
- Date: {event1.get('event_date', 'Unknown')}
- Location: {event1.get('city', 'Unknown')}, {event1.get('state', 'Unknown')}
- Description: {event1.get('event_description', 'No description')[:500]}
- Event ID: {event1['id']}
- Created: {event1.get('created_at', 'Unknown')}

POTENTIAL DUPLICATES TO EVALUATE:
"""
        
        for i, candidate in enumerate(candidates, 1):
            prompt += f"""
{i}. CANDIDATE EVENT:
   - Name: {candidate.get('event_name', 'Unknown')}
   - Date: {candidate.get('event_date', 'Unknown')}
   - Location: {candidate.get('city', 'Unknown')}, {candidate.get('state', 'Unknown')}
   - Description: {candidate.get('event_description', 'No description')[:500]}
   - Event ID: {candidate['event_id']}
   - Name Similarity: {candidate.get('name_similarity', 0):.1%}
   - Match Confidence: {candidate.get('confidence', 0):.1%}
   - Match Reasons: {', '.join(candidate.get('match_reasons', []))}
"""
        
        # Add special instructions for electioneering
        if is_electioneering:
            prompt += """

⚠️ IMPORTANT - ELECTIONEERING EVENT DETECTED:
This appears to be an electioneering/canvassing event. These events happen VERY FREQUENTLY, often daily.
- DO NOT merge electioneering events unless they are on the EXACT SAME DATE and EXACT SAME LOCATION
- Even if names are identical, different dates mean different canvassing sessions
- "SRP Canvassing May 12" and "SRP Canvassing May 13" are DIFFERENT events
- Only merge if you're certain it's the same session reported multiple times
"""
        
        prompt += """

For each candidate, determine if it's a DUPLICATE of the main event. Consider:
1. Name variations (abbreviations, slight differences)
2. Date matching - for electioneering: MUST be exact same date
3. Location matching - for electioneering: MUST be exact same city
4. Description context

Respond in JSON format:
{
  "decisions": [
    {
      "candidate_number": 1,
      "event_id": "uuid-here",
      "is_duplicate": true/false,
      "confidence": "high/medium/low",
      "reasoning": "Brief explanation",
      "master_should_be": "main" or "candidate" (which event should be kept as master)
    }
  ]
}

For master selection, ALWAYS choose the event that:
1. Has the MOST SPECIFIC and detailed name (e.g., "Healthy Americans Coalition Pima County Meeting" is better than generic "TPAction Pima County Event")
2. Has more complete information (longer description, specific location details)
3. Has more posts/actors linked to it
4. Was created earlier (if dates are known)

IMPORTANT: Specificity is key! A detailed, specific event name should ALWAYS be kept over a generic one.
Example: Keep "TPAction Canvassing for SRP Election in District 4" over "TPAction Event"

Be conservative - only mark as duplicate if you're confident they're the same event.
For electioneering: require EXACT date and location match.
"""
        
        try:
            response = model.generate_content(prompt)
            response_text = response.text
            
            # Extract JSON from response
            if '```json' in response_text:
                json_str = response_text.split('```json')[1].split('```')[0].strip()
            elif '{' in response_text:
                # Find the JSON object
                start = response_text.index('{')
                end = response_text.rindex('}') + 1
                json_str = response_text[start:end]
            else:
                print(f"⚠️ Could not parse Gemini response")
                return []
            
            decisions_data = json.loads(json_str)
            
            # Process decisions
            merge_pairs = []
            for decision in decisions_data.get('decisions', []):
                if decision.get('is_duplicate'):
                    candidate_id = decision.get('event_id')
                    reasoning = decision.get('reasoning', 'No reasoning provided')
                    confidence = decision.get('confidence', 'unknown')
                    master_should_be = decision.get('master_should_be', 'main')
                    
                    # Only merge high and medium confidence duplicates
                    if confidence in ['high', 'medium']:
                        # Determine which is master based on Gemini's recommendation
                        if master_should_be == 'candidate':
                            # Swap - candidate becomes master
                            master_id = candidate_id
                            duplicate_id = event1['id']
                        else:
                            # Default - main event is master
                            master_id = event1['id']
                            duplicate_id = candidate_id
                        
                        merge_pairs.append((master_id, duplicate_id, reasoning))
                        
                        if self.verbose:
                            print(f"  🔄 Gemini says MERGE ({confidence}): {reasoning}")
                            if master_should_be == 'candidate':
                                print(f"     ↔️ Using candidate as master (better data)")
                elif self.verbose:
                    print(f"  ✓ Gemini says KEEP SEPARATE: {decision.get('reasoning', 'No reason')}")
            
            return merge_pairs
            
        except Exception as e:
            if self._is_quota_error(e):
                self.quota_exhausted = True
                raise QuotaExceededError(str(e)) from e

            print(f"⚠️ Error asking Gemini: {e}")
            if self.verbose and hasattr(e, 'response'):
                print(
                    f"Response text: {e.response.text if hasattr(e.response, 'text') else str(e.response)}"
                )
            return []

    def merge_events(self, primary_id: str, duplicate_id: str, reason: str):
        """Merge duplicate event into primary event"""
        if self.dry_run:
            # Get event details for better dry run output
            primary = self.supabase.table('v2_events').select('event_name, category_tags').eq('id', primary_id).execute()
            duplicate = self.supabase.table('v2_events').select('event_name, category_tags').eq('id', duplicate_id).execute()
            
            if primary.data and duplicate.data:
                print(f"  🔍 [DRY RUN] Would merge:")
                print(f"     From: {duplicate.data[0]['event_name'][:50]}")
                print(f"     Into: {primary.data[0]['event_name'][:50]}")
                
                # Show tag merging
                primary_tags = primary.data[0].get('category_tags', []) or []
                duplicate_tags = duplicate.data[0].get('category_tags', []) or []
                merged_tags = list(set(primary_tags + duplicate_tags))
                if len(merged_tags) > len(primary_tags):
                    print(f"     Tags would be merged: {len(primary_tags)} → {len(merged_tags)} unique tags")
            else:
                print(f"  🔍 [DRY RUN] Would merge {duplicate_id} into {primary_id}")
            
            print(f"     Reason: {reason}")
            return True
        
        try:
            print(f"  🔄 Merging events...")
            
            # Get both events' data first
            primary_event = self.supabase.table('v2_events').select('*').eq('id', primary_id).execute()
            duplicate_event = self.supabase.table('v2_events').select('*').eq('id', duplicate_id).execute()
            
            if not primary_event.data or not duplicate_event.data:
                print(f"  ❌ Could not find one or both events")
                return False
            
            primary_data = primary_event.data[0]
            duplicate_data = duplicate_event.data[0]
            
            print(f"     From: {duplicate_data['event_name'][:50]}")
            print(f"     Into: {primary_data['event_name'][:50]}")
            
            # 1. Merge category tags
            primary_tags = primary_data.get('category_tags', []) or []
            duplicate_tags = duplicate_data.get('category_tags', []) or []
            merged_tags = list(set(primary_tags + duplicate_tags))  # Deduplicate
            
            if len(merged_tags) > len(primary_tags):
                # Update primary event with merged tags
                self.supabase.table('v2_events').update({
                    'category_tags': merged_tags
                }).eq('id', primary_id).execute()
                print(f"     ✓ Merged tags: {len(primary_tags)} → {len(merged_tags)} unique tags")
            
            # 2. Optionally merge description if primary is missing one
            if not primary_data.get('event_description') and duplicate_data.get('event_description'):
                self.supabase.table('v2_events').update({
                    'event_description': duplicate_data['event_description']
                }).eq('id', primary_id).execute()
                print(f"     ✓ Added missing description from duplicate")
            
            # 3. Optionally update location if primary is missing it
            if not primary_data.get('city') and duplicate_data.get('city'):
                updates = {}
                if duplicate_data.get('city'):
                    updates['city'] = duplicate_data['city']
                if duplicate_data.get('location'):
                    updates['location'] = duplicate_data['location']
                if updates:
                    self.supabase.table('v2_events').update(updates).eq('id', primary_id).execute()
                    print(f"     ✓ Added missing location details from duplicate")
            
            # 4. Move all post links from duplicate to primary
            post_links = self.supabase.table('v2_event_post_links').select('*').eq('event_id', duplicate_id).execute()
            if post_links.data:
                moved_posts = 0
                for link in post_links.data:
                    try:
                        # Check if this post is already linked to primary
                        existing = self.supabase.table('v2_event_post_links').select('id').eq(
                            'event_id', primary_id
                        ).eq('post_id', link['post_id']).execute()
                        
                        if not existing.data:
                            # Update to point to primary event
                            self.supabase.table('v2_event_post_links').update({
                                'event_id': primary_id
                            }).eq('id', link['id']).execute()
                            moved_posts += 1
                        else:
                            # Delete duplicate link
                            self.supabase.table('v2_event_post_links').delete().eq('id', link['id']).execute()
                    except Exception as e:
                        if 'duplicate' not in str(e).lower():
                            print(f"     ⚠️ Could not move post link: {e}")
                
                print(f"     ✓ Moved {moved_posts} unique post links")
            
            # 5. Move all actor links from duplicate to primary
            actor_links = self.supabase.table('v2_event_actor_links').select('*').eq('event_id', duplicate_id).execute()
            if actor_links.data:
                moved_count = 0
                for link in actor_links.data:
                    try:
                        # Check if this actor link already exists for primary
                        existing = self.supabase.table('v2_event_actor_links').select('id').eq(
                            'event_id', primary_id
                        ).eq('actor_handle', link['actor_handle']).eq(
                            'platform', link['platform']
                        ).execute()
                        
                        if not existing.data:
                            # Create new link for primary event
                            new_link = {
                                'event_id': primary_id,
                                'actor_handle': link['actor_handle'],
                                'platform': link['platform'],
                                'actor_type': link.get('actor_type'),
                                'actor_id': link.get('actor_id'),
                                'unknown_actor_id': link.get('unknown_actor_id')
                            }
                            self.supabase.table('v2_event_actor_links').insert(new_link).execute()
                            moved_count += 1
                    except Exception as e:
                        if 'duplicate' not in str(e).lower():
                            print(f"     ⚠️ Could not move actor link: {e}")
                
                # Delete old actor links
                self.supabase.table('v2_event_actor_links').delete().eq('event_id', duplicate_id).execute()
                print(f"     ✓ Moved {moved_count} unique actor links")
            
            # 6. Delete the duplicate event
            self.supabase.table('v2_events').delete().eq('id', duplicate_id).execute()
            print(f"     ✓ Deleted duplicate event")
            print(f"     📝 Reason: {reason}")
            
            return True
            
        except Exception as e:
            print(f"  ❌ Error merging events: {e}")
            return False
    
    def run_deduplication(self, limit=None, state_filter=None):
        """Run the deduplication process"""
        print("\n" + "=" * 60)
        print("🤖 GEMINI-POWERED EVENT DEDUPLICATION")
        print("=" * 60)

        # Reset per-run state
        self.merge_decisions = []
        self.skip_decisions = []
        self.processed_pairs.clear()

        if self.dry_run:
            print("🔍 Running in DRY RUN mode - no changes will be made")
        else:
            print("⚠️  Running in LIVE mode - changes WILL be made!")
            if not self.auto_confirm:
                response = input("Are you sure you want to continue? (yes/no): ")
                if response.lower() != 'yes':
                    print("Aborted.")
                    return {
                        'total_events': 0,
                        'total_candidates': 0,
                        'total_merges': 0,
                        'aborted': True
                    }
            else:
                print("🟢 Auto-confirm enabled via --yes flag")
        
        # Get all events
        events = self.get_all_events(limit=limit, state_filter=state_filter)
        
        if not events:
            print("No events found to process")
            return {
                'total_events': 0,
                'total_candidates': 0,
                'total_merges': 0
            }
        
        # Process each event
        total_merges = 0
        total_evaluated = 0
        
        print(f"\n🔄 Processing {len(events)} events...")
        print("-" * 60)
        
        for i, event in enumerate(events, 1):
            if not event.get('event_name'):
                continue
            
            print(f"\n[{i}/{len(events)}] Checking: {event['event_name'][:60]}...")
            print(f"  📅 Date: {event.get('event_date')}, 📍 Location: {event.get('city')}, {event.get('state')}")
            
            # Find potential duplicates
            candidates = self.find_potential_duplicates_for_event(event)
            
            if candidates:
                print(f"  🔍 Found {len(candidates)} potential duplicates")
                total_evaluated += len(candidates)
                
                # Ask Gemini to evaluate
                try:
                    merge_decisions = self.ask_gemini_about_duplicates(event, candidates[:5])  # Limit to top 5
                except QuotaExceededError:
                    print("  ⛔ Gemini quota exhausted during duplicate evaluation")
                    raise
                
                if merge_decisions:
                    for primary_id, duplicate_id, reason in merge_decisions:
                        # Find the duplicate event details for logging
                        dup_event = next((c for c in candidates if c['event_id'] == duplicate_id), None)
                        if dup_event:
                            print(f"  🎯 Duplicate found: {dup_event['event_name'][:60]}")
                            
                        if self.merge_events(primary_id, duplicate_id, reason):
                            total_merges += 1
                            self.merge_decisions.append({
                                'primary_id': primary_id,
                                'duplicate_id': duplicate_id,
                                'primary_name': event['event_name'],
                                'duplicate_name': dup_event['event_name'] if dup_event else 'Unknown',
                                'reason': reason
                            })
                else:
                    print(f"  ✅ No duplicates confirmed by Gemini")
            else:
                print(f"  ✅ No potential duplicates found")
            
            # Rate limiting for Gemini API
            if i % 10 == 0:
                time.sleep(2)  # Pause every 10 events
        
        # Print summary
        print("\n" + "=" * 60)
        print("📊 DEDUPLICATION SUMMARY")
        print("=" * 60)
        print(f"Total events processed: {len(events)}")
        print(f"Total candidates evaluated: {total_evaluated}")
        print(f"Total merges performed: {total_merges}")
        
        if self.merge_decisions:
            print("\n📋 Merge Decisions:")
            for decision in self.merge_decisions:
                print(f"\n  • Merged: {decision['duplicate_name'][:50]}")
                print(f"    Into: {decision['primary_name'][:50]}")
                print(f"    Reason: {decision['reason']}")
        
        if self.dry_run:
            print("\n🔍 This was a DRY RUN - no actual changes were made")
            print("Run with --live to perform actual merges")

        return {
            'total_events': len(events),
            'total_candidates': total_evaluated,
            'total_merges': total_merges
        }

    @staticmethod
    def _is_quota_error(exc: Exception) -> bool:
        """Heuristically determine whether an exception is a quota/rate limit error."""
        message = str(exc).lower()
        quota_keywords = [
            'quota',
            'rate limit',
            'too many requests',
            '429',
            'resource exhausted',
            'daily limit'
        ]
        if any(keyword in message for keyword in quota_keywords):
            return True

        status = getattr(exc, 'status_code', None) or getattr(exc, 'code', None)
        return status == 429


def main():
    parser = argparse.ArgumentParser(description='Deduplicate events using Gemini reasoning')
    parser.add_argument('--live', action='store_true', help='Actually perform merges (default is dry run)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed output')
    parser.add_argument('--limit', type=int, help='Limit number of events to process')
    parser.add_argument('--state', help='Filter to specific state (e.g., AZ)')
    parser.add_argument('--recent-days', type=int, default=30, help='Only process events from last N days (default: 30)')
    parser.add_argument('--yes', action='store_true', help='Skip confirmation prompts when running live mode')
    parser.add_argument('--once', action='store_true', help='Run a single pass then exit')
    parser.add_argument(
        '--sleep-seconds',
        type=int,
        default=int(os.getenv('DEDUP_SLEEP_SECONDS', '300')),
        help='Seconds to sleep between passes when running continuously (default: 300)'
    )
    
    args = parser.parse_args()
    
    # Create deduplicator
    deduplicator = GeminiEventDeduplicator(
        dry_run=not args.live,
        verbose=args.verbose,
        date_range_days=args.recent_days,
        auto_confirm=args.yes or not args.live
    )
    
    try:
        while True:
            summary = deduplicator.run_deduplication(
                limit=args.limit,
                state_filter=args.state
            )

            if deduplicator.quota_exhausted:
                print("🚫 Gemini daily quota reached. Exiting deduplication loop.")
                break

            if args.once or (summary and summary.get('aborted')):
                break

            merges = (summary or {}).get('total_merges', 0)
            sleep_seconds = max(30, args.sleep_seconds if merges == 0 else max(60, args.sleep_seconds // 2))
            print(f"😴 Sleeping for {sleep_seconds} seconds before next deduplication pass...")
            time.sleep(sleep_seconds)

    except QuotaExceededError as quota_err:
        print(f"🚫 Gemini quota reached: {quota_err}")
    except KeyboardInterrupt:
        print("⏹️ Deduplication interrupted by user")


if __name__ == "__main__":
    main()
