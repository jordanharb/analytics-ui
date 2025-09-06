import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { analyticsClient } from '../../api/analyticsClient';
import type { EventSummary, EventDetails } from '../../api/types';

interface EventCardProps {
  event: EventSummary;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const EventCard: React.FC<EventCardProps> = ({ event, isExpanded, onToggleExpand }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = async () => {
    if (details || loadingDetails) return;
    
    setLoadingDetails(true);
    setError(null);
    
    try {
      const data = await analyticsClient.getEventDetails(event.id);
      setDetails(data);
    } catch (err: any) {
      setError('Failed to load details');
      console.error('Error loading event details:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleToggleExpand = () => {
    if (!isExpanded && !details) {
      loadDetails();
    }
    onToggleExpand();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="card card-interactive overflow-hidden">
      {/* Summary Card */}
      <div 
        className="p-3 md:p-4 cursor-pointer touch-manipulation"
        onClick={handleToggleExpand}
        style={{ minHeight: '48px' }}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 line-clamp-2 text-sm md:text-base">
              {event.name}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center text-xs text-gray-500 gap-2">
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatDate(event.date)}
              </span>
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">{event.city}, {event.state}</span>
              </span>
              {event.confidence_score !== undefined && (
                <span className={`flex items-center font-medium ${
                  event.confidence_score >= 0.8 ? 'text-green-600' :
                  event.confidence_score >= 0.6 ? 'text-yellow-600' :
                  'text-red-600'
                }`}>
                  <svg className="w-4 h-4 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H6a2 2 0 100 4h2a2 2 0 100-4h-.5a1 1 0 000-2H8a2 2 0 012 2v10a2 2 0 11-4 0V5z" clipRule="evenodd" />
                  </svg>
                  <span>{Math.round(event.confidence_score * 100)}%</span>
                </span>
              )}
            </div>
            
            {/* Tags */}
            {event.tags && event.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {event.tags.slice(0, 3).map((tag, index) => (
                  <button
                    key={index}
                    className="badge badge-primary hover:bg-azure-lighter transition-colors cursor-pointer touch-manipulation text-xs"
                    style={{ minHeight: '24px', padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Use the full tag format (parent:slug) for navigation
                      // URL encode it to handle the colon
                      // Pass current location as state so we can return to it
                      navigate(`/entity/tag/${encodeURIComponent(tag)}`, { 
                        state: { from: location.pathname + location.search }
                      });
                    }}
                  >
                    {tag.split(':').pop()}
                  </button>
                ))}
                {event.tags.length > 3 && (
                  <span className="badge badge-neutral text-xs" style={{ minHeight: '24px', padding: '2px 6px' }}>
                    +{event.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
          
          <div className="ml-2 md:ml-3 flex-shrink-0 flex items-center justify-center" style={{ minHeight: '32px' }}>
            <svg
              className={`w-4 h-4 md:w-5 md:h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-100 bg-snow-150">
          {loadingDetails ? (
            <div className="p-3 md:p-4">
              <div className="space-y-3">
                <div className="skeleton h-4 rounded w-3/4"></div>
                <div className="skeleton h-3 rounded w-full"></div>
                <div className="skeleton h-3 rounded w-full"></div>
              </div>
            </div>
          ) : error ? (
            <div className="p-3 md:p-4">
              <p className="text-xs md:text-sm text-danger-500">{error}</p>
            </div>
          ) : details ? (
            <div className="p-3 md:p-4 space-y-3">
              {/* Description */}
              {details.description && (
                <div>
                  <h4 className="text-xs md:text-sm font-medium text-gray-700 mb-1">Description</h4>
                  <p className="text-xs md:text-sm text-gray-600">{details.description}</p>
                </div>
              )}

              {/* AI Justification */}
              {details.ai_justification && (
                <div>
                  <h4 className="text-xs md:text-sm font-medium text-gray-700 mb-1">AI Analysis</h4>
                  <p className="text-xs md:text-sm text-gray-600 italic">{details.ai_justification}</p>
                </div>
              )}

              {/* Actors */}
              {details.actors && details.actors.length > 0 && (
                <div>
                  <h4 className="text-xs md:text-sm font-medium text-gray-700 mb-2">Related Actors</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {details.actors.map(actor => (
                      <button
                        key={actor.id}
                        className="chip hover:bg-violet-100 bg-violet-100 text-violet-500 border-violet-500 touch-manipulation text-xs"
                        style={{ minHeight: '28px', padding: '4px 8px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/entity/actor/${actor.id}`, {
                            state: { from: location.pathname + location.search }
                          });
                        }}
                      >
                        <svg className="w-2.5 h-2.5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                        </svg>
                        {actor.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Social Media Posts */}
              {details.posts && details.posts.length > 0 && (
                <div>
                  <h4 className="text-xs md:text-sm font-medium text-gray-700 mb-2">
                    Source Posts ({details.posts.length})
                  </h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {details.posts.map(post => (
                      <div
                        key={post.id}
                        className="card p-2 md:p-3 bg-white"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                              <span className="font-medium">{post.platform}</span>
                              <span>•</span>
                              <span>@{post.author_handle}</span>
                            </div>
                            {post.content && (
                              <p className="mt-1 text-sm text-gray-700 line-clamp-3">
                                {post.content}
                              </p>
                            )}
                            {post.offline_image_url && (
                              <img
                                src={post.offline_image_url}
                                alt="Post content"
                                className="mt-2 rounded max-h-32 object-cover"
                              />
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                              {post.like_count !== undefined && (
                                <span>❤️ {post.like_count}</span>
                              )}
                              {post.reply_count !== undefined && (
                                <span>💬 {post.reply_count}</span>
                              )}
                              {post.retweet_count !== undefined && (
                                <span>🔄 {post.retweet_count}</span>
                              )}
                            </div>
                          </div>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-link"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All Tags */}
              {details.tags && details.tags.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-1">All Tags</h4>
                  <div className="flex flex-wrap" style={{ gap: '0.25rem' }}>
                    {details.tags.map((tag, index) => (
                      <button
                        key={index}
                        className="badge badge-primary hover:bg-azure-lighter transition-colors cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Use the full tag format (parent:slug) for navigation
                          // URL encode it to handle the colon
                          // Pass current location as state so we can return to it
                          navigate(`/entity/tag/${encodeURIComponent(tag)}`, {
                            state: { from: location.pathname + location.search }
                          });
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};