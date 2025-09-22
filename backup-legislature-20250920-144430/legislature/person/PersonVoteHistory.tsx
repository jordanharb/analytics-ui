import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase2 } from '../../../lib/supabase2';
import { Tabs } from '../Tabs';

interface SessionInfo {
  session_id: number;
  session_name: string;
  first_vote_date: string;
  last_vote_date: string;
  vote_count: number;
  sponsored_count: number;
}

interface BillVote {
  bill_id: number;
  bill_number: string;
  short_title: string;
  latest_vote: string;
  latest_vote_date: string;
  latest_venue: string;
  has_multiple_votes: boolean;
}

interface VoteDetail {
  vote_id: number;
  vote_date: string;
  venue: string;
  venue_type: string;
  committee_name: string | null;
  vote: string;
}

interface Props {
  personId: number;
}

export const PersonVoteHistory: React.FC<Props> = ({ personId }) => {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  useEffect(() => {
    loadSessions();
  }, [personId]);

  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      // Get all legislator IDs for this person
      const { data: legData } = await supabase2
        .from('rs_person_legislators')
        .select('legislator_id')
        .eq('person_id', personId);

      if (!legData || legData.length === 0) {
        setSessions([]);
        return;
      }

      const legislatorIds = legData.map(l => l.legislator_id);

      // Get sessions with vote counts - simplified query
      const { data: voteData, error: voteError } = await supabase2
        .from('votes')
        .select('bill_id, vote_date')
        .in('legislator_id', legislatorIds);

      if (voteError) {
        console.error('Error loading votes:', voteError);
        setSessions([]);
        return;
      }

      if (!voteData || voteData.length === 0) {
        console.log('No votes found for legislator IDs:', legislatorIds);
        setSessions([]);
        return;
      }

      // Get bill session info
      const billIds = [...new Set(voteData.map(v => v.bill_id))];
      const { data: billData, error: billError } = await supabase2
        .from('bills')
        .select('bill_id, session_id')
        .in('bill_id', billIds);

      if (billError) {
        console.error('Error loading bills:', billError);
        setSessions([]);
        return;
      }

      // Get session info
      const sessionIds = [...new Set(billData?.map(b => b.session_id) || [])];
      const { data: sessionData, error: sessionError } = await supabase2
        .from('sessions')
        .select('session_id, session_name, year')
        .in('session_id', sessionIds);

      if (sessionError) {
        console.error('Error loading sessions:', sessionError);
        setSessions([]);
        return;
      }

      // Create a map of bill to session
      const billToSession = new Map<number, number>();
      billData?.forEach(b => billToSession.set(b.bill_id, b.session_id));

      // Create session info map
      const sessionInfoMap = new Map<number, any>();
      sessionData?.forEach(s => {
        sessionInfoMap.set(s.session_id, {
          session_id: s.session_id,
          session_name: s.session_name,
          year: s.year,
          first_vote_date: null,
          last_vote_date: null,
          vote_count: 0,
          bills: new Set()
        });
      });

      // Group votes by session and calculate stats
      voteData.forEach((vote: any) => {
        const sessionId = billToSession.get(vote.bill_id);
        if (!sessionId || !sessionInfoMap.has(sessionId)) return;
        
        const session = sessionInfoMap.get(sessionId);
        session.vote_count++;
        session.bills.add(vote.bill_id);
        
        if (!session.first_vote_date || vote.vote_date < session.first_vote_date) {
          session.first_vote_date = vote.vote_date;
        }
        if (!session.last_vote_date || vote.vote_date > session.last_vote_date) {
          session.last_vote_date = vote.vote_date;
        }
      });

      // Get sponsor counts
      const { data: sponsorData } = await supabase2
        .from('bill_sponsors')
        .select(`
          bill_id,
          bills!inner(session_id)
        `)
        .in('legislator_id', legislatorIds);

      const sponsorCounts = new Map<number, number>();
      (sponsorData || []).forEach((sponsor: any) => {
        const sessionId = sponsor.bills.session_id;
        sponsorCounts.set(sessionId, (sponsorCounts.get(sessionId) || 0) + 1);
      });

      // Convert to array and add sponsor counts
      const sessionArray: SessionInfo[] = Array.from(sessionInfoMap.values())
        .filter(s => s.vote_count > 0 && s.first_vote_date) // Only include sessions with votes
        .map(s => ({
          session_id: s.session_id,
          session_name: s.session_name,
          first_vote_date: s.first_vote_date,
          last_vote_date: s.last_vote_date,
          vote_count: s.vote_count,
          sponsored_count: sponsorCounts.get(s.session_id) || 0
        }));

      // Sort by most recent first
      sessionArray.sort((a, b) => b.last_vote_date.localeCompare(a.last_vote_date));
      
      setSessions(sessionArray);
      if (sessionArray.length > 0) {
        setActiveSessionId(sessionArray[0].session_id);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const formatYearRange = (firstDate: string, lastDate: string) => {
    const first = new Date(firstDate).getFullYear();
    const last = new Date(lastDate).getFullYear();
    return first === last ? `${first}` : `${first}-${last % 100}`;
  };

  if (isLoadingSessions) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No legislative history found for this person.
      </div>
    );
  }

  console.log('Sessions loaded:', sessions);

  // Create tabs for each session
  const sessionTabs = sessions.map(session => ({
    id: `session-${session.session_id}`,
    label: `${session.session_name} (${formatYearRange(session.first_vote_date, session.last_vote_date)})`,
    content: <SessionVotes key={`session-content-${session.session_id}`} sessionId={session.session_id} personId={personId} sessionInfo={session} />
  }));

  console.log('Session tabs:', sessionTabs);

  if (sessionTabs.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No sessions available.
      </div>
    );
  }

  return (
    <div>
      <Tabs tabs={sessionTabs} defaultTab={`session-${sessions[0].session_id}`} />
    </div>
  );
};

