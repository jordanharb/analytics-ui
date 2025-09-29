#!/usr/bin/env python3
"""
Script to link legislators to their campaign finance entities using fuzzy matching.
This script provides better matching capabilities than pure SQL.
"""

import os
import difflib
from typing import List, Tuple, Dict, Optional
import re
from supabase import create_client, Client

def normalize_name(name: str) -> str:
    """Normalize a name for better matching."""
    if not name:
        return ""
    
    # Convert to lowercase and remove extra spaces
    name = re.sub(r'\s+', ' ', name.lower().strip())
    
    # Remove common suffixes
    name = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', name, flags=re.IGNORECASE)
    
    return name

def reverse_name_format(name: str) -> str:
    """Convert 'Last, First' format to 'First Last' format."""
    if ',' in name:
        parts = name.split(',', 1)
        return f"{parts[1].strip()} {parts[0].strip()}"
    return name

def calculate_similarity(name1: str, name2: str) -> float:
    """Calculate similarity between two names."""
    if not name1 or not name2:
        return 0.0
    
    norm1 = normalize_name(name1)
    norm2 = normalize_name(name2)
    
    # Exact match
    if norm1 == norm2:
        return 1.0
    
    # Check if one contains the other
    if norm1 in norm2 or norm2 in norm1:
        return 0.9
    
    # Use difflib for fuzzy matching
    return difflib.SequenceMatcher(None, norm1, norm2).ratio()

def find_legislator_entity_matches(supabase: Client) -> List[Tuple[int, int, str, str, float]]:
    """Find matches between legislators and entities."""
    
    # Get all legislators
    legislators_response = supabase.table('legislators').select("""
        legislator_id,
        full_name,
        rs_person_legislators!inner(person_id, rs_people!inner(person_id, display_name))
    """).execute()
    
    legislators = []
    for leg in legislators_response.data:
        if leg['rs_person_legislators'] and leg['rs_person_legislators'][0]['rs_people']:
            legislators.append((
                leg['legislator_id'],
                leg['full_name'],
                leg['rs_person_legislators'][0]['rs_people']['person_id']
            ))
    
    # Get all candidate entities
    entities_response = supabase.table('cf_entity_records').select("""
        entity_id,
        entity_name,
        entity_first_name,
        committee_name,
        candidate
    """).ilike('entity_type', '%Candidate%').not_.is_('entity_name', 'null').neq('entity_name', '').execute()
    
    entities = [(e['entity_id'], e['entity_name'], e['entity_first_name'], e['committee_name'], e['candidate']) 
                for e in entities_response.data]
    
    matches = []
    
    for legislator_id, legislator_name, person_id in legislators:
        best_match = None
        best_score = 0.0
        
        for entity_id, entity_name, entity_first_name, committee_name, candidate in entities:
            # Check various name combinations
            names_to_check = [
                entity_name,
                candidate,
                committee_name,
                reverse_name_format(entity_name)
            ]
            
            for name in names_to_check:
                if not name:
                    continue
                
                score = calculate_similarity(legislator_name, name)
                
                if score > best_score and score >= 0.6:  # Minimum threshold
                    best_match = (entity_id, name, score)
                    best_score = score
        
        if best_match:
            matches.append((person_id, best_match[0], legislator_name, best_match[1], best_match[2]))
    
    return matches

def insert_matches(supabase: Client, matches: List[Tuple[int, int, str, str, float]]):
    """Insert the matches into the database."""
    
    # Insert matches that don't already exist
    for person_id, entity_id, legislator_name, entity_name, score in matches:
        try:
            # Check if the relationship already exists
            existing = supabase.table('rs_person_cf_entities').select('person_id, entity_id').eq('person_id', person_id).eq('entity_id', entity_id).execute()
            
            if not existing.data:
                # Insert the new relationship
                supabase.table('rs_person_cf_entities').insert({
                    'person_id': person_id,
                    'entity_id': entity_id
                }).execute()
                
                print(f"Linked: {legislator_name} -> {entity_name} (score: {score:.2f})")
            else:
                print(f"Already linked: {legislator_name} -> {entity_name}")
                
        except Exception as e:
            print(f"Error linking {legislator_name} to {entity_name}: {e}")

def main():
    """Main function to run the linking process."""
    
    # Get database connection parameters from environment
    supabase_url = os.getenv('VITE_CAMPAIGN_FINANCE_SUPABASE_URL') or os.getenv('CAMPAIGN_FINANCE_SUPABASE_URL')
    supabase_key = os.getenv('VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY') or os.getenv('CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: Missing database connection parameters.")
        print("Please set VITE_CAMPAIGN_FINANCE_SUPABASE_URL and VITE_CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY")
        print("or CAMPAIGN_FINANCE_SUPABASE_URL and CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY")
        return
    
    try:
        supabase = create_client(supabase_url, supabase_key)
        print("Connected to Supabase database")
        
        # Find matches
        print("Finding matches...")
        matches = find_legislator_entity_matches(supabase)
        
        print(f"Found {len(matches)} potential matches")
        
        # Show some examples
        print("\nSample matches:")
        for person_id, entity_id, legislator_name, entity_name, score in matches[:10]:
            print(f"  {legislator_name} -> {entity_name} (score: {score:.2f})")
        
        # Ask for confirmation
        response = input(f"\nInsert {len(matches)} matches? (y/n): ")
        if response.lower() == 'y':
            insert_matches(supabase, matches)
            print("Matches inserted successfully!")
        else:
            print("No matches inserted.")
        
        # Refresh materialized view
        supabase.rpc('refresh_materialized_view', {'view_name': 'mv_legislators_search'}).execute()
        print("Materialized view refreshed")
        
        # Show final results
        result = supabase.table('mv_legislators_search').select('person_id, entity_id').not_.is_('all_entity_ids', 'null').execute()
        
        legislators_with_entities = len(set(row['person_id'] for row in result.data if row['all_entity_ids']))
        unique_entities = len(set(row['entity_id'] for row in result.data if row['entity_id']))
        
        print(f"\nFinal results: {legislators_with_entities} legislators with entities, {unique_entities} unique entities linked")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
