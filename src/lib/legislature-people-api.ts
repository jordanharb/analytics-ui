import { supabase2 } from './supabase2';
import type {
  PersonIndex,
  PersonSession,
  PersonBillVote,
  PersonVoteHistory,
  BillRollCall,
  RTSPositionWithSearch,
  PersonFinanceOverview,
  PersonTransaction,
  PersonReport,
  PersonSearchResult,
  GroupedRollCall
} from './legislature-people-types';

// ============================================
// PEOPLE INDEX & SEARCH
// ============================================

export async function fetchPeopleIndex(
  query: string = '',
  limit: number = 100,
  offset: number = 0
): Promise<{ data: PersonIndex[]; total?: number }> {
  const { data, error } = await supabase2.rpc('rs_people_index_simple', {
    p_q: query || null,
    p_limit: limit,
    p_offset: offset
  });

  if (error) throw error;
  return { data: data || [] };
}

export async function searchPeople(query: string, limit: number = 25): Promise<PersonSearchResult[]> {
  const { data, error } = await supabase2.rpc('rs_search_people', {
    q: query,
    p_limit: limit
  });

  if (error) throw error;
  return data || [];
}

// ============================================
// PERSON VOTE HISTORY
// ============================================

export async function fetchPersonSessions(personId: number): Promise<PersonSession[]> {
  const { data, error } = await supabase2.rpc('rs_person_sessions', {
    p_person_id: personId
  });

  if (error) throw error;
  return data || [];
}

export async function fetchPersonSessionBillVotes(
  personId: number,
  sessionId: number,
  limit: number = 100,
  offset: number = 0,
  query: string = ''
): Promise<{ data: PersonBillVote[]; hasMore: boolean }> {
  const { data, error } = await supabase2.rpc('rs_person_session_bill_last_votes', {
    p_person_id: personId,
    p_session_id: sessionId,
    p_limit: limit,
    p_offset: offset,
    q: query
  });

  if (error) throw error;
  return {
    data: data || [],
    hasMore: (data?.length || 0) === limit
  };
}

export async function fetchPersonBillVoteHistory(
  personId: number,
  billId: number
): Promise<PersonVoteHistory[]> {
  const { data, error } = await supabase2.rpc('rs_person_bill_vote_history', {
    p_person_id: personId,
    p_bill_id: billId
  });

  if (error) throw error;
  return data || [];
}

// ============================================
// BILL ROLL CALLS & RTS
// ============================================

export async function fetchBillRollCall(billId: number): Promise<GroupedRollCall[]> {
  const { data, error } = await supabase2.rpc('rs_bill_votes_full', {
    p_bill_id: billId
  });

  if (error) throw error;

  // Group votes by date/venue
  const grouped = new Map<string, GroupedRollCall>();
  
  (data || []).forEach((vote: BillRollCall) => {
    const key = `${vote.vote_date}_${vote.venue}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, {
        vote_date: vote.vote_date,
        venue: vote.venue,
        venue_type: vote.venue_type,
        committee_name: vote.committee_name,
        votes: { yes: [], no: [], other: [] },
        totals: { yes: 0, no: 0, other: 0 }
      });
    }

    const group = grouped.get(key)!;
    
    if (vote.vote === 'Y' || vote.vote === 'Yes' || vote.vote === 'Aye') {
      group.votes.yes.push(vote);
      group.totals.yes++;
    } else if (vote.vote === 'N' || vote.vote === 'No' || vote.vote === 'Nay') {
      group.votes.no.push(vote);
      group.totals.no++;
    } else {
      group.votes.other.push(vote);
      group.totals.other++;
    }
  });

  return Array.from(grouped.values()).sort((a, b) => 
    new Date(a.vote_date).getTime() - new Date(b.vote_date).getTime()
  );
}

export async function searchBillRTSPositions(
  billId: number,
  query: string = '',
  limit: number = 100,
  offset: number = 0
): Promise<{ data: RTSPositionWithSearch[]; hasMore: boolean }> {
  const { data, error } = await supabase2.rpc('rs_bill_rts_positions_search', {
    p_bill_id: billId,
    q: query,
    p_limit: limit,
    p_offset: offset
  });

  if (error) throw error;
  return {
    data: data || [],
    hasMore: (data?.length || 0) === limit
  };
}

// ============================================
// PERSON FINANCE
// ============================================

export async function fetchPersonFinanceOverview(personId: number): Promise<PersonFinanceOverview> {
  const { data, error } = await supabase2.rpc('rs_person_finance_overview', {
    p_person_id: personId
  });

  if (error) throw error;
  
  const result = data?.[0];
  if (!result) {
    return {
      total_raised: 0,
      total_spent: 0,
      entity_count: 0,
      transaction_count: 0,
      first_activity: null,
      last_activity: null,
      entity_details: []
    };
  }

  return {
    ...result,
    entity_details: result.entity_details || []
  };
}

export async function fetchPersonTransactions(
  personId: number,
  limit: number = 50,
  offset: number = 0
): Promise<{ data: PersonTransaction[]; hasMore: boolean }> {
  const { data, error } = await supabase2.rpc('rs_person_transactions', {
    p_person_id: personId,
    p_limit: limit,
    p_offset: offset
  });

  if (error) throw error;
  return {
    data: data || [],
    hasMore: (data?.length || 0) === limit
  };
}

export async function fetchPersonReports(personId: number): Promise<PersonReport[]> {
  const { data, error } = await supabase2.rpc('rs_person_reports', {
    p_person_id: personId
  });

  if (error) throw error;
  return data || [];
}

// ============================================
// EXPORT HELPERS
// ============================================

export function getPersonTransactionsCSVUrl(personId: number, entityIds: number[]): string {
  const params = new URLSearchParams({
    entity_ids: entityIds.join(',')
  });
  return `${import.meta.env.VITE_SUPABASE2_URL}/rest/v1/rpc/rs_queue_transactions_export?${params}`;
}

export function getPersonReportsCSVUrl(personId: number, entityIds: number[]): string {
  const params = new URLSearchParams({
    entity_ids: entityIds.join(',')
  });
  return `${import.meta.env.VITE_SUPABASE2_URL}/rest/v1/rpc/rs_queue_reports_export?${params}`;
}