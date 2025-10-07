import { supabase2 } from './supabase2';
import type { 
  EntityOverview,
  EntityTransaction,
  EntityReport,
  EntityDonation,
  LegislatorOverview,
  LegislatorVote,
  LegislatorSponsorship,
  BillOverview,
  BillVoteTimeline,
  BillVoteDetail,
  RTSPosition,
  SessionOverview,
  SessionRoster,
  SessionBill,
  PersonProfile,
  PersonVote,
  PersonDonation,
  SearchResult,
  SearchAllResponse,
  PaginationParams,
  PaginatedResponse
} from './legislature-types';

// Base RPC call wrapper
async function callRPC<T>(functionName: string, params: any = {}): Promise<T> {
  const { data, error } = await supabase2.rpc(functionName, params);
  
  if (error) {
    console.error(`Error calling ${functionName}:`, error);
    throw new Error(`Failed to fetch data: ${error.message}`);
  }
  
  return data as T;
}

// Search APIs
export async function searchAll(query: string): Promise<SearchAllResponse> {
  // The actual rs_search_all returns flat results with 'kind', 'id', 'label', 'extra'
  const results = await callRPC<Array<{
    kind: string;
    id: number;
    label: string;
    extra: string | null;
  }>>('rs_search_all', { q: query });
  
  // Group results by type
  const entities: SearchResult[] = [];
  const legislators: SearchResult[] = [];
  const bills: SearchResult[] = [];
  
  results.forEach(item => {
    const result: SearchResult = {
      id: item.id,
      type: item.kind as 'entity' | 'legislator' | 'bill' | 'person',
      title: item.label,
      subtitle: item.extra || '',
      description: '',
      url: ''
    };
    
    switch (item.kind) {
      case 'entity':
        result.url = `/legislature/candidate/${item.id}`;
        entities.push(result);
        break;
      case 'legislator':
        result.url = `/legislature/legislator/${item.id}`;
        legislators.push(result);
        break;
      case 'bill':
        result.url = `/legislature/bill/${item.id}`;
        result.description = item.extra || '';
        bills.push(result);
        break;
    }
  });
  
  return {
    entities,
    legislators,
    bills,
    persons: []
  };
}

// Entity/Candidate APIs
export async function fetchEntityOverview(entityId: number): Promise<EntityOverview> {
  return callRPC('rs_entity_overview', { p_entity_id: entityId });
}

