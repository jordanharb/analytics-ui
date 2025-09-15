// Legislature & Campaign Finance API Types

// Entity/Candidate Types
export interface EntityOverview {
  entity_id: number;
  display_name: string;
  party?: string;
  office?: string;
  total_raised?: number;
  total_spent?: number;
  activity_count?: number;
  first_activity_date?: string;
  last_activity_date?: string;
  status?: string;
}

export interface EntityTransaction {
  transaction_id: number;
  date: string;
  amount: number;
  disposition_id: number; // 1 = income (green), 2 = expense (red)
  type: string;
  name: string;
  occupation?: string;
  location?: string;
  description?: string;
}

export interface EntityReport {
  report_id: number;
  report_name: string;
  filing_date: string;
  period_start?: string;
  period_end?: string;
  donations_total?: number;
  items_count?: number;
  pdf_url?: string;
  csv_url?: string;
}

export interface EntityDonation {
  donation_id: number;
  report_id: number;
  report_name: string;
  date: string;
  amount: number;
  donor_name: string;
  donor_type: string;
  occupation?: string;
  location?: string;
}

// Legislator Types
export interface LegislatorOverview {
  legislator_id: number;
  full_name: string;
  party: string;
  district?: string;
  chamber?: string;
  sessions?: string[];
  total_votes?: number;
  total_bills_sponsored?: number;
  photo_url?: string;
}

export interface LegislatorVote {
  vote_id: number;
  bill_id: number;
  bill_number: string;
  bill_title: string;
  vote_date: string;
  vote_value: string; // YES, NO, ABSENT, etc.
  session_id: number;
  session_name: string;
}

export interface LegislatorSponsorship {
  bill_id: number;
  bill_number: string;
  bill_title: string;
  sponsorship_type: string; // PRIMARY, CO-SPONSOR
  session_id: number;
  session_name: string;
  status: string;
  introduced_date: string;
}

// Bill Types
export interface BillOverview {
  bill_id: number;
  bill_number: string;
  title: string;
  short_title?: string;
  status: string;
  introduced_date: string;
  last_action_date?: string;
  governor_action?: string;
  session_id: number;
  session_name: string;
  primary_sponsor?: string;
  sponsor_count?: number;
}

export interface BillVoteTimeline {
  stage: string;
  chamber: string;
  date: string;
  result: string;
  yes_votes: number;
  no_votes: number;
  absent_votes?: number;
  present_votes?: number;
  vote_id?: number;
}

export interface BillVoteDetail {
  legislator_id: number;
  legislator_name: string;
  person_id?: number;
  vote: string;
  party?: string;
  district?: string;
}

export interface RTSPosition {
  position_id: number;
  entity_name: string;
  representing?: string;
  position: string; // FOR, AGAINST, NEUTRAL
  date_filed: string;
  comments?: string;
  user_id?: number;
}

// Session Types
export interface SessionOverview {
  session_id: number;
  session_name: string;
  year: number;
  type: string; // REGULAR, SPECIAL
  start_date: string;
  end_date?: string;
  bill_count: number;
  legislator_count: number;
  status: string;
}

export interface SessionRoster {
  legislator_id: number;
  full_name: string;
  party: string;
  district: string;
  chamber: string;
  leadership_role?: string;
}

export interface SessionBill {
  bill_id: number;
  bill_number: string;
  title: string;
  status: string;
  sponsor_name: string;
  introduced_date: string;
  last_action?: string;
}

// Person (Canonical) Types
export interface PersonProfile {
  person_id: number;
  full_name: string;
  legislator_ids: number[];
  entity_ids: number[];
  total_raised?: number;
  total_spent?: number;
  total_votes?: number;
  total_bills_sponsored?: number;
  sessions_served?: string[];
}

export interface PersonVote {
  vote_id: number;
  legislator_id: number;
  bill_id: number;
  bill_number: string;
  bill_title: string;
  vote_date: string;
  vote_value: string;
  session_name: string;
}

export interface PersonDonation {
  donation_id: number;
  entity_id: number;
  entity_name: string;
  date: string;
  amount: number;
  type: string; // CONTRIBUTION, EXPENSE
  description?: string;
  donor_name?: string;
  recipient_name?: string;
}

// Search Types
export interface SearchResult {
  id: number | string;
  type: 'entity' | 'legislator' | 'bill' | 'person';
  title: string;
  subtitle?: string;
  description?: string;
  url: string;
}

export interface SearchAllResponse {
  entities: SearchResult[];
  legislators: SearchResult[];
  bills: SearchResult[];
  persons?: SearchResult[];
}

// Pagination Types
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total?: number;
  has_more?: boolean;
}