// Component for displaying votes within a session
const SessionVotes: React.FC<{
  sessionId: number;
  personId: number;
  sessionInfo: SessionInfo;
}> = ({ sessionId, personId, sessionInfo }) => {
  const [billVotes, setBillVotes] = useState<BillVote[]>([]);
  const [expandedBillId, setExpandedBillId] = useState<number | null>(null);
  const [voteHistory, setVoteHistory] = useState<Record<number, VoteDetail[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    console.log('SessionVotes mounted for session:', sessionId, 'person:', personId);
    loadBillVotes();
  }, [sessionId, personId]);

  const loadBillVotes = async () => {
    setIsLoading(true);
    try {
      // Get legislator IDs for this person
      const { data: legData } = await supabase2
        .from('rs_person_legislators')
        .select('legislator_id')
        .eq('person_id', personId);

      if (!legData || legData.length === 0) {
        setBillVotes([]);
        return;
      }

      const legislatorIds = legData.map(l => l.legislator_id);

      // Get all votes for this session grouped by bill
      const { data: votesData, error } = await supabase2
        .from('votes')
        .select(`
          vote_id,
          bill_id,
          vote,
          vote_date,
          venue,
          venue_type,
          bills!inner(
            bill_id,
            bill_number,
            short_title,
            session_id
          )
        `)
        .in('legislator_id', legislatorIds)
        .eq('bills.session_id', sessionId)
        .order('vote_date', { ascending: false });

      if (error) {
        console.error('Error loading bill votes:', error);
        setBillVotes([]);
        return;
      }

      // Group votes by bill and find the latest vote for each
      const billMap = new Map<number, any>();
      
      (votesData || []).forEach((vote: any) => {
        const billId = vote.bill_id;
        
        if (!billMap.has(billId)) {
          billMap.set(billId, {
            bill_id: billId,
            bill_number: vote.bills.bill_number,
            short_title: vote.bills.short_title,
            latest_vote: vote.vote,
            latest_vote_date: vote.vote_date,
            latest_venue: vote.venue,
            votes: []
          });
        }
        
        const bill = billMap.get(billId);
        bill.votes.push(vote);
        
        // Update latest vote if this is more recent
        if (vote.vote_date > bill.latest_vote_date) {
          bill.latest_vote = vote.vote;
          bill.latest_vote_date = vote.vote_date;
          bill.latest_venue = vote.venue;
        }
      });

      // Convert to array and set has_multiple_votes flag
      const billArray: BillVote[] = Array.from(billMap.values()).map(b => ({
        bill_id: b.bill_id,
        bill_number: b.bill_number,
        short_title: b.short_title,
        latest_vote: b.latest_vote,
        latest_vote_date: b.latest_vote_date,
        latest_venue: b.latest_venue,
        has_multiple_votes: b.votes.length > 1
      }));

      // Sort by most recent vote
      billArray.sort((a, b) => b.latest_vote_date.localeCompare(a.latest_vote_date));
      
      setBillVotes(billArray);
    } catch (error) {
      console.error('Failed to load bill votes:', error);
      setBillVotes([]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBillExpansion = async (billId: number) => {
    if (expandedBillId === billId) {
      setExpandedBillId(null);
    } else {
      setExpandedBillId(billId);
      
      // Load vote history if not already loaded
      if (!voteHistory[billId]) {
        setIsLoadingHistory(true);
        try {
          // Get legislator IDs
          const { data: legData } = await supabase2
            .from('rs_person_legislators')
            .select('legislator_id')
            .eq('person_id', personId);

          const legislatorIds = legData?.map(l => l.legislator_id) || [];

          // Get all votes for this bill by this person
          const { data: votes } = await supabase2
            .from('votes')
            .select(`
              vote_id,
              vote_date,
              venue,
              venue_type,
              vote,
              committees(committee_name)
            `)
            .eq('bill_id', billId)
            .in('legislator_id', legislatorIds)
            .order('vote_date');

          setVoteHistory(prev => ({
            ...prev,
            [billId]: votes || []
          }));
        } catch (error) {
          console.error('Failed to load vote history:', error);
        } finally {
          setIsLoadingHistory(false);
        }
      }
    }
  };

  const getVoteBadge = (vote: string) => {
    const voteUpper = vote?.toUpperCase();
    if (['Y', 'YES', 'AYE'].includes(voteUpper)) {
      return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">YES</span>;
    }
    if (['N', 'NO', 'NAY'].includes(voteUpper)) {
      return <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">NO</span>;
    }
    return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">{vote}</span>;
  };

  const filteredBills = billVotes.filter(bill => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      bill.bill_number.toLowerCase().includes(query) ||
      bill.short_title?.toLowerCase().includes(query)
    );
  });

  return (
    <div>
      {/* Session Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              {sessionInfo.session_name}
            </h3>
            <p className="text-sm text-gray-600">
              Active {formatYearRange(sessionInfo.first_vote_date, sessionInfo.last_vote_date)} • 
              {sessionInfo.vote_count} votes • {sessionInfo.sponsored_count} bills sponsored
            </p>
          </div>
          <Link
            to={`/legislature/session/${sessionId}`}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            View Full Session →
          </Link>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search bills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Bills List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
        </div>
      ) : filteredBills.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {searchQuery ? 'No bills match your search' : 'No bills voted on in this session'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredBills.map(bill => (
            <div key={bill.bill_id} className="border rounded-lg">
              {/* Bill Row */}
              <div
                className="p-4 hover:bg-gray-50 cursor-pointer"
                onClick={() => toggleBillExpansion(bill.bill_id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-4">
                      <Link
                        to={`/legislature/bill/${bill.bill_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {bill.bill_number}
                      </Link>
                      <span className="text-gray-600">{bill.short_title}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      Latest: {new Date(bill.latest_vote_date).toLocaleDateString()} • {bill.latest_venue}
                      {bill.has_multiple_votes && ' • Multiple votes'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getVoteBadge(bill.latest_vote)}
                    {bill.has_multiple_votes && (
                      <svg
                        className={`h-5 w-5 text-gray-400 transition-transform ${
                          expandedBillId === bill.bill_id ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>

              {/* Expanded Vote History */}
              {expandedBillId === bill.bill_id && voteHistory[bill.bill_id] && (
                <div className="border-t bg-gray-50 p-4">
                  {isLoadingHistory ? (
                    <div className="flex justify-center py-4">
                      <div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Complete Vote History</h4>
                      {voteHistory[bill.bill_id].map((vote: any, idx: number) => (
                        <div key={vote.vote_id} className="flex items-center gap-4 text-sm bg-white p-2 rounded">
                          <span className="text-gray-400 w-6">#{idx + 1}</span>
                          <span className="text-gray-600 w-24">
                            {new Date(vote.vote_date).toLocaleDateString()}
                          </span>
                          <span className="flex-1">
                            {vote.venue}
                            {vote.committees?.committee_name && ` - ${vote.committees.committee_name}`}
                          </span>
                          {getVoteBadge(vote.vote)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function formatYearRange(firstDate: string, lastDate: string): string {
  const first = new Date(firstDate).getFullYear();
  const last = new Date(lastDate).getFullYear();
  return first === last ? `${first}` : `${first}-${last % 100}`;
}