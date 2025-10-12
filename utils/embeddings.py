"""
Embedding utilities for vector search
"""
import google.generativeai as genai
from typing import List, Optional
from config.settings import GOOGLE_API_KEY
import time

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)

def generate_event_embedding(event_name: str, event_description: str = "", location: str = "", max_retries: int = 3) -> Optional[List[float]]:
    """
    Generate embedding for an event using Gemini's text-embedding model with retry logic
    
    Args:
        event_name: Name of the event
        event_description: Description of the event
        location: Location information (city, state)
        max_retries: Maximum number of retries for rate limit errors
    
    Returns:
        768-dimension embedding vector or None if error
    """
    # Combine relevant text for embedding
    text_parts = [event_name]
    if event_description:
        text_parts.append(event_description)
    if location:
        text_parts.append(location)
    
    combined_text = " ".join(text_parts)
    
    # Try with exponential backoff for rate limit errors
    for attempt in range(max_retries):
        try:
            # Generate embedding
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=combined_text,
                task_type="retrieval_document"  # For storing documents
            )
            
            return result['embedding']
        
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "quota" in error_str.lower():
                # Rate limit error - retry with exponential backoff
                if attempt < max_retries - 1:
                    wait_time = 2 ** (attempt + 1)  # 2, 4, 8 seconds
                    print(f"Rate limit hit, waiting {wait_time}s before retry {attempt + 2}/{max_retries}...")
                    time.sleep(wait_time)
                    continue
            
            # For other errors or final attempt, log and return None
            print(f"Error generating embedding: {e}")
            return None
    
    return None


def generate_query_embedding(query_text: str) -> Optional[List[float]]:
    """
    Generate embedding for a search query
    
    Args:
        query_text: The search query
    
    Returns:
        768-dimension embedding vector or None if error
    """
    try:
        result = genai.embed_content(
            model="models/text-embedding-004",
            content=query_text,
            task_type="retrieval_query"  # For queries
        )
        
        return result['embedding']
    
    except Exception as e:
        print(f"Error generating query embedding: {e}")
        return None