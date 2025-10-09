// People-Centric Types for Legislature & Campaign Finance

// ============================================
// PEOPLE & PERSON TYPES
// ============================================

export interface PersonIndex {
  person_id: number;
  display_name: string;
  positions_held: string[];
  last_session_id: number | null;
  last_session_name: string | null;
  sponsored_count: number;
  vote_count: number;
  first_active_date: string | null;
  last_active_date: string | null;
}

export interface PersonSession {
  session_id: number;
  session_name: string;
  year: number;
  vote_count: number;
  sponsored_count: number;
  start_date?: string | null;
  end_date?: string | null;
  first_vote_date?: string | null;
  last_vote_date?: string | null;
}

export interface PersonBillVote {
  bill_id: number;
  bill_number: string;
  short_title: string;
  latest_vote: string;
  latest_vote_date: string;
  latest_venue: string;
  vote_count: number;
}

export interface BillDetails {
  bill_id: number;
  bill_number: string;
  bill_text: string | null;
  bill_summary: string | null;
}

export interface PersonVoteHistory {
  vote_id: number;
  vote_date: string;
  venue: string;
  venue_type: string;
  committee_name: string | null;
  vote: string;
  vote_number: number;
}

export interface BillRollCall {
  vote_date: string;
  venue: string;
  venue_type: string;
  committee_name: string | null;
  legislator_id: number;
  legislator_name: string;
  party: string;
  vote: string;
  person_id: number | null;
}

export interface RTSPositionWithSearch {
  position_id: number;
  entity_name: string;
  representing: string | null;
  position: string;
  submitted_date: string;
  user_id: number | null;
  person_id: number | null;
}

export interface PersonFinanceOverview {
  total_raised: number;
  total_spent: number;
  entity_count: number;
  transaction_count: number;
  first_activity: string | null;
  last_activity: string | null;
  entity_details: Array<{
    entity_id: number;
    display_name: string;
    total_raised: number;
    total_spent: number;
  }>;
}

export interface TopDonor {
  transaction_entity_id: number;
  entity_name: string;
  total_to_recipient: number;
  donation_count: number;
  best_match?: number | null;
  top_employer?: string | null;
  top_occupation?: string | null;
  entity_type_id?: number | null;
  entity_type_name?: string | null;
}

export interface PersonTransaction {
  transaction_date: string;
  amount: number;
  transaction_type: string;
  disposition_id: number;
  name: string;
  occupation: string | null;
  city: string | null;
  state: string | null;
  entity_id: number;
  entity_name: string;
}

export interface PersonReport {
  report_id: number;
  report_name: string;
  filing_date: string;
  period: string;
  donations_total: number;
  donation_items: number;
  pdf_url: string | null;
  entity_id: number;
  entity_name: string;
}

export interface PersonSearchResult {
  person_id: number;
  display_name: string;
  description: string;
  person_type: 'legislator' | 'candidate' | 'other';
}

// ============================================
// GROUPED DATA STRUCTURES
// ============================================

export interface GroupedRollCall {
  vote_date: string;
  venue: string;
  venue_type: string;
  committee_name: string | null;
  votes: {
    yes: BillRollCall[];
    no: BillRollCall[];
    other: BillRollCall[];
  };
  totals: {
    yes: number;
    no: number;
    other: number;
  };
}

export interface PersonPageData {
  overview: PersonFinanceOverview;
  sessions: PersonSession[];
  currentSessionVotes?: PersonBillVote[];
}

// ============================================
// UI STATE TYPES
// ============================================

export interface VoteHistoryState {
  selectedSessionId: number | null;
  expandedBillId: number | null;
  searchQuery: string;
  isLoadingVotes: boolean;
  isLoadingHistory: boolean;
}

export interface FinanceTabState {
  activeTab: 'transactions' | 'reports' | 'donations';
  transactionPage: number;
  donationPage: number;
  isLoading: boolean;
}
