import React from 'react';

interface SocialProfileProps {
  platform: 'x' | 'instagram' | 'truth_social';
  username: string;
  url?: string;
  bio?: string;
  followers?: number;
  verified?: boolean;
  profile_image?: string;
}

const platformConfig = {
  x: {
    name: 'X (Twitter)',
    color: 'bg-black text-white',
    icon: '𝕏',
    borderColor: 'border-gray-800'
  },
  instagram: {
    name: 'Instagram',
    color: 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 text-white',
    icon: '📷',
    borderColor: 'border-pink-300'
  },
  truth_social: {
    name: 'Truth Social',
    color: 'bg-red-600 text-white',
    icon: '🇺🇸',
    borderColor: 'border-red-400'
  }
};

export const SocialProfile: React.FC<SocialProfileProps> = ({
  platform,
  username,
  url,
  bio,
  followers,
  verified,
  profile_image
}) => {
  const config = platformConfig[platform];
  
  const formatFollowerCount = (count?: number) => {
    if (!count) return null;
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toLocaleString();
  };

  return (
    <div className={`border rounded-lg p-4 ${config.borderColor} bg-white hover:shadow-md transition-shadow`}>
      {/* Header with platform and username */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-3">
          {profile_image ? (
            <img
              src={profile_image}
              alt={`${username} profile`}
              className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-xl">
              {config.icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h4 className="font-semibold text-gray-900 truncate">
                @{username}
              </h4>
              {verified && (
                <span className="text-blue-500 text-sm" title="Verified Account">
                  ✓
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.color}`}>
                {config.name}
              </span>
              {followers !== undefined && (
                <span className="text-sm text-gray-500">
                  {formatFollowerCount(followers)} followers
                </span>
              )}
            </div>
          </div>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            View Profile →
          </a>
        )}
      </div>

      {/* Bio */}
      {bio && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-sm text-gray-700 leading-relaxed">
            {bio}
          </p>
        </div>
      )}
    </div>
  );
};