'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface Entity {
  entity_id: number;
  primary_candidate_name: string | null;
  primary_committee_name: string | null;
  primary_record_id: number | null;
}

interface FinancialRecord {
  record_id: number;
  party_name: string | null;
  office_name: string | null;
}

interface Transaction {
  transaction_id: number;
  record_id: number;
  entity_id: number;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  transaction_type_disposition_id?: number;
  contributor_name: string | null;
  vendor_name: string | null;
  occupation: string | null;
  employer: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string | null;
  memo: string | null;
  in_kind_description: string | null;
  loan_amount: string | null;
  check_number: string | null;
  total_count: number;
}

interface Report {
  report_id: number;
  record_id?: number;
  entity_id?: number;
  report_name: string;
  report_period: string;
  filing_date: string;
  pdf_url: string | null;
  total_income?: number;
  total_donations?: number;
  total_expense?: number;
  total_expenditures?: number;
  cash_balance?: number;
  donation_count: number;
  start_date?: string | null;
  end_date?: string | null;
  cash_on_hand_beginning?: number | null;
  cash_on_hand_end?: number | null;
}

interface Donation {
  donation_id: number;
  report_id: number;
  entity_id: number;
  report_name: string;
  filing_date: string;
  donation_date: string;
  amount: number;
  donor_name: string;
  donor_type: string;
  donor_first_name: string | null;
  donor_last_name: string | null;
  donor_organization: string | null;
  occupation: string | null;
  employer: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  is_individual: boolean;
  total_count: number;
}

interface SummaryStats {
  transaction_count: number;
  total_contributions?: number;
  total_raised?: number;
  total_expenses?: number;
  total_spent?: number;
  report_count: number;
  donation_count: number;
  first_activity: string | null;
  last_activity: string | null;
  cash_on_hand?: number;
  largest_donation?: number;
  average_donation?: number;
}

