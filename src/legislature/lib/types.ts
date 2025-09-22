// TypeScript interfaces for the Arizona Campaign Finance application

export interface Entity {
  entity_id: number;
  entity_url: string | null;
  primary_committee_name: string | null;
  primary_candidate_name: string | null;
  total_records: number;
  earliest_activity: string | null;
  latest_activity: string | null;
  total_income_all_records: number;
  total_expense_all_records: number;
  max_cash_balance: number;
  created_at: string;
  last_updated: string;
}

export interface EntityRecord {
  record_id: number;
  entity_id: number;
  entity_name: string | null;
  entity_first_name: string | null;
  committee_name: string | null;
  entity_type: string | null;
  office_name: string | null;
  office_id: number | null;
  office_type_id: number | null;
  party_name: string | null;
  party_id: number | null;
  cash_balance: number;
  income: number;
  expense: number;
  committee_status: string | null;
  registration_date: string | null;
  termination_date: string | null;
  is_primary_record: boolean;
}

export interface SearchResult {
  entity_id: number;
  name: string;
  party_name: string | null;
  office_name: string | null;
  latest_activity: string | null;
  total_income: number;
  total_expense: number;
  similarity?: number;
}

export interface PersonSearchResult {
  person_id: number;
  display_name: string;
  party?: string | null;
  body?: string | null;
  district?: number | null;
  latest_activity?: string | null;
  total_income?: number | null;
  total_expense?: number | null;
  all_session_ids: number[];
  all_legislator_ids: number[];
  all_entity_ids: number[];
  primary_entity_id?: number | null;
  primary_entity_name?: string | null;
  entity_count: number;
  legislator_count: number;
  summary?: string;
}

export interface Report {
  report_id: number;
  entity_id: number;
  entity_name: string;
  rpt_name: string | null;
  rpt_title: string | null;
  rpt_file_date: string | null;
  rpt_period: string | null;
  rpt_cycle: number | null;
  org_name: string | null;
  org_treasurer: string | null;
  total_donations: number | null;
  total_expenditures: number | null;
  donation_count: number | null;
  pdf_url: string | null;
  filing_date: string | null;
  filing_period_end_date: string | null;
}

export interface Transaction {
  public_transaction_id: number;
  entity_id: number;
  entity_name: string;
  committee_name: string | null;
  report_id: number | null;
  transaction_date: string | null;
  transaction_date_year: number | null;
  amount: number;
  transaction_type: string | null;
  transaction_type_id: number | null;
  received_from_or_paid_to: string | null;
  counterparty_name: string | null;
  counterparty_type: string | null;
  transaction_first_name: string | null;
  transaction_middle_name: string | null;
  transaction_last_name: string | null;
  transaction_city: string | null;
  transaction_state: string | null;
  transaction_zip_code: string | null;
  transaction_employer: string | null;
  transaction_occupation: string | null;
  memo: string | null;
  is_for_benefit: boolean | null;
  benefited_opposed: string | null;
  candidate_first_name: string | null;
  candidate_middle_name: string | null;
  candidate_last_name: string | null;
  candidate_office_id: number | null;
  candidate_party_id: number | null;
}

export interface ExportJob {
  job_id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  url?: string;
  error?: string;
}

export interface ExportResult {
  filename: string;
  size_bytes: number;
  record_count: number;
  entity_count: number;
  url: string;
  cached?: boolean;
}

export interface BulkExportRequest {
  kind: 'reports' | 'transactions';
  entity_ids: number[];
  filters?: {
    date_from?: string;
    date_to?: string;
    type?: string;
  };
  zip?: boolean;
}

export interface ApiError {
  error: string;
  details?: string;
}
