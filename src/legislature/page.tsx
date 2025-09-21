import { callRpc } from '@/lib/rest';
import { SearchResult } from '@/lib/types';
import { APP_CONFIG, ERROR_MESSAGES } from '@/lib/constants';

interface SearchPageProps {
  searchParams: { q?: string };
}

async function searchEntities(query: string | undefined): Promise<SearchResult[]> {
  try {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const results = await callRpc<SearchResult[]>('search_entities', {
      q: query.trim(),
      lim: APP_CONFIG.DEFAULT_SEARCH_LIMIT,
      off: APP_CONFIG.DEFAULT_OFFSET,
    });

    return results || [];
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (!amount || amount === 0) return '$0';
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '—';
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const query = searchParams.q;
  const results = await searchEntities(query);
  
  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '0.5rem',
          color: '#1f2937',
        }}>
          Search Campaign Finance Data
        </h1>
        <p style={{
          fontSize: '1rem',
          color: '#6b7280',
          marginBottom: '1.5rem',
          maxWidth: '600px',
        }}>
          Search for candidates, committees, and PACs to view their campaign finance reports and transactions.
        </p>
      </div>

      {/* Search Form */}
      <form 
        action="/" 
        method="get" 
        style={{
          marginBottom: '2rem',
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1', minWidth: '300px' }}>
          <input 
            name="q" 
            defaultValue={query || ''} 
            placeholder="Search by candidate name, committee name, or keyword..."
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '2px solid #d1d5db',
              borderRadius: '0.5rem',
              outline: 'none',
              transition: 'border-color 0.2s ease',
            }}
          />
        </div>
        <button 
          type="submit"
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'white',
            backgroundColor: '#0066cc',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'background-color 0.2s ease',
            whiteSpace: 'nowrap',
          }}
        >
          Search
        </button>
      </form>

      {/* Results */}
      {query && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{
            fontSize: '0.9rem',
            color: '#6b7280',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}>
            <span>
              {results.length > 0 
                ? `Showing ${results.length} results for "${query}"` 
                : `No results found for "${query}"`
              }
            </span>
            {results.length === APP_CONFIG.DEFAULT_SEARCH_LIMIT && (
              <span style={{ fontStyle: 'italic' }}>
                Showing first {APP_CONFIG.DEFAULT_SEARCH_LIMIT} results
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 ? (
        <div style={{
          border: '1px solid #e5e5e5',
          borderRadius: '0.5rem',
          overflow: 'hidden',
          backgroundColor: 'white',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9rem',
            }}>
              <thead>
                <tr style={{
                  backgroundColor: '#f9fafb',
                  borderBottom: '1px solid #e5e5e5',
                }}>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '200px',
                  }}>
                    Name
                  </th>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '100px',
                  }}>
                    Party
                  </th>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '120px',
                  }}>
                    Office
                  </th>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'left',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '110px',
                  }}>
                    Last Activity
                  </th>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'right',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '140px',
                  }}>
                    Income / Expense
                  </th>
                  <th style={{
                    padding: '1rem 0.75rem',
                    textAlign: 'center',
                    fontWeight: '600',
                    color: '#374151',
                    minWidth: '80px',
                  }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr 
                    key={result.entity_id} 
                    style={{
                      borderBottom: '1px solid #f0f0f0',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{
                      padding: '1rem 0.75rem',
                      fontWeight: '500',
                      color: '#1f2937',
                    }}>
                      {result.name}
                    </td>
                    <td style={{
                      padding: '1rem 0.75rem',
                      color: '#4b5563',
                    }}>
                      {result.party_name || '—'}
                    </td>
                    <td style={{
                      padding: '1rem 0.75rem',
                      color: '#4b5563',
                    }}>
                      {result.office_name || '—'}
                    </td>
                    <td style={{
                      padding: '1rem 0.75rem',
                      color: '#4b5563',
                    }}>
                      {formatDate(result.latest_activity)}
                    </td>
                    <td style={{
                      padding: '1rem 0.75rem',
                      textAlign: 'right',
                      fontFamily: 'ui-monospace, Monaco, Consolas, monospace',
                      fontSize: '0.85rem',
                      color: '#4b5563',
                    }}>
                      <div>{formatCurrency(result.total_income)}</div>
                      <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                        {formatCurrency(result.total_expense)}
                      </div>
                    </td>
                    <td style={{
                      padding: '1rem 0.75rem',
                      textAlign: 'center',
                    }}>
                      <a 
                        href={`/candidate/${result.entity_id}`}
                        style={{
                          display: 'inline-block',
                          padding: '0.4rem 0.8rem',
                          fontSize: '0.85rem',
                          fontWeight: '500',
                          color: '#0066cc',
                          backgroundColor: '#eff6ff',
                          border: '1px solid #bfdbfe',
                          borderRadius: '0.375rem',
                          textDecoration: 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        View →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : query && (
        // Empty state
        <div style={{
          textAlign: 'center',
          padding: '3rem 1rem',
          border: '1px solid #e5e5e5',
          borderRadius: '0.5rem',
          backgroundColor: '#fafbfc',
        }}>
          <div style={{
            fontSize: '2rem',
            marginBottom: '1rem',
            filter: 'grayscale(1)',
          }}>
            🔍
          </div>
          <h3 style={{
            fontSize: '1.1rem',
            fontWeight: '600',
            color: '#374151',
            marginBottom: '0.5rem',
          }}>
            No results found
          </h3>
          <p style={{
            color: '#6b7280',
            fontSize: '0.9rem',
            maxWidth: '400px',
            margin: '0 auto',
          }}>
            Try searching for a candidate name, committee name, or use broader terms.
          </p>
        </div>
      )}

      {/* Help text for new users */}
      {!query && (
        <div style={{
          marginTop: '3rem',
          padding: '2rem',
          backgroundColor: '#f0f9ff',
          border: '1px solid #e0f2fe',
          borderRadius: '0.5rem',
        }}>
          <h3 style={{
            fontSize: '1.1rem',
            fontWeight: '600',
            color: '#0c4a6e',
            marginBottom: '1rem',
          }}>
            How to search
          </h3>
          <ul style={{
            color: '#155e75',
            fontSize: '0.9rem',
            margin: 0,
            paddingLeft: '1.5rem',
            lineHeight: '1.6',
          }}>
            <li style={{ marginBottom: '0.5rem' }}>
              Search by candidate name: "Katie Hobbs", "Kari Lake"
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              Search by office: "Governor", "Senate", "House"
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              Search by committee name or abbreviation
            </li>
            <li>
              Use partial names - the search will find similar matches
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}