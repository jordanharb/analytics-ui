"""
Improved embedding utilities for enhanced vector search with multi-field embeddings
"""
import google.generativeai as genai
from typing import List, Optional, Dict, Tuple
from config.settings import GOOGLE_API_KEY
import numpy as np

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)

def generate_event_embeddings_separate(
    event_name: str, 
    event_description: str = "", 
    location: str = ""
) -> Optional[Dict[str, List[float]]]:
    """
    Generate separate embeddings for different event fields
    
    Args:
        event_name: Name of the event
        event_description: Description of the event
        location: Location information (city, state)
    
    Returns:
        Dictionary with separate embeddings for each field
    """
    try:
        embeddings = {}
        
        # Generate embedding for event name (most important)
        if event_name:
            name_result = genai.embed_content(
                model="models/text-embedding-004",
                content=event_name,
                task_type="retrieval_document"
            )
            embeddings['name_embedding'] = name_result['embedding']
        
        # Generate embedding for description (if provided)
        if event_description:
            desc_result = genai.embed_content(
                model="models/text-embedding-004",
                content=event_description,
                task_type="retrieval_document"
            )
            embeddings['description_embedding'] = desc_result['embedding']
        
        # Generate embedding for location (if provided)
        if location:
            loc_result = genai.embed_content(
                model="models/text-embedding-004",
                content=location,
                task_type="retrieval_document"
            )
            embeddings['location_embedding'] = loc_result['embedding']
        
        # Also generate combined embedding for backward compatibility
        text_parts = []
        if event_name:
            text_parts.append(event_name)
        if event_description:
            text_parts.append(event_description)
        if location:
            text_parts.append(location)
        
        if text_parts:
            combined_text = " ".join(text_parts)
            combined_result = genai.embed_content(
                model="models/text-embedding-004",
                content=combined_text,
                task_type="retrieval_document"
            )
            embeddings['combined_embedding'] = combined_result['embedding']
        
        return embeddings
    
    except Exception as e:
        print(f"Error generating separate embeddings: {e}")
        return None


def generate_weighted_event_embedding(
    event_name: str,
    event_description: str = "",
    location: str = "",
    weights: Dict[str, float] = None
) -> Optional[List[float]]:
    """
    Generate a weighted combination of embeddings for an event
    
    Args:
        event_name: Name of the event
        event_description: Description of the event
        location: Location information (city, state)
        weights: Dictionary of weights for each field (default: name=0.6, description=0.3, location=0.1)
    
    Returns:
        Weighted 768-dimension embedding vector or None if error
    """
    if weights is None:
        weights = {
            'name': 0.6,
            'description': 0.3,
            'location': 0.1
        }
    
    try:
        embeddings = []
        total_weight = 0
        
        # Generate and weight embeddings
        if event_name and weights.get('name', 0) > 0:
            name_result = genai.embed_content(
                model="models/text-embedding-004",
                content=event_name,
                task_type="retrieval_document"
            )
            embeddings.append((np.array(name_result['embedding']), weights['name']))
            total_weight += weights['name']
        
        if event_description and weights.get('description', 0) > 0:
            desc_result = genai.embed_content(
                model="models/text-embedding-004",
                content=event_description,
                task_type="retrieval_document"
            )
            embeddings.append((np.array(desc_result['embedding']), weights['description']))
            total_weight += weights['description']
        
        if location and weights.get('location', 0) > 0:
            loc_result = genai.embed_content(
                model="models/text-embedding-004",
                content=location,
                task_type="retrieval_document"
            )
            embeddings.append((np.array(loc_result['embedding']), weights['location']))
            total_weight += weights['location']
        
        if not embeddings:
            return None
        
        # Normalize weights and combine
        weighted_embedding = np.zeros(768)  # Gemini text-embedding-004 produces 768-dim vectors
        for embedding, weight in embeddings:
            normalized_weight = weight / total_weight
            weighted_embedding += embedding * normalized_weight
        
        # Normalize the final vector
        norm = np.linalg.norm(weighted_embedding)
        if norm > 0:
            weighted_embedding = weighted_embedding / norm
        
        return weighted_embedding.tolist()
    
    except Exception as e:
        print(f"Error generating weighted embedding: {e}")
        return None