function formatCurrency(amount: number | null): string {
  if (!amount) return '$0';
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

async function downloadCSV(data: any, filename: string, columns: { key: string; label: string }[]) {
  // Ensure data is an array
  const dataArray = Array.isArray(data) ? data : [];
  
  if (dataArray.length === 0) {
    console.warn('No data to download');
    return;
  }
  
  // Create CSV content
  const headers = columns.map(col => col.label).join(',');
  const rows = dataArray.map(row => 
    columns.map(col => {
      const value = row[col.key];
      // Escape values containing commas or quotes
      if (value && (value.toString().includes(',') || value.toString().includes('"'))) {
        return `"${value.toString().replace(/"/g, '""')}"`;
      }
      return value || '';
    }).join(',')
  );
  
  const csv = [headers, ...rows].join('\n');
  
  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function CandidatePage() {
  const params = useParams();
  const entityId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [primaryRecord, setPrimaryRecord] = useState<FinancialRecord | null>(null);
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [financialSummary, setFinancialSummary] = useState<any>(null);
  
  // Transactions state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  
  // Reports state
  const [reports, setReports] = useState<Report[]>([]);
  
  // Donations state
  const [donations, setDonations] = useState<Donation[]>([]);
  const [donationOffset, setDonationOffset] = useState(0);
  const [hasMoreDonations, setHasMoreDonations] = useState(true);
  const [loadingDonations, setLoadingDonations] = useState(false);
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'transactions' | 'reports'>('transactions');
  const [reportTab, setReportTab] = useState<'reports' | 'donations'>('reports');
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [transactionDownloadMenuOpen, setTransactionDownloadMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const transactionDropdownRef = useRef<HTMLDivElement>(null);
  
  const ITEMS_PER_PAGE = 50;

  // Click outside handler for dropdowns
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDownloadMenuOpen(false);
      }
      if (transactionDropdownRef.current && !transactionDropdownRef.current.contains(event.target as Node)) {
        setTransactionDownloadMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      try {
        // Fetch entity info
        const response = await fetch(`/api/entity/${entityId}`);
        if (!response.ok) throw new Error('Failed to fetch entity');
        
        const data = await response.json();
        setEntity(data.entity);
        setPrimaryRecord(data.primaryRecord);
        setSummaryStats(data.summaryStats);
        setFinancialSummary(data.financialSummary);
        setReports(data.reports);
        
        // Load initial transactions
        await loadMoreTransactions(true);
        
        // Load initial donations
        await loadMoreDonations(true);
      } catch (error) {
        console.error('Error loading entity data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  // Load more transactions
  async function loadMoreTransactions(initial = false) {
    if (loadingTransactions || (!initial && !hasMoreTransactions)) return;
    
    setLoadingTransactions(true);
    try {
      const offset = initial ? 0 : transactionOffset;
      const response = await fetch(
        `/api/entity/${entityId}/transactions?limit=${ITEMS_PER_PAGE}&offset=${offset}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch transactions');
      
      const newTransactions = await response.json();
      
      if (newTransactions && newTransactions.length > 0) {
        if (initial) {
          setTransactions(newTransactions);
          setTransactionOffset(ITEMS_PER_PAGE);
        } else {
          setTransactions(prev => [...prev, ...newTransactions]);
          setTransactionOffset(prev => prev + ITEMS_PER_PAGE);
        }
        
        // Check if we have more
        const totalCount = newTransactions[0].total_count;
        if (offset + ITEMS_PER_PAGE >= totalCount) {
          setHasMoreTransactions(false);
        }
      } else {
        setHasMoreTransactions(false);
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
      setHasMoreTransactions(false);
    } finally {
      setLoadingTransactions(false);
    }
  }

  // Load more donations
  async function loadMoreDonations(initial = false) {
    if (loadingDonations || (!initial && !hasMoreDonations)) return;
    
    setLoadingDonations(true);
    try {
      const offset = initial ? 0 : donationOffset;
      const response = await fetch(
        `/api/entity/${entityId}/donations?limit=${ITEMS_PER_PAGE}&offset=${offset}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch donations');
      
      const newDonations = await response.json();
      
      if (newDonations && newDonations.length > 0) {
        if (initial) {
          setDonations(newDonations);
          setDonationOffset(ITEMS_PER_PAGE);
        } else {
          setDonations(prev => [...prev, ...newDonations]);
          setDonationOffset(prev => prev + ITEMS_PER_PAGE);
        }
        
        // Check if we have more
        const totalCount = newDonations[0].total_count;
        if (offset + ITEMS_PER_PAGE >= totalCount) {
          setHasMoreDonations(false);
        }
      } else {
        setHasMoreDonations(false);
      }
    } catch (error) {
      console.error('Error loading donations:', error);
      setHasMoreDonations(false);
    } finally {
      setLoadingDonations(false);
    }
  }

  // Download handlers
  async function downloadTransactionsCSV() {
    const response = await fetch(`/api/entity/${entityId}/transactions?format=csv`);
    const allTransactions = await response.json();
    
    if (allTransactions) {
      downloadCSV(allTransactions, `transactions_${entityId}.csv`, [
        { key: 'transaction_id', label: 'Transaction ID' },
        { key: 'record_id', label: 'Record ID' },
        { key: 'entity_id', label: 'Entity ID' },
        { key: 'transaction_date', label: 'Date' },
        { key: 'amount', label: 'Amount' },
        { key: 'transaction_type', label: 'Type' },
        { key: 'contributor_name', label: 'Contributor Name' },
        { key: 'vendor_name', label: 'Vendor Name' },
        { key: 'occupation', label: 'Occupation' },
        { key: 'employer', label: 'Employer' },
        { key: 'address_line_1', label: 'Address Line 1' },
        { key: 'address_line_2', label: 'Address Line 2' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'zip_code', label: 'Zip Code' },
        { key: 'country', label: 'Country' },
        { key: 'memo', label: 'Memo' },
        { key: 'in_kind_description', label: 'In-Kind Description' },
        { key: 'loan_amount', label: 'Loan Amount' },
        { key: 'check_number', label: 'Check Number' }
      ]);
    }
  }

  async function downloadReportsCSV() {
    const response = await fetch(`/api/entity/${entityId}/reports?format=csv`);
    const allReports = await response.json();
    
    if (allReports) {
      downloadCSV(allReports, `reports_${entityId}.csv`, [
        { key: 'report_id', label: 'Report ID' },
        { key: 'record_id', label: 'Record ID' },
        { key: 'entity_id', label: 'Entity ID' },
        { key: 'report_name', label: 'Report Name' },
        { key: 'filing_date', label: 'Filing Date' },
        { key: 'report_period', label: 'Period' },
        { key: 'start_date', label: 'Start Date' },
        { key: 'end_date', label: 'End Date' },
        { key: 'total_donations', label: 'Total Donations' },
        { key: 'donation_count', label: 'Donation Count' },
        { key: 'cash_on_hand_beginning', label: 'Cash on Hand (Beginning)' },
        { key: 'cash_on_hand_end', label: 'Cash on Hand (End)' },
        { key: 'pdf_url', label: 'PDF URL' }
      ]);
    }
  }

  async function downloadDonationsCSV() {
    const response = await fetch(`/api/entity/${entityId}/donations?format=csv`);
    const allDonations = await response.json();
    
    if (allDonations) {
      downloadCSV(allDonations, `donations_${entityId}.csv`, [
        { key: 'donation_id', label: 'Donation ID' },
        { key: 'report_id', label: 'Report ID' },
        { key: 'entity_id', label: 'Entity ID' },
        { key: 'report_name', label: 'Report' },
        { key: 'filing_date', label: 'Filing Date' },
        { key: 'donation_date', label: 'Date' },
        { key: 'amount', label: 'Amount' },
        { key: 'donor_name', label: 'Donor' },
        { key: 'donor_first_name', label: 'First Name' },
        { key: 'donor_last_name', label: 'Last Name' },
        { key: 'donor_organization', label: 'Organization' },
        { key: 'donor_type', label: 'Type' },
        { key: 'occupation', label: 'Occupation' },
        { key: 'employer', label: 'Employer' },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'zip', label: 'Zip' },
        { key: 'country', label: 'Country' },
        { key: 'is_individual', label: 'Is Individual' }
      ]);
    }
  }

  async function downloadReportDonationsCSV(reportId: number, reportName: string) {
    const response = await fetch(`/api/entity/${entityId}/reports/${reportId}/donations`);
    const reportDonations = await response.json();
    
    if (reportDonations) {
      downloadCSV(reportDonations, `donations_${reportName.replace(/[^a-z0-9]/gi, '_')}.csv`, [
        { key: 'donation_id', label: 'Donation ID' },
        { key: 'donation_date', label: 'Date' },
        { key: 'amount', label: 'Amount' },
        { key: 'donor_name', label: 'Donor' },
        { key: 'donor_first_name', label: 'First Name' },
        { key: 'donor_last_name', label: 'Last Name' },
        { key: 'donor_organization', label: 'Organization' },
        { key: 'donor_type', label: 'Type' },
        { key: 'occupation', label: 'Occupation' },
        { key: 'employer', label: 'Employer' },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'zip', label: 'Zip' },
        { key: 'country', label: 'Country' },
        { key: 'is_individual', label: 'Is Individual' }
      ]);
    }
  }

  if (loading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  if (!entity) {
    return <div style={{ padding: '2rem' }}>Entity not found</div>;
  }

  const entityName = entity.primary_candidate_name || entity.primary_committee_name || 'Unknown Entity';

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Section */}
      <div style={{
        marginBottom: '2rem',
        padding: '2rem',
        backgroundColor: '#f8f9fa',
        borderRadius: '0.5rem',
        border: '1px solid #e5e5e5',
      }}>
        <h1 style={{
          fontSize: '2rem',
          fontWeight: '700',
          marginBottom: '1rem',
          color: '#1f2937'
        }}>
          {entityName}
        </h1>
        
        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {primaryRecord?.party_name && (
            <div><strong>Party:</strong> {primaryRecord.party_name}</div>
          )}
          {primaryRecord?.office_name && (
            <div><strong>Office:</strong> {primaryRecord.office_name}</div>
          )}
          {financialSummary && (
            <>
              <div><strong>Total Raised:</strong> {formatCurrency(financialSummary.total_raised || 0)}</div>
              <div><strong>Total Spent:</strong> {formatCurrency(financialSummary.total_spent || 0)}</div>
            </>
          )}
        </div>
        
        {financialSummary && (
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.875rem', color: '#666' }}>
            <div>{financialSummary.transaction_count?.toLocaleString() || 0} transactions</div>
            <div>{financialSummary.donation_count?.toLocaleString() || 0} contributions</div>
            <div>{financialSummary.expense_count?.toLocaleString() || 0} expenses</div>
            <div>Activity: {formatDate(financialSummary.earliest_transaction)} - {formatDate(financialSummary.latest_transaction)}</div>
          </div>
        )}
      </div>

      {/* Main Tabs */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e5e5e5', marginBottom: '1rem' }}>
          <button
            onClick={() => setActiveTab('transactions')}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'transactions' ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === 'transactions' ? '#2563eb' : '#666',
              fontWeight: activeTab === 'transactions' ? '600' : '400',
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            Transactions ({summaryStats?.transaction_count.toLocaleString() || 0})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            style={{
              padding: '0.75rem 1.5rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'reports' ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === 'reports' ? '#2563eb' : '#666',
              fontWeight: activeTab === 'reports' ? '600' : '400',
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            Reports & Donations
          </button>
        </div>

        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Campaign Transactions</h2>
              <div ref={transactionDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setTransactionDownloadMenuOpen(!transactionDownloadMenuOpen)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  💰 Download CSV ▼
                </button>
                {transactionDownloadMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.25rem',
                    backgroundColor: 'white',
                    border: '1px solid #e5e5e5',
                    borderRadius: '0.375rem',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    zIndex: 10
                  }}>
                    <button
                      onClick={() => {
                        downloadTransactionsCSV();
                        setTransactionDownloadMenuOpen(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.5rem 1rem',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Download All Transactions
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '0.75rem', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Occupation</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((trans) => (
                    <tr key={trans.transaction_id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                      <td style={{ padding: '0.75rem' }}>{formatDate(trans.transaction_date)}</td>
                      <td style={{ 
                        padding: '0.75rem', 
                        textAlign: 'right',
                        color: trans.transaction_type_disposition_id === 2 ? '#ef4444' : '#10b981'
                      }}>
                        {formatCurrency(trans.amount)}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{trans.transaction_type}</td>
                      <td style={{ padding: '0.75rem' }}>
                        {trans.contributor_name || trans.vendor_name || '—'}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                        {trans.occupation || '—'}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                        {trans.city && trans.state ? `${trans.city}, ${trans.state}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMoreTransactions && (
              <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                <button
                  onClick={() => loadMoreTransactions()}
                  disabled={loadingTransactions}
                  style={{
                    padding: '0.75rem 2rem',
                    backgroundColor: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: loadingTransactions ? 'not-allowed' : 'pointer',
                    opacity: loadingTransactions ? 0.5 : 1
                  }}
                >
                  {loadingTransactions ? 'Loading...' : 'Load More Transactions'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div>
            {/* Sub-tabs for Reports/Donations */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <button
                onClick={() => setReportTab('reports')}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: reportTab === 'reports' ? '#2563eb' : '#e5e5e5',
                  color: reportTab === 'reports' ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}
              >
                Reports ({reports.length})
              </button>
              <button
                onClick={() => setReportTab('donations')}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: reportTab === 'donations' ? '#2563eb' : '#e5e5e5',
                  color: reportTab === 'donations' ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}
              >
                Donations ({summaryStats?.donation_count.toLocaleString() || 0})
              </button>
              
              {/* Download dropdown */}
              <div ref={dropdownRef} style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  onClick={() => setDownloadMenuOpen(!downloadMenuOpen)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  📊 Download CSV ▼
                </button>
                {downloadMenuOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.25rem',
                    backgroundColor: 'white',
                    border: '1px solid #e5e5e5',
                    borderRadius: '0.375rem',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    zIndex: 10
                  }}>
                    <button
                      onClick={() => {
                        downloadReportsCSV();
                        setDownloadMenuOpen(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.5rem 1rem',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.875rem'
                      }}
                    >
                      Download Reports CSV
                    </button>
                    <button
                      onClick={() => {
                        downloadDonationsCSV();
                        setDownloadMenuOpen(false);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '0.5rem 1rem',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.875rem'
                      }}
                    >
                      Download Donations CSV
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reports View */}
            {reportTab === 'reports' && (
              <div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Report Name</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Filing Date</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Period</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>Donations</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>Items</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>PDF</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>CSV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map((report) => (
                        <tr key={report.report_id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                          <td style={{ padding: '0.75rem', fontWeight: '500' }}>{report.report_name}</td>
                          <td style={{ padding: '0.75rem' }}>{formatDate(report.filing_date)}</td>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{report.report_period}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: '#10b981' }}>
                            {formatCurrency(report.total_income || report.total_donations || 0)}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                            {report.donation_count}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                            {report.pdf_url ? (
                              <a
                                href={report.pdf_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#2563eb', textDecoration: 'none' }}
                              >
                                📄 View
                              </a>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                            <button
                              onClick={() => downloadReportDonationsCSV(report.report_id, report.report_name)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#10b981',
                                cursor: 'pointer',
                                fontSize: '0.875rem',
                                padding: 0
                              }}
                            >
                              💾 Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Donations View */}
            {reportTab === 'donations' && (
              <div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Report</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Donor</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Type</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Occupation</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {donations.map((donation) => (
                        <tr key={donation.donation_id} style={{ borderBottom: '1px solid #e5e5e5' }}>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.report_name}</td>
                          <td style={{ padding: '0.75rem' }}>{formatDate(donation.donation_date)}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: '#10b981' }}>
                            {formatCurrency(donation.amount)}
                          </td>
                          <td style={{ padding: '0.75rem' }}>{donation.donor_name}</td>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.donor_type}</td>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                            {donation.occupation || '—'}
                          </td>
                          <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                            {donation.address || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {hasMoreDonations && (
                  <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                    <button
                      onClick={() => loadMoreDonations()}
                      disabled={loadingDonations}
                      style={{
                        padding: '0.75rem 2rem',
                        backgroundColor: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.375rem',
                        cursor: loadingDonations ? 'not-allowed' : 'pointer',
                        opacity: loadingDonations ? 0.5 : 1
                      }}
                    >
                      {loadingDonations ? 'Loading...' : 'Load More Donations'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}