"""
Embedding Manager with rate limiting and batch processing
"""
import time
import threading
from typing import List, Dict, Optional, Tuple
from collections import deque
import google.generativeai as genai
from config.settings import GOOGLE_API_KEY

# Configure Gemini
genai.configure(api_key=GOOGLE_API_KEY)

class EmbeddingManager:
    """Manages embedding generation with rate limiting and batch processing"""

    def __init__(self, max_requests_per_minute: int = 60):
        self.max_rpm = max_requests_per_minute
        self.request_times = deque(maxlen=max_requests_per_minute)
        self.lock = threading.Lock()
        self.total_requests = 0
        self.failed_requests = 0
        self.last_error_time = 0

    def _wait_if_needed(self):
        """Wait if we're approaching rate limit"""
        with self.lock:
            now = time.time()

            # Remove requests older than 1 minute
            while self.request_times and self.request_times[0] < now - 60:
                self.request_times.popleft()

            # If we're at the limit, wait
            if len(self.request_times) >= self.max_rpm:
                sleep_time = 60 - (now - self.request_times[0]) + 1
                if sleep_time > 0:
                    print(f"⏳ Rate limit approaching, waiting {sleep_time:.1f}s...")
                    time.sleep(sleep_time)

            # Record this request
            self.request_times.append(now)
            self.total_requests += 1

    def generate_event_embedding(self, event_name: str, event_description: str = "", location: str = "") -> Optional[List[float]]:
        """Generate embedding with rate limiting"""
        # Wait if needed for rate limiting
        self._wait_if_needed()

        # Combine text
        text_parts = [event_name]
        if event_description:
            text_parts.append(event_description)
        if location:
            text_parts.append(location)

        combined_text = " ".join(text_parts)

        max_retries = 5
        for attempt in range(max_retries):
            try:
                result = genai.embed_content(
                    model="models/text-embedding-004",
                    content=combined_text,
                    task_type="retrieval_document"
                )
                return result['embedding']

            except Exception as e:
                error_str = str(e)
                self.failed_requests += 1

                if "429" in error_str or "quota" in error_str.lower():
                    # Exponential backoff with longer waits
                    wait_time = min(2 ** (attempt + 3), 120)  # 8, 16, 32, 64, 120 seconds
                    print(f"⚠️ Rate limit hit, waiting {wait_time}s before retry {attempt + 2}/{max_retries}...")
                    time.sleep(wait_time)
                    continue

                # For other errors, shorter retry
                if attempt < max_retries - 1:
                    wait_time = 2 ** attempt  # 1, 2, 4, 8 seconds
                    print(f"⚠️ Error generating embedding, waiting {wait_time}s before retry...")
                    time.sleep(wait_time)
                    continue

                print(f"❌ Failed to generate embedding after {max_retries} attempts: {e}")
                return None

        return None

    def generate_batch_embeddings(self, items: List[Dict[str, str]]) -> List[Tuple[Dict[str, str], Optional[List[float]]]]:
        """Generate embeddings for a batch of items with rate limiting"""
        results = []

        print(f"📊 Generating embeddings for {len(items)} items with rate limiting...")
        print(f"   Max requests per minute: {self.max_rpm}")

        for i, item in enumerate(items, 1):
            embedding = self.generate_event_embedding(
                event_name=item.get('event_name', ''),
                event_description=item.get('event_description', ''),
                location=item.get('location', '')
            )

            results.append((item, embedding))

            # Progress update every 10 items
            if i % 10 == 0:
                success_rate = ((i - self.failed_requests) / i) * 100 if i > 0 else 0
                print(f"   Progress: {i}/{len(items)} embeddings generated (success rate: {success_rate:.1f}%)")

        # Final stats
        total = len(items)
        successful = sum(1 for _, emb in results if emb is not None)
        print(f"✅ Embedding generation complete: {successful}/{total} successful")

        return results

    def get_stats(self) -> Dict[str, any]:
        """Get current stats"""
        with self.lock:
            now = time.time()
            recent_requests = sum(1 for t in self.request_times if t > now - 60)

            return {
                'total_requests': self.total_requests,
                'failed_requests': self.failed_requests,
                'success_rate': ((self.total_requests - self.failed_requests) / self.total_requests * 100) if self.total_requests > 0 else 0,
                'recent_requests_per_minute': recent_requests,
                'rate_limit_utilization': (recent_requests / self.max_rpm * 100) if self.max_rpm > 0 else 0
            }

# Global instance for reuse across batches
_embedding_manager = None

def get_embedding_manager(max_rpm: int = 60) -> EmbeddingManager:
    """Get or create the global embedding manager"""
    global _embedding_manager
    if _embedding_manager is None:
        _embedding_manager = EmbeddingManager(max_rpm)
    return _embedding_manager