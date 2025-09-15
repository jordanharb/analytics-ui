import json
import requests
from pathlib import Path
from typing import Optional, Tuple

# Try to use enhanced geocoding if available
try:
    from .enhanced_geocoding import geocode_city_state as enhanced_geocode, get_cache_stats
    ENHANCED_AVAILABLE = True
except ImportError:
    ENHANCED_AVAILABLE = False

CACHE_FILE = Path(__file__).resolve().parent.parent / 'data' / 'geo_cache.json'
CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

try:
    with open(CACHE_FILE, 'r') as f:
        GEO_CACHE = json.load(f)
except Exception:
    GEO_CACHE = {}


def save_cache():
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(GEO_CACHE, f)
    except Exception:
        pass


def geocode_city_state(city: str, state: str) -> Optional[Tuple[float, float]]:
    """Geocode city and state using enhanced geocoding with database caching if available, otherwise basic caching."""
    
    # Use enhanced geocoding if available
    if ENHANCED_AVAILABLE:
        return enhanced_geocode(city, state)
    
    # Fallback to original implementation
    key = f"{city},{state}"
    if key in GEO_CACHE:
        result = GEO_CACHE[key]
        if result:
            return tuple(result)
        
    url = "https://nominatim.openstreetmap.org/search"
    params = {
        "format": "json",
        "limit": 1,
        "city": city,
        "state": state,
    }
    headers = {"Accept": "application/json", "User-Agent": "tpusa-monitoring"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data:
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            GEO_CACHE[key] = [lat, lon]
            save_cache()
            return (lat, lon)
    except Exception:
        pass
    GEO_CACHE[key] = None
    save_cache()
    return None
