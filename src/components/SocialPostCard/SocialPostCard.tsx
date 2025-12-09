import React from 'react';

export interface SocialPost {
  id: string;
  display_name: string;
  author_handle?: string;
  content_text: string;
  post_timestamp: string;
  platform?: string;
}

interface SocialPostCardProps {
  post: SocialPost;
  compact?: boolean;
}

const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
};

const getPlatformIcon = (platform?: string): string => {
  switch (platform?.toLowerCase()) {
    case 'twitter':
    case 'x':
      return 'X';
    case 'instagram':
      return 'IG';
    case 'facebook':
      return 'FB';
    case 'tiktok':
      return 'TT';
    default:
      return '';
  }
};

const getPlatformColor = (platform?: string): string => {
  switch (platform?.toLowerCase()) {
    case 'twitter':
    case 'x':
      return 'bg-black text-white';
    case 'instagram':
      return 'bg-gradient-to-r from-purple-500 to-pink-500 text-white';
    case 'facebook':
      return 'bg-blue-600 text-white';
    case 'tiktok':
      return 'bg-black text-white';
    default:
      return 'bg-gray-500 text-white';
  }
};

export const SocialPostCard: React.FC<SocialPostCardProps> = ({ post, compact = false }) => {
  const platformIcon = getPlatformIcon(post.platform);
  const platformColor = getPlatformColor(post.platform);

  if (compact) {
    return (
      <div className="border-l-3 border-blue-600 pl-4 py-2 bg-gray-50 rounded-r">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-blue-700 text-sm">{post.display_name}</span>
          {post.author_handle && (
            <span className="text-gray-500 text-xs">@{post.author_handle}</span>
          )}
          {platformIcon && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${platformColor}`}>
              {platformIcon}
            </span>
          )}
        </div>
        <div className="text-gray-700 text-sm whitespace-pre-wrap line-clamp-3">
          {post.content_text}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          {formatDate(post.post_timestamp)}
        </div>
      </div>
    );
  }

  return (
    <div className="border-l-4 border-blue-600 pl-4 py-3 bg-white rounded-r shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-blue-700">{post.display_name}</span>
          {post.author_handle && (
            <span className="text-gray-500 text-sm">@{post.author_handle}</span>
          )}
        </div>
        {platformIcon && (
          <span className={`text-xs px-2 py-1 rounded font-medium ${platformColor}`}>
            {platformIcon}
          </span>
        )}
      </div>

      <div className="text-gray-700 whitespace-pre-wrap leading-relaxed mb-2">
        {post.content_text}
      </div>

      <div className="text-sm text-gray-500">
        {formatDate(post.post_timestamp)}
      </div>
    </div>
  );
};

export default SocialPostCard;
