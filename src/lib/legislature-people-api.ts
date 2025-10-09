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
  GroupedRollCall,
  TopDonor,
  BillDetails
} from './legislature-people-types';

// ============================================
// PEOPLE INDEX & SEARCH
// ============================================

export async function fetchPeopleIndex(
  query: string = '',
  limit: number = 100,
  offset: number = 0
): Promise<{ data: PersonIndex[]; total?: number }> {
  // Try the available functions in order of preference
  const attempts = [
    { fn: 'rs_legislators_people_index', payload: { q: query || '', p_limit: limit, p_offset: offset } },
    { fn: 'search_legislators_with_sessions', payload: { p_search_term: query || '' } },
    { fn: 'search_people_with_sessions', payload: { p_search_term: query || '' } },
    { fn: 'rs_people_index_simple', payload: { p_q: query || null, p_limit: limit, p_offset: offset } }
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await supabase2.rpc(attempt.fn, attempt.payload);
      if (error) {
        console.warn(`RPC ${attempt.fn} failed:`, error);
        continue;
      }
      if (data && data.length > 0) {
        return { data: data || [] };
      }
    } catch (error) {
      console.warn(`RPC ${attempt.fn} threw:`, error);
    }
  }
  
  return { data: [] };
}

export async function searchPeople(query: string, limit: number = 25): Promise<PersonSearchResult[]> {
  // Try the available functions in order of preference
  const attempts = [
    { fn: 'rs_legislators_people_index', payload: { q: query, p_limit: limit, p_offset: 0 } },
    { fn: 'search_legislators_with_sessions', payload: { p_search_term: query } },
    { fn: 'search_people_with_sessions', payload: { p_search_term: query } },
    { fn: 'rs_search_people', payload: { q: query, p_limit: limit } }
  ];

  for (const attempt of attempts) {
    try {
      const { data, error } = await supabase2.rpc(attempt.fn, attempt.payload);
      if (error) {
        console.warn(`RPC ${attempt.fn} failed:`, error);
        continue;
      }
      if (data && data.length > 0) {
        return data || [];
      }
    } catch (error) {
      console.warn(`RPC ${attempt.fn} threw:`, error);
    }
  }
  
  return [];
}

// ============================================
// PERSON VOTE HISTORY
// ============================================

export async function fetchPersonSessions(personId: number): Promise<PersonSession[]> {
  const { data, error } = await supabase2.rpc('rs_person_sessions', {
    p_person_id: personId
  });

  if (error) throw error;

  const rows: any[] = data || [];

  // Normalize multiple historical shapes of rs_person_sessions
  const normalized: PersonSession[] = rows.map((row) => {
    // Prefer explicit fields when available
    const sessionId: number = Number(row.session_id ?? row.session ?? 0);

    const sessionName: string =
      row.session_name ??
      row.session_label ??
      (typeof row.session === 'string' ? row.session : `Session ${sessionId || ''}`);

    // Year may come directly or be derivable from first/last vote dates
    let year: number = Number(row.year ?? 0);
    if (!Number.isFinite(year) || year <= 0) {
      const dateStr: string | undefined = row.last_vote_date || row.first_vote_date || row.end_date || row.start_date;
      if (dateStr) {
        const d = new Date(dateStr);
        if (!Number.isNaN(d.getTime())) year = d.getFullYear();
      }
    }

    const voteCount: number = Number(row.vote_count ?? row.votes_count ?? 0);
    const sponsoredCount: number = Number(row.sponsored_count ?? 0);
    const startDate: string | null =
      row.start_date ??
      row.session_start ??
      row.calculated_start ??
      row.vote_window_start ??
      null;
    const endDate: string | null =
      row.end_date ??
      row.session_end ??
      row.calculated_end ??
      row.vote_window_end ??
      null;
    const firstVoteDate: string | null = row.first_vote_date ?? row.earliest_vote_date ?? row.earliest_vote ?? null;
    const lastVoteDate: string | null = row.last_vote_date ?? row.latest_vote_date ?? row.latest_vote ?? null;

    return {
      session_id: sessionId,
      session_name: sessionName,
      year: year || 0,
      vote_count: voteCount,
      sponsored_count: sponsoredCount,
      start_date: startDate,
      end_date: endDate,
      first_vote_date: firstVoteDate,
      last_vote_date: lastVoteDate,
    } as PersonSession;
  });

  // Sort most recent first if year present
  normalized.sort((a, b) => (b.year || 0) - (a.year || 0) || b.session_id - a.session_id);
  return normalized;
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

export async function fetchBillDetails(billId: number): Promise<BillDetails | null> {
  if (!Number.isFinite(billId) || billId <= 0) {
    return null;
  }

  const { data, error } = await supabase2.rpc('get_bill_details', {
    p_bill_id: Math.trunc(billId)
  });

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as Partial<BillDetails> | null | undefined;
  if (!row) {
    return null;
  }

  return {
    bill_id: Number(row.bill_id ?? billId),
    bill_number: row.bill_number ?? '',
    bill_text: row.bill_text ?? null,
    bill_summary: row.bill_summary ?? null,
  };
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

export async function fetchEntityTopDonors(
  entityId: number,
  limit: number = 200
): Promise<TopDonor[]> {
  if (!Number.isFinite(entityId) || entityId <= 0) {
    return [];
  }

  const { data, error } = await supabase2.rpc('search_donor_totals_window', {
    p_person_id: null,
    p_recipient_entity_ids: [Math.trunc(entityId)],
    p_session_id: null,
    p_min_amount: 0,
    p_limit: limit
  });

  if (error) throw error;

  type DonorRow = {
    transaction_entity_id: number | null;
    entity_name: string | null;
    total_to_recipient: number | null;
    donation_count: number | null;
    best_match?: number | null;
    top_employer?: string | null;
    top_occupation?: string | null;
    entity_type_id?: number | null;
    entity_type_name?: string | null;
  };

  const rows = (data || []) as DonorRow[];

  return rows.map((row) => ({
    transaction_entity_id: Number(row.transaction_entity_id ?? 0),
    entity_name: row.entity_name ?? 'Unknown',
    total_to_recipient: Number(row.total_to_recipient ?? 0),
    donation_count: Number(row.donation_count ?? 0),
    best_match: row.best_match ?? null,
    top_employer: row.top_employer ?? null,
    top_occupation: row.top_occupation ?? null,
    entity_type_id: row.entity_type_id ?? null,
    entity_type_name: row.entity_type_name ?? null,
  }));
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
    person_id: String(personId),
    entity_ids: entityIds.join(',')
  });
  return `${import.meta.env.VITE_SUPABASE2_URL}/rest/v1/rpc/rs_queue_transactions_export?${params}`;
}

export async function fetchPersonVotesInSession(personId: number, sessionId: number) {
  const { data, error } = await supabase2.rpc('get_person_votes_in_session', {
    p_person_id: personId,
    p_session_id: sessionId
  });

  if (error) throw error;
  return data || [];
}

export function getPersonReportsCSVUrl(personId: number, entityIds: number[]): string {
  const params = new URLSearchParams({
    person_id: String(personId),
    entity_ids: entityIds.join(',')
  });
  return `${import.meta.env.VITE_SUPABASE2_URL}/rest/v1/rpc/rs_queue_reports_export?${params}`;
}
