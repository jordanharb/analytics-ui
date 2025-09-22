'use client';

import { useState, useEffect } from 'react';
import { supabase2 as supabase } from '../lib/supabase2';

interface Bill {
  bill_id: number;
  session_id: number;
  bill_number: string;
  short_title: string;
  description: string;
  primary_sponsor_name: string;
  date_introduced: string;
  final_disposition: string;
  governor_action: string;
  last_action_date: string | null;
  sponsors?: Array<{
    legislator_id: number;
    full_name: string;
    party: string;
    sponsor_type: string;
    display_order: number;
  }>;
  votes?: Array<{
    vote_date: string;
    body: string;
    vote_result: string;
    yeas: number;
    nays: number;
  }>;
}

interface Session {
  session_id: number;
  session_name: string;
  legislature_number?: number;
  session_type?: string;
  year?: number;
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDisposition, setFilterDisposition] = useState('all');
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [billDetails, setBillDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      loadBills();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      const { data: sessionsData, error } = await supabase
        .from('sessions')
        .select('session_id, session_name, legislature_number, session_type, year')
        .order('session_id', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error loading sessions:', error);
        // Fallback to mock data if table doesn't exist
        const mockSessions = [
          { session_id: 56, session_name: '56th Legislature - 1st Regular Session (2023)' },
          { session_id: 55, session_name: '55th Legislature - 2nd Regular Session (2022)' },
          { session_id: 54, session_name: '55th Legislature - 1st Regular Session (2021)' },
        ];
        setSessions(mockSessions);
        setSelectedSession(mockSessions[0].session_id);
      } else {
        setSessions(sessionsData || []);
        if (sessionsData && sessionsData.length > 0) {
          setSelectedSession(sessionsData[0].session_id);
        }
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const loadBills = async () => {
    if (!selectedSession) return;

    setLoading(true);

    try {
      // Use RPC function to get bills with all details
      const { data: billsData, error } = await supabase
        .rpc('get_bills_with_details', {
          p_session_id: selectedSession,
          p_search_term: searchTerm || null,
          p_limit: 100,
          p_offset: 0
        });

      if (error) {
        console.error('Error loading bills:', error);
        setBills([]);
      } else {
        // Process the bills data
        const processedBills = (billsData || []).map((bill: any) => ({
          ...bill,
          // Parse sponsors JSON if it's a string
          sponsors: typeof bill.sponsors === 'string'
            ? JSON.parse(bill.sponsors)
            : bill.sponsors,
          // Ensure primary_sponsor_name has a fallback
          primary_sponsor_name: bill.primary_sponsor_name || 'Unknown'
        }));
        setBills(processedBills);
      }
    } catch (error) {
      console.error('Error loading bills:', error);
      setBills([]);
    }

    setLoading(false);
  };

  const loadBillDetails = async (billId: number) => {
    setLoadingDetails(true);
    setBillDetails(null);

    try {
      // For now, we'll just use the selected bill data
      // TODO: Create API endpoints for sponsors and votes
      setBillDetails({
        bill_id: billId,
        sponsors: [],
        votes: []
      });
    } catch (error) {
      console.error('Error loading bill details:', error);
    }

    setLoadingDetails(false);
  };

  const handleBillClick = async (bill: Bill) => {
    setSelectedBill(bill);
    await loadBillDetails(bill.bill_id);
  };

  const filteredBills = bills.filter(bill => {
    if (searchTerm && !bill.bill_number.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !bill.short_title?.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !bill.primary_sponsor_name?.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    return true;
  });

  const currentSession = sessions.find(s => s.session_id === selectedSession);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '0.5rem',
          color: '#1f2937',
        }}>
          Legislative Bills
        </h1>
        <p style={{
          fontSize: '1rem',
          color: '#6b7280',
          marginBottom: '1.5rem',
        }}>
          Browse bills, votes, and sponsorships from the Arizona Legislature
        </p>
      </div>

      {/* Filters */}
      <div style={{
        backgroundColor: '#f9fafb',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        marginBottom: '1.5rem',
        border: '1px solid #e5e7eb',
      }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ minWidth: '200px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '0.5rem',
            }}>
              Legislative Session
            </label>
            <select
              value={selectedSession || ''}
              onChange={(e) => setSelectedSession(Number(e.target.value))}
              style={{
                padding: '0.5rem',
                fontSize: '0.9rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                backgroundColor: 'white',
                width: '100%',
              }}
            >
              {sessions.map(session => (
                <option key={session.session_id} value={session.session_id}>
                  {session.session_name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: '250px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '0.5rem',
            }}>
              Search Bills
            </label>
            <input
              type="text"
              placeholder="Search by bill number, title, or sponsor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                fontSize: '0.9rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                backgroundColor: 'white',
              }}
            />
          </div>

          <div style={{ minWidth: '150px' }}>
            <label style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '0.5rem',
            }}>
              Status
            </label>
            <select
              value={filterDisposition}
              onChange={(e) => setFilterDisposition(e.target.value)}
              style={{
                padding: '0.5rem',
                fontSize: '0.9rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.375rem',
                backgroundColor: 'white',
                width: '100%',
              }}
            >
              <option value="all">All Bills</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <button
            onClick={loadBills}
            disabled={loading}
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '0.9rem',
              fontWeight: '500',
              color: 'white',
              backgroundColor: loading ? '#9ca3af' : '#3b82f6',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Search'}
          </button>
        </div>

        {currentSession && (
          <div style={{
            marginTop: '1rem',
            fontSize: '0.875rem',
            color: '#6b7280',
          }}>
            Showing bills from {currentSession.session_name} ({filteredBills.length} results)
          </div>
        )}
      </div>

      {/* Bills List */}
      <div style={{ display: 'flex', gap: '1.5rem' }}>
        <div style={{ flex: 1 }}>
          {loading ? (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: '#6b7280',
            }}>
              Loading bills...
            </div>
          ) : filteredBills.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              backgroundColor: '#f9fafb',
              borderRadius: '0.5rem',
              color: '#6b7280',
            }}>
              No bills found matching your criteria
            </div>
          ) : (
            <div style={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              overflow: 'hidden',
            }}>
              {filteredBills.map((bill) => (
                <div
                  key={bill.bill_id}
                  onClick={() => handleBillClick(bill)}
                  style={{
                    padding: '1rem',
                    borderBottom: '1px solid #f3f4f6',
                    cursor: 'pointer',
                    backgroundColor: selectedBill?.bill_id === bill.bill_id ? '#eff6ff' : 'white',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedBill?.bill_id !== bill.bill_id) {
                      e.currentTarget.style.backgroundColor = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedBill?.bill_id !== bill.bill_id) {
                      e.currentTarget.style.backgroundColor = 'white';
                    }
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'start',
                    marginBottom: '0.5rem',
                  }}>
                    <div>
                      <span style={{
                        fontWeight: '600',
                        color: '#1f2937',
                        fontSize: '1rem',
                      }}>
                        {bill.bill_number}
                      </span>
                      {bill.final_disposition && (
                        <span style={{
                          marginLeft: '0.75rem',
                          fontSize: '0.75rem',
                          padding: '0.125rem 0.5rem',
                          borderRadius: '0.25rem',
                          backgroundColor: bill.final_disposition.toLowerCase().includes('passed') || 
                                         bill.final_disposition.toLowerCase().includes('enacted') ? '#dcfce7' : '#fee2e2',
                          color: bill.final_disposition.toLowerCase().includes('passed') || 
                                bill.final_disposition.toLowerCase().includes('enacted') ? '#166534' : '#991b1b',
                        }}>
                          {bill.final_disposition}
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#9ca3af',
                      textAlign: 'right'
                    }}>
                      {bill.last_action_date ? (
                        <div>
                          Last action: {new Date(bill.last_action_date).toLocaleDateString()}
                        </div>
                      ) : (
                        <div>No action yet</div>
                      )}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: '#374151',
                    marginBottom: '0.25rem',
                  }}>
                    {bill.short_title || 'No title available'}
                  </div>
                  <div style={{
                    fontSize: '0.875rem',
                    color: '#6b7280',
                  }}>
                    Sponsor: {bill.primary_sponsor_name || 'Unknown'}
                    {bill.sponsors && bill.sponsors.length > 1 && (
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                        (+{bill.sponsors.length - 1} co-sponsors)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bill Details Panel */}
        {selectedBill && (
          <div style={{
            width: '400px',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            padding: '1.5rem',
            height: 'fit-content',
            position: 'sticky',
            top: '1rem',
          }}>
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: '600',
              marginBottom: '1rem',
              color: '#1f2937',
            }}>
              {selectedBill.bill_number}
            </h2>

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#6b7280',
                marginBottom: '0.5rem',
              }}>
                Title
              </h3>
              <p style={{
                fontSize: '0.9rem',
                color: '#374151',
                lineHeight: '1.5',
              }}>
                {selectedBill.short_title || 'No title available'}
              </p>
            </div>

            {selectedBill.description && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#6b7280',
                  marginBottom: '0.5rem',
                }}>
                  Description
                </h3>
                <p style={{
                  fontSize: '0.875rem',
                  color: '#374151',
                  lineHeight: '1.5',
                }}>
                  {selectedBill.description}
                </p>
              </div>
            )}

            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#6b7280',
                marginBottom: '0.5rem',
              }}>
                Sponsors
              </h3>
              {selectedBill.sponsors && selectedBill.sponsors.length > 0 ? (
                <div style={{ fontSize: '0.875rem' }}>
                  {selectedBill.sponsors.map((sponsor, idx) => (
                    <div key={idx} style={{ marginBottom: '0.25rem', color: '#374151' }}>
                      <span style={{ fontWeight: sponsor.sponsor_type === 'P' ? '600' : '400' }}>
                        {sponsor.full_name}
                      </span>
                      {sponsor.party && (
                        <span style={{ marginLeft: '0.5rem', color: '#6b7280', fontSize: '0.75rem' }}>
                          ({sponsor.party})
                        </span>
                      )}
                      {sponsor.sponsor_type === 'P' && (
                        <span style={{
                          marginLeft: '0.5rem',
                          padding: '0 0.25rem',
                          backgroundColor: '#dbeafe',
                          color: '#1e40af',
                          borderRadius: '0.125rem',
                          fontSize: '0.625rem',
                          fontWeight: '600'
                        }}>
                          PRIMARY
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{
                  fontSize: '0.9rem',
                  color: '#374151',
                }}>
                  {selectedBill.primary_sponsor_name || 'Unknown'}
                </p>
              )}
            </div>

            {selectedBill.last_action_date && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#6b7280',
                  marginBottom: '0.5rem',
                }}>
                  Last Action
                </h3>
                <p style={{
                  fontSize: '0.9rem',
                  color: '#374151',
                }}>
                  {new Date(selectedBill.last_action_date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>
            )}

            {selectedBill.governor_action && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#6b7280',
                  marginBottom: '0.5rem',
                }}>
                  Governor Action
                </h3>
                <p style={{
                  fontSize: '0.9rem',
                  color: '#374151',
                }}>
                  {selectedBill.governor_action}
                </p>
              </div>
            )}

            {loadingDetails ? (
              <div style={{
                textAlign: 'center',
                padding: '1rem',
                color: '#6b7280',
              }}>
                Loading details...
              </div>
            ) : billDetails && (
              <>
                {billDetails.sponsors && billDetails.sponsors.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: '#6b7280',
                      marginBottom: '0.5rem',
                    }}>
                      Co-Sponsors ({billDetails.sponsors.length})
                    </h3>
                    <div style={{
                      fontSize: '0.875rem',
                      color: '#374151',
                    }}>
                      {billDetails.sponsors.map((sponsor: any, idx: number) => (
                        <div key={idx} style={{ marginBottom: '0.25rem' }}>
                          • {sponsor.legislator_name}
                          {sponsor.sponsor_type !== 'P' && ` (${sponsor.sponsor_type})`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {billDetails.votes && billDetails.votes.length > 0 && (
                  <div>
                    <h3 style={{
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      color: '#6b7280',
                      marginBottom: '0.5rem',
                    }}>
                      Votes ({billDetails.votes.length})
                    </h3>
                    {billDetails.votes.map((vote: any, idx: number) => (
                      <div key={idx} style={{
                        marginBottom: '0.75rem',
                        padding: '0.5rem',
                        backgroundColor: '#f9fafb',
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                      }}>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: '0.25rem',
                        }}>
                          <span style={{ fontWeight: '500' }}>
                            {vote.body === 'H' ? 'House' : 'Senate'}
                          </span>
                          <span style={{ color: '#6b7280' }}>
                            {new Date(vote.vote_date).toLocaleDateString()}
                          </span>
                        </div>
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: vote.vote_result === 'Passed' ? '#059669' : '#dc2626',
                        }}>
                          <span>{vote.vote_result}</span>
                          <span>Y: {vote.yeas} / N: {vote.nays}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