export async function fetchEntityTransactions(
  entityId: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<EntityTransaction>> {
  const { limit = 50, offset = 0 } = params;
  const data = await callRPC<any[]>('rs_entity_transactions', {
    p_entity_id: entityId,
    p_limit: limit,
    p_offset: offset
  });
  
  // Transform to match our type structure
  const transactions: EntityTransaction[] = data.map(item => ({
    transaction_id: 0, // Not provided by API
    date: item.transaction_date,
    amount: item.amount,
    disposition_id: item.disposition_id,
    type: item.transaction_type,
    name: item.name,
    occupation: item.occupation,
    location: `${item.city || ''}${item.city && item.state ? ', ' : ''}${item.state || ''}`.trim() || undefined
  }));
  
  return {
    data: transactions,
    has_more: data.length === limit
  };
}

export async function fetchEntityReports(entityId: number): Promise<EntityReport[]> {
  return callRPC('rs_entity_reports', { p_entity_id: entityId });
}

export async function fetchEntityDonations(
  entityId: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<EntityDonation>> {
  const { limit = 50, offset = 0 } = params;
  return callRPC('rs_entity_donations', {
    p_entity_id: entityId,
    p_limit: limit,
    p_offset: offset
  });
}

export async function fetchCandidates(
  params: PaginationParams = {}
): Promise<PaginatedResponse<EntityOverview>> {
  const { limit = 500, offset = 0 } = params;
  const data = await callRPC<any[]>('rs_candidates_index', {
    p_limit: limit,
    p_offset: offset
  });
  return {
    data,
    has_more: data.length === limit
  };
}

// Legislator APIs
export async function fetchLegislatorOverview(legislatorId: number): Promise<LegislatorOverview> {
  return callRPC('rs_legislator_overview', { p_legislator_id: legislatorId });
}

export async function fetchLegislatorVotes(
  legislatorId: number,
  sessionId?: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<LegislatorVote>> {
  const { limit = 50, offset = 0 } = params;
  return callRPC('rs_legislator_votes', {
    p_legislator_id: legislatorId,
    p_session_id: sessionId,
    p_limit: limit,
    p_offset: offset
  });
}

export async function fetchLegislatorSponsorships(
  legislatorId: number,
  sessionId?: number
): Promise<LegislatorSponsorship[]> {
  return callRPC('rs_legislator_sponsorships', {
    p_legislator_id: legislatorId,
    p_session_id: sessionId
  });
}

// Bill APIs
export async function fetchBillOverview(billId: number): Promise<BillOverview> {
  return callRPC('rs_bill_overview', { p_bill_id: billId });
}

export async function fetchBillVoteTimeline(billId: number): Promise<BillVoteTimeline[]> {
  return callRPC('rs_bill_vote_timeline', { p_bill_id: billId });
}

export async function fetchBillRTSPositions(billId: number): Promise<RTSPosition[]> {
  return callRPC('rs_bill_rts_positions', { p_bill_id: billId });
}

export async function fetchBillVoteDetails(billId: number): Promise<BillVoteDetail[]> {
  return callRPC('rs_bill_votes_full', { p_bill_id: billId });
}

// Session APIs
export async function fetchSessionOverview(sessionId: number): Promise<SessionOverview> {
  return callRPC('rs_session_overview', { p_session_id: sessionId });
}

export async function fetchSessionRoster(sessionId: number): Promise<SessionRoster[]> {
  return callRPC('rs_session_roster', { p_session_id: sessionId });
}

export async function fetchSessions(): Promise<SessionOverview[]> {
  return callRPC('list_sessions');
}


export async function fetchSessionBills(
  sessionId: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<SessionBill>> {
  const { limit = 50, offset = 0 } = params;
  return callRPC('rs_session_bills', {
    p_session_id: sessionId,
    p_limit: limit,
    p_offset: offset
  });
}

// Person (Canonical) APIs
export async function fetchPersonOverview(personId: number): Promise<PersonProfile> {
  return callRPC('rs_person_overview', { p_person_id: personId });
}

export async function fetchPersonVotes(
  personId: number,
  sessionId?: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<PersonVote>> {
  const { limit = 50, offset = 0 } = params;
  return callRPC('rs_person_votes', {
    p_person_id: personId,
    p_session_id: sessionId,
    p_limit: limit,
    p_offset: offset
  });
}

export async function fetchPersonDonations(
  personId: number,
  params: PaginationParams = {}
): Promise<PaginatedResponse<PersonDonation>> {
  const { limit = 50, offset = 0 } = params;
  return callRPC('rs_person_donations', {
    p_person_id: personId,
    p_limit: limit,
    p_offset: offset
  });
}

// RTS User APIs
export async function fetchRTSUserHistory(userId: number): Promise<RTSPosition[]> {
  return callRPC('rs_rts_user_history', { p_user_id: userId });
}

// CSV Export APIs (these will open in new tabs)
export function getEntityTransactionsCSVUrl(entityId: number): string {
  return `${import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL}/rest/v1/rpc/rs_export_entity_transactions?p_entity_id=${entityId}`;
}

export function getEntityDonationsCSVUrl(entityId: number): string {
  return `${import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL}/rest/v1/rpc/rs_export_entity_donations?p_entity_id=${entityId}`;
}

export function getReportCSVUrl(reportId: number): string {
  return `${import.meta.env.VITE_CAMPAIGN_FINANCE_SUPABASE_URL}/rest/v1/rpc/rs_export_report?p_report_id=${reportId}`;
}