def generate_query_embeddings_separate(query_text: str, query_location: str = "") -> Optional[Dict[str, List[float]]]:
    """
    Generate separate embeddings for query components
    
    Args:
        query_text: The main search query (event name/description)
        query_location: Optional location component
    
    Returns:
        Dictionary with separate query embeddings
    """
    try:
        embeddings = {}
        
        # Generate embedding for main query
        if query_text:
            text_result = genai.embed_content(
                model="models/text-embedding-004",
                content=query_text,
                task_type="retrieval_query"
            )
            embeddings['text_embedding'] = text_result['embedding']
        
        # Generate embedding for location if provided
        if query_location:
            loc_result = genai.embed_content(
                model="models/text-embedding-004",
                content=query_location,
                task_type="retrieval_query"
            )
            embeddings['location_embedding'] = loc_result['embedding']
        
        # Also generate combined for compatibility
        combined_parts = []
        if query_text:
            combined_parts.append(query_text)
        if query_location:
            combined_parts.append(query_location)
        
        if combined_parts:
            combined = " ".join(combined_parts)
            combined_result = genai.embed_content(
                model="models/text-embedding-004",
                content=combined,
                task_type="retrieval_query"
            )
            embeddings['combined_embedding'] = combined_result['embedding']
        
        return embeddings
    
    except Exception as e:
        print(f"Error generating query embeddings: {e}")
        return None


def calculate_multi_field_similarity(
    query_embeddings: Dict[str, List[float]],
    event_embeddings: Dict[str, List[float]],
    weights: Dict[str, float] = None
) -> float:
    """
    Calculate weighted similarity between query and event using multiple embedding fields
    
    Args:
        query_embeddings: Dictionary of query embeddings
        event_embeddings: Dictionary of event embeddings
        weights: Weights for different fields
    
    Returns:
        Weighted similarity score between 0 and 1
    """
    if weights is None:
        weights = {
            'name': 0.6,
            'description': 0.3,
            'location': 0.1
        }
    
    try:
        total_similarity = 0
        total_weight = 0
        
        # Calculate similarity for name
        if 'text_embedding' in query_embeddings and 'name_embedding' in event_embeddings:
            query_vec = np.array(query_embeddings['text_embedding'])
            event_vec = np.array(event_embeddings['name_embedding'])
            similarity = np.dot(query_vec, event_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(event_vec))
            total_similarity += similarity * weights.get('name', 0.6)
            total_weight += weights.get('name', 0.6)
        
        # Calculate similarity for description (use text embedding vs description)
        if 'text_embedding' in query_embeddings and 'description_embedding' in event_embeddings:
            query_vec = np.array(query_embeddings['text_embedding'])
            event_vec = np.array(event_embeddings['description_embedding'])
            similarity = np.dot(query_vec, event_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(event_vec))
            total_similarity += similarity * weights.get('description', 0.3)
            total_weight += weights.get('description', 0.3)
        
        # Calculate similarity for location
        if 'location_embedding' in query_embeddings and 'location_embedding' in event_embeddings:
            query_vec = np.array(query_embeddings['location_embedding'])
            event_vec = np.array(event_embeddings['location_embedding'])
            similarity = np.dot(query_vec, event_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(event_vec))
            total_similarity += similarity * weights.get('location', 0.1)
            total_weight += weights.get('location', 0.1)
        
        # Fallback to combined embeddings if no field matches
        if total_weight == 0 and 'combined_embedding' in query_embeddings and 'combined_embedding' in event_embeddings:
            query_vec = np.array(query_embeddings['combined_embedding'])
            event_vec = np.array(event_embeddings['combined_embedding'])
            return float(np.dot(query_vec, event_vec) / (np.linalg.norm(query_vec) * np.linalg.norm(event_vec)))
        
        if total_weight > 0:
            return float(total_similarity / total_weight)
        
        return 0.0
    
    except Exception as e:
        print(f"Error calculating multi-field similarity: {e}")
        return 0.0


# Keep backward compatibility functions
def generate_event_embedding(event_name: str, event_description: str = "", location: str = "") -> Optional[List[float]]:
    """
    Backward compatible function - generates weighted embedding
    """
    return generate_weighted_event_embedding(event_name, event_description, location)


def generate_query_embedding(query_text: str) -> Optional[List[float]]:
    """
    Backward compatible function - generates standard query embedding
    """
    try:
        result = genai.embed_content(
            model="models/text-embedding-004",
            content=query_text,
            task_type="retrieval_query"
        )
        return result['embedding']
    except Exception as e:
        print(f"Error generating query embedding: {e}")
        return None