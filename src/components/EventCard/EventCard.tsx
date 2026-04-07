import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { analyticsClient } from '../../api/analyticsClient';
import type { EventSummary, EventDetails } from '../../api/types';

interface EventCardProps {
  event: EventSummary;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

// fieldnotes palette
// cream surface  #fdfaf2   (cards)
// page bg        #f6f1e6
// ink            #1a1a1a
// ink-muted      #6b6b6b
// accent         #c2410c   (burnt orange)
// accent text    #9a330a   (on cream)
// tag fill       #fdf2ed   (Coral 50-ish, matches palantir tokens)
// tag border     rgba(194,65,12,0.2)
// neutral fill   #ede5d2
// neutral text   #6b6b6b

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
    return date
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      .toLowerCase();
  };

  // confidence color: high = burnt orange (it's the thing you trust),
  // mid = ink-muted, low = ink-faint. no green/yellow/red noise.
  const confidenceClass =
    event.confidence_score === undefined
      ? ''
      : event.confidence_score >= 0.8
      ? 'text-[#c2410c]'
      : event.confidence_score >= 0.6
      ? 'text-[#6b6b6b]'
      : 'text-[#9a9a9a]';

  return (
    <div
      className="overflow-hidden w-full bg-[#fdfaf2] border border-black/[0.1] rounded-md transition-colors hover:border-black/20"
      style={{
        maxWidth: '100%',
        borderLeft: isExpanded ? '2px solid #c2410c' : '1px solid rgba(0,0,0,0.1)',
        borderRadius: isExpanded ? '0 6px 6px 0' : '6px',
      }}
    >
      {/* Summary */}
      <div
        className="p-3 md:p-4 cursor-pointer touch-manipulation"
        onClick={handleToggleExpand}
        style={{ minHeight: '48px' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 overflow-hidden">
            <h3 className="font-medium text-[#1a1a1a] line-clamp-2 text-sm md:text-[15px] leading-snug">
              {event.name}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center text-[11px] md:text-xs text-[#6b6b6b] gap-x-3 gap-y-1">
              <span className="inline-flex items-center">
                <svg className="w-3 h-3 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{formatDate(event.date)}</span>
              </span>
              <span className="inline-flex items-center min-w-0">
                <svg className="w-3 h-3 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="truncate">
                  {event.city ? `${event.city}, ${event.state}` : `${event.state} · statewide`}
                </span>
              </span>
              {event.confidence_score !== undefined && (
                <span className={`inline-flex items-center font-medium ${confidenceClass}`}>
                  <span className="mr-1" aria-hidden>●</span>
                  <span>{Math.round(event.confidence_score * 100)}% confidence</span>
                </span>
              )}
            </div>

            {/* Tags */}
            {event.tags && event.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {event.tags.slice(0, 3).map((tag, index) => (
                  <button
                    key={index}
                    className="bg-[#fdf2ed] text-[#9a330a] hover:bg-[#fce5d8] transition-colors cursor-pointer touch-manipulation text-[10px] md:text-xs"
                    style={{
                      minHeight: '22px',
                      padding: '2px 8px',
                      borderRadius: '11px',
                      border: '0.5px solid rgba(194,65,12,0.2)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/entity/tag/${encodeURIComponent(tag)}`, {
                        state: { from: location.pathname + location.search },
                      });
                    }}
                  >
                    {tag.split(':').pop()}
                  </button>
                ))}
                {event.tags.length > 3 && (
                  <span
                    className="text-[10px] md:text-xs text-[#6b6b6b] bg-[#ede5d2]"
                    style={{ minHeight: '22px', padding: '2px 8px', borderRadius: '11px', display: 'inline-flex', alignItems: 'center' }}
                  >
                    +{event.tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="ml-2 md:ml-3 flex-shrink-0 flex items-center justify-center" style={{ minHeight: '32px' }}>
            <svg
              className={`w-4 h-4 md:w-5 md:h-5 text-[#9a9a9a] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-black/[0.08] bg-[#f6f1e6]">
          {loadingDetails ? (
            <div className="p-3 md:p-4">
              <div className="space-y-3">
                <div className="h-4 rounded w-3/4 bg-[#ede5d2] animate-pulse"></div>
                <div className="h-3 rounded w-full bg-[#ede5d2] animate-pulse"></div>
                <div className="h-3 rounded w-full bg-[#ede5d2] animate-pulse"></div>
              </div>
            </div>
          ) : error ? (
            <div className="p-3 md:p-4">
              <p className="text-xs md:text-sm text-[#9a330a]">{error}</p>
            </div>
          ) : details ? (
            <div className="p-3 md:p-4 space-y-4">
              {/* Description */}
              {details.description && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-1">description</h4>
                  <p className="text-xs md:text-sm text-[#2a2a2a] leading-relaxed">{details.description}</p>
                </div>
              )}

              {/* AI Justification */}
              {details.ai_justification && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-1">why we flagged it</h4>
                  <p className="text-xs md:text-sm text-[#2a2a2a] italic leading-relaxed">
                    {details.ai_justification}
                  </p>
                </div>
              )}

              {/* Actors */}
              {details.actors && details.actors.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">related actors</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {details.actors.map((actor) => (
                      <button
                        key={actor.id}
                        className="bg-[#fdfaf2] text-[#1a1a1a] hover:bg-[#ede5d2] transition-colors touch-manipulation text-xs"
                        style={{
                          minHeight: '26px',
                          padding: '4px 10px',
                          borderRadius: '13px',
                          border: '0.5px solid rgba(0,0,0,0.12)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/entity/actor/${actor.id}`, {
                            state: { from: location.pathname + location.search },
                          });
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: '#c2410c',
                            color: '#fdfaf2',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            fontWeight: 500,
                          }}
                        >
                          {actor.name?.[0]?.toUpperCase() ?? '?'}
                        </span>
                        {actor.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Source posts */}
              {details.posts && details.posts.length > 0 && (
                <div>
                  <h4 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">
                    source posts ({details.posts.length})
                  </h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {details.posts.map((post) => (
                      <div
                        key={post.id}
                        className="p-2 md:p-3 bg-[#fdfaf2] border border-black/[0.08] rounded-md"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#6b6b6b]">
                              <span className="font-medium text-[#2a2a2a]">{post.platform}</span>
                              <span>·</span>
                              <span>@{post.author_handle}</span>
                            </div>
                            {post.content && (
                              <p className="mt-1 text-sm text-[#2a2a2a] line-clamp-3">{post.content}</p>
                            )}
                            {post.offline_image_url && (
                              <img
                                src={post.offline_image_url}
                                alt=""
                                className="mt-2 rounded max-h-32 object-cover"
                              />
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#6b6b6b]">
                              {post.like_count !== undefined && <span>{post.like_count} likes</span>}
                              {post.reply_count !== undefined && <span>{post.reply_count} replies</span>}
                              {post.retweet_count !== undefined && <span>{post.retweet_count} reposts</span>}
                            </div>
                          </div>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 text-[#c2410c] hover:text-[#9a330a]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
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
                  <h4 className="text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-2">all tags</h4>
                  <div className="flex flex-wrap gap-1">
                    {details.tags.map((tag, index) => (
                      <button
                        key={index}
                        className="bg-[#fdf2ed] text-[#9a330a] hover:bg-[#fce5d8] transition-colors cursor-pointer text-xs"
                        style={{
                          minHeight: '22px',
                          padding: '2px 8px',
                          borderRadius: '11px',
                          border: '0.5px solid rgba(194,65,12,0.2)',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/entity/tag/${encodeURIComponent(tag)}`, {
                            state: { from: location.pathname + location.search },
                          });
                        }}
                      >
                        {tag.split(':').pop()}
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
