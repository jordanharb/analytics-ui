"""
Truth Social API Client
Adapted from Stanford's TruthBrush for integration with TPUSA monitoring system
"""

import os
import time
import json
import requests
from typing import Dict, List, Optional, Generator
from datetime import datetime
import logging
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger(__name__)


class TruthSocialAPI:
    """API client for Truth Social data collection"""
    
    BASE_URL = "https://truthsocial.com/api"
    OAUTH_URL = "https://truthsocial.com/oauth/token"
    CLIENT_ID = "9X1Fdd-pxNsAgEDNi_SfhJWi8T-vLuV2WVzKIbkTCw4"  # Updated from TruthBrush
    CLIENT_SECRET = "ozF8jzI4968oTKFkEnsBC-UbLPCdrSv0MkXGQu2o_-M"  # Updated from TruthBrush
    
    def __init__(self, username: str = None, password: str = None):
        """Initialize Truth Social API client
        
        Args:
            username: Truth Social username (or from env TRUTHSOCIAL_USERNAME)
            password: Truth Social password (or from env TRUTHSOCIAL_PASSWORD)
        """
        self.username = username or os.environ.get('TRUTHSOCIAL_USERNAME')
        self.password = password or os.environ.get('TRUTHSOCIAL_PASSWORD')
        
        if not self.username or not self.password:
            raise ValueError("Truth Social credentials required. Set TRUTHSOCIAL_USERNAME and TRUTHSOCIAL_PASSWORD")
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        
        self.access_token = None
        self.token_expires_at = 0
        
    def authenticate(self) -> str:
        """Authenticate and get access token"""
        if self.access_token and time.time() < self.token_expires_at:
            return self.access_token
            
        logger.info("Authenticating with Truth Social...")
        
        # First, let's try the authentication approach with updated headers
        auth_data = {
            'client_id': self.CLIENT_ID,
            'client_secret': self.CLIENT_SECRET,
            'grant_type': 'password',
            'username': self.username,
            'password': self.password,
            'scope': 'read write follow push'
        }
        
        # Update headers to be more like a real browser
        auth_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://truthsocial.com',
            'Referer': 'https://truthsocial.com/',
            'Content-Type': 'application/x-www-form-urlencoded'
        }
        
        try:
            response = self.session.post(self.OAUTH_URL, data=auth_data, headers=auth_headers)
            
            logger.debug(f"Auth response status: {response.status_code}")
            logger.debug(f"Auth response headers: {dict(response.headers)}")
            
            response.raise_for_status()
            
            token_data = response.json()
            self.access_token = token_data['access_token']
            # Set expiration with 5 minute buffer
            self.token_expires_at = time.time() + token_data.get('expires_in', 7200) - 300
            
            # Update session headers with token
            self.session.headers.update({
                'Authorization': f'Bearer {self.access_token}'
            })
            
            logger.info("Successfully authenticated with Truth Social")
            return self.access_token
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Authentication failed: {e}")
            if hasattr(e, 'response') and e.response:
                logger.error(f"Response status: {e.response.status_code}")
                logger.error(f"Response headers: {dict(e.response.headers)}")
                logger.error(f"Response body: {e.response.text[:500]}")
            raise
            
    def _make_request(self, method: str, endpoint: str, **kwargs) -> requests.Response:
        """Make authenticated request to Truth Social API"""
        # Ensure we're authenticated
        self.authenticate()
        
        url = f"{self.BASE_URL}{endpoint}"
        
        try:
            response = self.session.request(method, url, **kwargs)
            
            # Handle rate limiting
            if response.status_code == 429:
                retry_after = int(response.headers.get('X-RateLimit-Reset', 60))
                logger.warning(f"Rate limited. Sleeping for {retry_after} seconds...")
                time.sleep(retry_after)
                return self._make_request(method, endpoint, **kwargs)
                
            response.raise_for_status()
            return response
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Request failed: {method} {endpoint} - {e}")
            raise
            
    def search_posts(self, query: str, limit: int = 40) -> List[Dict]:
        """Search for posts (truths) by query
        
        Args:
            query: Search query (e.g., hashtag or keyword)
            limit: Maximum number of results
            
        Returns:
            List of post dictionaries
        """
        params = {
            'q': query,
            'type': 'statuses',
            'limit': min(limit, 40),  # API max is 40 per request
            'resolve': True
        }
        
        response = self._make_request('GET', '/v2/search', params=params)
        data = response.json()
        
        return data.get('statuses', [])
        
    def get_user_posts(self, username: str, limit: int = 40, exclude_replies: bool = True) -> Generator[Dict, None, None]:
        """Get posts from a specific user
        
        Args:
            username: Truth Social username (without @)
            limit: Maximum number of posts to retrieve
            exclude_replies: Whether to exclude reply posts
            
        Yields:
            Post dictionaries
        """
        # First, look up the user ID
        user_data = self._lookup_user(username)
        if not user_data:
            logger.error(f"User not found: {username}")
            return
            
        user_id = user_data['id']
        
        params = {
            'limit': min(limit, 40),
            'exclude_replies': exclude_replies
        }
        
        endpoint = f'/v1/accounts/{user_id}/statuses'
        
        while limit > 0:
            response = self._make_request('GET', endpoint, params=params)
            posts = response.json()
            
            if not posts:
                break
                
            for post in posts:
                yield post
                limit -= 1
                if limit <= 0:
                    return
                    
            # Check for pagination
            if 'Link' in response.headers:
                next_url = self._parse_next_link(response.headers['Link'])
                if next_url:
                    # Extract max_id from next URL
                    parsed = urlparse(next_url)
                    query_params = parse_qs(parsed.query)
                    if 'max_id' in query_params:
                        params['max_id'] = query_params['max_id'][0]
                    else:
                        break
                else:
                    break
            else:
                break
                
    def _lookup_user(self, username: str) -> Optional[Dict]:
        """Look up user by username"""
        params = {'acct': username}
        
        try:
            response = self._make_request('GET', '/v1/accounts/lookup', params=params)
            return response.json()
        except requests.exceptions.RequestException:
            return None
            
    def _parse_next_link(self, link_header: str) -> Optional[str]:
        """Parse next URL from Link header"""
        links = link_header.split(',')
        for link in links:
            if 'rel="next"' in link:
                # Extract URL from <url>; rel="next"
                url = link.split(';')[0].strip('<> ')
                return url
        return None
        
    def get_trending_hashtags(self) -> List[Dict]:
        """Get trending hashtags on Truth Social"""
        response = self._make_request('GET', '/v1/trends/tags')
        return response.json()
        
    def get_post_by_id(self, post_id: str) -> Dict:
        """Get a specific post by ID"""
        response = self._make_request('GET', f'/v1/statuses/{post_id}')
        return response.json()
        
    def get_user_profile(self, username: str) -> Optional[Dict]:
        """Get user profile information"""
        user_data = self._lookup_user(username)
        if not user_data:
            return None
            
        # Get additional account information
        user_id = user_data['id']
        response = self._make_request('GET', f'/v1/accounts/{user_id}')
        return response.json()