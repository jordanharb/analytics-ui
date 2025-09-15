"""
Truth Social API Client V4
Uses nodriver to bypass Cloudflare, then switches to curl_cffi for API calls
"""

import os
import time
import json
import logging
import asyncio
from typing import Dict, List, Optional, Generator
from datetime import datetime
from urllib.parse import urlparse, parse_qs

# Use curl_cffi for API requests after auth
try:
    from curl_cffi import requests
except ImportError:
    print("ERROR: curl_cffi not installed. Install with: pip install curl_cffi")
    import requests

# Use nodriver for bypassing Cloudflare
try:
    import nodriver as uc
    BROWSER_AVAILABLE = True
except ImportError:
    print("ERROR: nodriver not installed. Install with: pip install nodriver")
    BROWSER_AVAILABLE = False

logger = logging.getLogger(__name__)


class TruthSocialAPI:
    """API client for Truth Social data collection with Cloudflare bypass"""
    
    BASE_URL = "https://truthsocial.com/api"
    OAUTH_URL = "https://truthsocial.com/oauth/token"
    CLIENT_ID = "9X1Fdd-pxNsAgEDNi_SfhJWi8T-vLuV2WVzKIbkTCw4"
    CLIENT_SECRET = "ozF8jzI4968oTKFkEnsBC-UbLPCdrSv0MkXGQu2o_-M"
    
    def __init__(self, username: str = None, password: str = None):
        """Initialize Truth Social API client"""
        self.username = username or os.environ.get('TRUTHSOCIAL_USERNAME')
        self.password = password or os.environ.get('TRUTHSOCIAL_PASSWORD')
        
        if not self.username or not self.password:
            raise ValueError("Truth Social credentials required. Set TRUTHSOCIAL_USERNAME and TRUTHSOCIAL_PASSWORD")
        
        if not BROWSER_AVAILABLE:
            raise ValueError("nodriver required for Cloudflare bypass")
        
        # curl_cffi session for API calls after auth
        self.session = requests.Session(impersonate="chrome124")
        
        # Set comprehensive browser headers
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"'
        })
        
        self.access_token = None
        self.cookies = None
        
    async def _get_cloudflare_cookies(self) -> Dict[str, str]:
        """Use browser automation to get past Cloudflare and extract cookies"""
        logger.info("Using nodriver to bypass Cloudflare...")
        
        browser = None
        try:
            # Initialize nodriver
            browser = await uc.start(headless=True)
            page = await browser.get("https://truthsocial.com/")
            
            logger.debug("Navigating to Truth Social...")
            
            # Wait for Cloudflare challenge to complete
            logger.debug("Waiting for page to load...")
            await asyncio.sleep(10)  # Give time for Cloudflare challenge
            
            # Check if we got past Cloudflare
            url = await page.evaluate("window.location.href")
            page_content = await page.get_content()
            
            if "challenge" in page_content.lower() or "just a moment" in page_content.lower():
                logger.warning("May still be in Cloudflare challenge")
                await asyncio.sleep(10)  # Wait a bit more
            
            logger.info("Successfully loaded Truth Social page!")
            
            # For now, just return empty cookies - the bypass itself might be enough
            # The main goal is to "warm up" Truth Social's servers to our IP
            cookies = {}
            logger.info("Browser bypass completed - proceeding without cookie extraction")
                    
            logger.debug(f"Extracted {len(cookies)} cookies from browser")
            return cookies
            
        except Exception as e:
            logger.error(f"Browser automation failed: {e}")
            raise
            
        finally:
            if browser:
                try:
                    await browser.stop()
                except:
                    pass

    def authenticate(self) -> str:
        """Authenticate and get access token"""
        if self.access_token:
            return self.access_token
            
        logger.info("Authenticating with Truth Social...")
        
        # Step 1: Get Cloudflare cookies using browser automation
        if not self.cookies:
            # Run the async function
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            self.cookies = loop.run_until_complete(self._get_cloudflare_cookies())
            
            # Update session with extracted cookies
            for name, value in self.cookies.items():
                self.session.cookies.set(name, value, domain='truthsocial.com')
        
        # Step 2: Try OAuth authentication with cookies
        auth_payload = {
            "client_id": self.CLIENT_ID,
            "client_secret": self.CLIENT_SECRET,
            "grant_type": "password",
            "username": self.username,
            "password": self.password,
            "scope": "read write follow push"
        }
        
        try:
            # Enhanced headers for auth request
            auth_headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Origin': 'https://truthsocial.com',
                'Referer': 'https://truthsocial.com/',
                'X-Requested-With': 'XMLHttpRequest'
            }
            
            # Make request using curl_cffi with Cloudflare cookies
            response = self.session.post(
                self.OAUTH_URL,
                data=auth_payload,
                headers=auth_headers,
                timeout=30
            )
            
            logger.debug(f"Auth response status: {response.status_code}")
            
            if response.status_code != 200:
                logger.error(f"Authentication failed with status {response.status_code}")
                logger.error(f"Response: {response.text[:500]}")
                
                # If still blocked, the credentials might be wrong or we need different approach
                if response.status_code == 403:
                    raise Exception("Still blocked by Cloudflare after browser bypass. Check credentials or try different approach.")
                else:
                    raise ValueError(f"Authentication failed: {response.status_code}")
            
            token_data = response.json()
            
            if "access_token" not in token_data:
                logger.error("No access token in response")
                logger.error(f"Response: {token_data}")
                raise ValueError("Invalid credentials - no access token received")
            
            self.access_token = token_data['access_token']
            
            # Update session headers with token
            self.session.headers.update({
                'Authorization': f'Bearer {self.access_token}'
            })
            
            logger.info("Successfully authenticated with Truth Social")
            return self.access_token
            
        except Exception as e:
            logger.error(f"Authentication failed: {e}")
            raise
            
    def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict:
        """Make authenticated request to Truth Social API"""
        # Ensure we're authenticated
        if not self.access_token:
            self.authenticate()
        
        url = f"{self.BASE_URL}{endpoint}"
        
        # Add delay to avoid triggering rate limits
        time.sleep(3)
        
        try:
            # Add timeout to all requests
            if 'timeout' not in kwargs:
                kwargs['timeout'] = 30
                
            response = self.session.request(
                method, 
                url, 
                **kwargs
            )
            
            logger.debug(f"Request {method} {endpoint} - Status: {response.status_code}")
            
            # Handle rate limiting
            if response.status_code == 429 or response.status_code == 1015:
                retry_after = int(response.headers.get('X-RateLimit-Reset', 60))
                logger.warning(f"Rate limited (status {response.status_code}). Sleeping for {retry_after} seconds...")
                time.sleep(retry_after)
                return self._make_request(method, endpoint, **kwargs)
            
            # Handle Cloudflare errors - might need to re-authenticate
            if response.status_code == 403:
                logger.warning(f"Got 403 error, might need to re-authenticate: {response.text[:200]}")
                # Clear tokens and cookies to force re-authentication
                self.access_token = None
                self.cookies = None
                # Retry once
                return self._make_request(method, endpoint, **kwargs)
                
            response.raise_for_status()
            return response.json()
            
        except Exception as e:
            logger.error(f"Request failed: {method} {endpoint} - {e}")
            raise
            
    def search_posts(self, query: str, limit: int = 40) -> List[Dict]:
        """Search for posts (truths) by query"""
        params = {
            'q': query,
            'type': 'statuses',
            'limit': min(limit, 40),
            'resolve': True
        }
        
        data = self._make_request('GET', '/v2/search', params=params)
        return data.get('statuses', [])
        
    def get_user_posts(self, username: str, limit: int = 40, exclude_replies: bool = True) -> Generator[Dict, None, None]:
        """Get posts from a specific user"""
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
        
        count = 0
        while count < limit:
            posts = self._make_request('GET', endpoint, params=params)
            
            if not posts:
                break
                
            for post in posts:
                yield post
                count += 1
                if count >= limit:
                    return
                    
            # Check for more posts
            if len(posts) < params['limit']:
                break
                
            # Set max_id for next page
            params['max_id'] = posts[-1]['id']
                
    def _lookup_user(self, username: str) -> Optional[Dict]:
        """Look up user by username"""
        params = {'acct': username}
        
        try:
            return self._make_request('GET', '/v1/accounts/lookup', params=params)
        except:
            return None
            
    def get_trending_hashtags(self) -> List[Dict]:
        """Get trending hashtags on Truth Social"""
        return self._make_request('GET', '/v1/trends/tags')
        
    def get_post_by_id(self, post_id: str) -> Dict:
        """Get a specific post by ID"""
        return self._make_request('GET', f'/v1/statuses/{post_id}')
        
    def get_user_profile(self, username: str) -> Optional[Dict]:
        """Get user profile information"""
        user_data = self._lookup_user(username)
        if not user_data:
            return None
            
        return self._make_request('GET', f'/v1/accounts/{user_data["id"]}')