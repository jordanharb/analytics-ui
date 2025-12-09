import React, { useState, useEffect, useCallback } from 'react';
import { SocialPostCard, type SocialPost } from '../SocialPostCard/SocialPostCard';

interface ActorPostsListProps {
  actorNames: string[];
  startDate: string;
  endDate: string;
}

interface ActorPostsResponse {
  posts: Array<SocialPost & { matched_actor?: string }>;
  total_count: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export const ActorPostsList: React.FC<ActorPostsListProps> = ({
  actorNames,
  startDate,
  endDate
}) => {
  const [posts, setPosts] = useState<Array<SocialPost & { matched_actor?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const fetchPosts = useCallback(async (isInitial: boolean) => {
    if (actorNames.length === 0) {
      setPosts([]);
      setTotalCount(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const currentOffset = isInitial ? 0 : offset;

      const response = await fetch('/api/email-reports/actor-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorNames,
          startDate,
          endDate,
          limit: 20,
          offset: currentOffset
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch actor posts');
      }

      const data: ActorPostsResponse = await response.json();

      if (isInitial) {
        setPosts(data.posts);
        setOffset(data.posts.length);
      } else {
        setPosts(prev => [...prev, ...data.posts]);
        setOffset(prev => prev + data.posts.length);
      }

      setTotalCount(data.total_count);
      setHasMore(data.has_more);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [actorNames, startDate, endDate, offset]);

  // Reset and fetch when actors change
  useEffect(() => {
    setPosts([]);
    setOffset(0);
    setHasMore(false);
    fetchPosts(true);
  }, [actorNames.join(','), startDate, endDate]);

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchPosts(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (posts.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-gray-600">
        No posts found for the selected actors in this time period.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Posts count header */}
      <div className="text-sm text-gray-600">
        Showing {posts.length} of {totalCount} posts from {actorNames.length} actor{actorNames.length !== 1 ? 's' : ''}
      </div>

      {/* Posts list */}
      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
        {posts.map((post) => (
          <div key={post.id}>
            {post.matched_actor && (
              <div className="text-xs text-gray-500 mb-1 font-medium">
                {post.matched_actor}
              </div>
            )}
            <SocialPostCard post={post} compact />
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-center py-4">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        )}

        {/* Load more button */}
        {hasMore && !loading && (
          <div className="text-center pt-2">
            <button
              onClick={loadMore}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
            >
              Load more posts ({totalCount - posts.length} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActorPostsList;
