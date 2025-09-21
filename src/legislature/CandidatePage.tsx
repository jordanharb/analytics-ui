'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase2 as supabase } from '../lib/supabase2';

// Interfaces
interface Entity {
  entity_id: number;
  entity_url?: string;
  primary_candidate_name: string | null;
  primary_committee_name: string | null;
  total_records?: number;
  earliest_activity?: string | null;
  latest_activity?: string | null;
  total_income_all_records?: number;
  total_expense_all_records?: number;
  max_cash_balance?: number;
  primary_record_id?: number;
  party_name?: string | null;
  office_name?: string | null;
}

interface FinancialSummary {
  total_raised: number;
  total_spent: number;
  net_amount: number;
  transaction_count: number;
  donation_count: number;
  expense_count: number;
  earliest_transaction: string | null;
  latest_transaction: string | null;
  largest_donation: number;
  largest_expense: number;
}

interface SummaryStats {
  transaction_count: number;
  total_raised: number;
  total_spent: number;
  report_count: number;
  donation_count: number;
  first_activity: string | null;
  last_activity: string | null;
  cash_on_hand: number;
  largest_donation: number;
  average_donation: number;
}

interface Transaction {
  transaction_id: number;
  transaction_date: string;
  amount: number;
  transaction_type: string;
  transaction_type_disposition_id: number;
  contributor_name: string | null;
  vendor_name: string | null;
  occupation: string | null;
  employer: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  memo: string | null;
  transaction_group_name?: string | null;
  transaction_group_color?: string | null;
  total_count?: number;
}

interface Report {
  report_id: number;
  rpt_title: string;
  rpt_name: string;
  rpt_cycle: number;
  rpt_file_date: string;
  rpt_period: string;
  total_donations: number;
  total_expenditures: number;
  total_income: number;
  donation_count: number;
  cash_balance_beginning: number;
  cash_balance_ending: number;
  report_type: string;
  is_amended: boolean;
  pdf_id?: number | null;
  pdf_url?: string | null;
}

interface Donation {
  donation_id: number;
  report_id: number;
  report_name: string;
  filing_date: string;
  donation_date: string;
  amount: number;
  donor_name: string;
  donor_type: string;
  occupation: string | null;
  employer: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_pac: boolean;
  is_corporate: boolean;
  total_count?: number;
}

// Utility functions
function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '$0';
  return `$${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateString: string | null | undefined): string {
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

function downloadCSV(data: any[], filename: string, columns: { key: string; label: string }[]) {
  if (data.length === 0) {
    console.warn('No data to download');
    return;
  }

  const headers = columns.map(col => col.label).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const value = row[col.key];
      if (value && (value.toString().includes(',') || value.toString().includes('"'))) {
        return `"${value.toString().replace(/"/g, '""')}"`;
      }
      return value || '';
    }).join(',')
  );

  const csv = [headers, ...rows].join('\n');
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

const CandidatePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const entityId = parseInt(id || '0');

  // Entity data state
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
  const [summaryStats, setSummaryStats] = useState<SummaryStats | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  // Transactions state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

  // Donations state
  const [donations, setDonations] = useState<Donation[]>([]);
  const [donationOffset, setDonationOffset] = useState(0);
  const [hasMoreDonations, setHasMoreDonations] = useState(true);
  const [loadingDonations, setLoadingDonations] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<'transactions' | 'reports'>('transactions');
  const [reportTab, setReportTab] = useState<'reports' | 'donations'>('reports');

  const ITEMS_PER_PAGE = 50;

  // Load initial entity data
  useEffect(() => {
    if (entityId) {
      loadEntityData();
    }
  }, [entityId]);

  const loadEntityData = async () => {
    setLoading(true);
    try {
      // Load entity details
      const { data: entityData, error: entityError } = await supabase
        .rpc('get_entity_details', { p_entity_id: entityId });

      if (entityData && entityData.length > 0) {
        setEntity(entityData[0]);
      }

      // Load financial summary
      const { data: financialData, error: financialError } = await supabase
        .rpc('get_entity_financial_summary', { p_entity_id: entityId });

      if (financialData && financialData.length > 0) {
        // Map out_ prefixed columns
        const summary = financialData[0];
        setFinancialSummary({
          total_raised: summary.out_total_raised || summary.total_raised || 0,
          total_spent: summary.out_total_spent || summary.total_spent || 0,
          net_amount: summary.out_net_amount || summary.net_amount || 0,
          transaction_count: summary.out_transaction_count || summary.transaction_count || 0,
          donation_count: summary.out_donation_count || summary.donation_count || 0,
          expense_count: summary.out_expense_count || summary.expense_count || 0,
          earliest_transaction: summary.out_earliest_transaction || summary.earliest_transaction,
          latest_transaction: summary.out_latest_transaction || summary.latest_transaction,
          largest_donation: summary.out_largest_donation || summary.largest_donation || 0,
          largest_expense: summary.out_largest_expense || summary.largest_expense || 0
        });
      }

      // Load summary stats
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_entity_summary_stats', { p_entity_id: entityId });

      if (statsData && statsData.length > 0) {
        const stats = statsData[0];
        setSummaryStats({
          transaction_count: stats.out_transaction_count || stats.transaction_count || 0,
          total_raised: stats.out_total_raised || stats.total_raised || 0,
          total_spent: stats.out_total_spent || stats.total_spent || 0,
          report_count: stats.out_report_count || stats.report_count || 0,
          donation_count: stats.out_donation_count || stats.donation_count || 0,
          first_activity: stats.out_first_activity || stats.first_activity,
          last_activity: stats.out_last_activity || stats.last_activity,
          cash_on_hand: stats.out_cash_on_hand || stats.cash_on_hand || 0,
          largest_donation: stats.out_largest_donation || stats.largest_donation || 0,
          average_donation: stats.out_average_donation || stats.average_donation || 0
        });
      }

      // Load reports
      const { data: reportsData, error: reportsError } = await supabase
        .rpc('get_entity_reports', { p_entity_id: entityId });

      if (reportsData) {
        // Map the reports data to include pdf_url
        const mappedReports = reportsData.map((report: any) => ({
          ...report,
          pdf_url: report.pdf_url || null
        }));
        setReports(mappedReports);
      }

      // Load initial transactions and donations
      await loadMoreTransactions(true);
      await loadMoreDonations(true);

    } catch (error) {
      console.error('Error loading entity data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreTransactions = async (initial = false) => {
    if (loadingTransactions || (!initial && !hasMoreTransactions)) return;

    setLoadingTransactions(true);
    try {
      const offset = initial ? 0 : transactionOffset;
      const { data: txData, error } = await supabase
        .rpc('get_entity_transactions', {
          p_entity_id: entityId,
          p_limit: ITEMS_PER_PAGE,
          p_offset: offset
        });

      if (txData) {
        // Map out_ prefixed columns
        const mappedTransactions = txData.map((tx: any) => ({
          transaction_id: tx.out_transaction_id || tx.transaction_id,
          transaction_date: tx.out_transaction_date || tx.transaction_date,
          amount: tx.out_amount || tx.amount || 0,
          transaction_type: tx.out_transaction_type || tx.transaction_type || '',
          transaction_type_disposition_id: tx.out_transaction_type_disposition_id || tx.transaction_type_disposition_id || 0,
          contributor_name: tx.out_contributor_name || tx.contributor_name,
          vendor_name: tx.out_vendor_name || tx.vendor_name,
          occupation: tx.out_occupation || tx.occupation,
          employer: tx.out_employer || tx.employer,
          city: tx.out_city || tx.city,
          state: tx.out_state || tx.state,
          zip_code: tx.out_zip_code || tx.zip_code,
          memo: tx.out_memo || tx.memo,
          transaction_group_name: tx.out_transaction_group_name || tx.transaction_group_name,
          transaction_group_color: tx.out_transaction_group_color || tx.transaction_group_color,
          total_count: tx.out_total_count || tx.total_count
        }));

        if (initial) {
          setTransactions(mappedTransactions);
          setTransactionOffset(ITEMS_PER_PAGE);
        } else {
          setTransactions(prev => [...prev, ...mappedTransactions]);
          setTransactionOffset(prev => prev + ITEMS_PER_PAGE);
        }

        setHasMoreTransactions(mappedTransactions.length === ITEMS_PER_PAGE);
      }
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoadingTransactions(false);
    }
  };

  const loadMoreDonations = async (initial = false) => {
    if (loadingDonations || (!initial && !hasMoreDonations)) return;

    setLoadingDonations(true);
    try {
      const offset = initial ? 0 : donationOffset;
      const { data: donData, error } = await supabase
        .rpc('get_entity_donations', {
          p_entity_id: entityId,
          p_limit: ITEMS_PER_PAGE,
          p_offset: offset
        });

      if (donData) {
        // Map out_ prefixed columns
        const mappedDonations = donData.map((don: any) => ({
          donation_id: don.out_donation_id || don.donation_id,
          report_id: don.out_report_id || don.report_id,
          report_name: don.out_report_name || don.report_name || '',
          filing_date: don.out_filing_date || don.filing_date,
          donation_date: don.out_donation_date || don.donation_date,
          amount: don.out_amount || don.amount || 0,
          donor_name: don.out_donor_name || don.donor_name || '',
          donor_type: don.out_donor_type || don.donor_type || '',
          occupation: don.out_occupation || don.occupation,
          employer: don.out_employer || don.employer,
          address: don.out_address || don.address,
          city: don.out_city || don.city,
          state: don.out_state || don.state,
          zip: don.out_zip || don.zip,
          is_pac: don.out_is_pac || don.is_pac || false,
          is_corporate: don.out_is_corporate || don.is_corporate || false,
          total_count: don.out_total_count || don.total_count
        }));

        if (initial) {
          setDonations(mappedDonations);
          setDonationOffset(ITEMS_PER_PAGE);
        } else {
          setDonations(prev => [...prev, ...mappedDonations]);
          setDonationOffset(prev => prev + ITEMS_PER_PAGE);
        }

        setHasMoreDonations(mappedDonations.length === ITEMS_PER_PAGE);
      }
    } catch (error) {
      console.error('Error loading donations:', error);
    } finally {
      setLoadingDonations(false);
    }
  };

  const downloadAllTransactions = async () => {
    try {
      const { data: allTx } = await supabase
        .rpc('get_entity_transactions', {
          p_entity_id: entityId,
          p_limit: 10000,
          p_offset: 0
        });

      if (allTx) {
        const mappedData = allTx.map((tx: any) => ({
          Date: formatDate(tx.out_transaction_date || tx.transaction_date),
          Amount: formatCurrency(tx.out_amount || tx.amount),
          Type: tx.out_transaction_type || tx.transaction_type || '',
          Name: tx.out_contributor_name || tx.out_vendor_name || tx.contributor_name || tx.vendor_name || '',
          Occupation: tx.out_occupation || tx.occupation || '',
          Employer: tx.out_employer || tx.employer || '',
          City: tx.out_city || tx.city || '',
          State: tx.out_state || tx.state || '',
          Memo: tx.out_memo || tx.memo || ''
        }));

        downloadCSV(mappedData, `transactions_${entityId}.csv`, [
          { key: 'Date', label: 'Date' },
          { key: 'Amount', label: 'Amount' },
          { key: 'Type', label: 'Type' },
          { key: 'Name', label: 'Name' },
          { key: 'Occupation', label: 'Occupation' },
          { key: 'Employer', label: 'Employer' },
          { key: 'City', label: 'City' },
          { key: 'State', label: 'State' },
          { key: 'Memo', label: 'Memo' }
        ]);
      }
    } catch (error) {
      console.error('Error downloading transactions:', error);
    }
  };

  const downloadAllDonations = () => {
    const mappedData = donations.map(don => ({
      Date: formatDate(don.donation_date),
      Amount: formatCurrency(don.amount),
      Donor: don.donor_name,
      Type: don.donor_type,
      Occupation: don.occupation || '',
      Employer: don.employer || '',
      City: don.city || '',
      State: don.state || '',
      Report: don.report_name
    }));

    downloadCSV(mappedData, `donations_${entityId}.csv`, [
      { key: 'Date', label: 'Date' },
      { key: 'Amount', label: 'Amount' },
      { key: 'Donor', label: 'Donor' },
      { key: 'Type', label: 'Type' },
      { key: 'Occupation', label: 'Occupation' },
      { key: 'Employer', label: 'Employer' },
      { key: 'City', label: 'City' },
      { key: 'State', label: 'State' },
      { key: 'Report', label: 'Report' }
    ]);
  };

  const downloadAllReports = () => {
    const mappedData = reports.map(report => ({
      FilingDate: formatDate(report.rpt_file_date),
      Period: report.rpt_period,
      Type: report.report_type,
      TotalIncome: formatCurrency(report.total_income),
      TotalDonations: formatCurrency(report.total_donations),
      TotalExpenditures: formatCurrency(report.total_expenditures),
      BeginningBalance: formatCurrency(report.cash_balance_beginning),
      EndingBalance: formatCurrency(report.cash_balance_ending),
      DonationCount: report.donation_count,
      IsAmended: report.is_amended ? 'Yes' : 'No'
    }));

    downloadCSV(mappedData, `reports_${entityId}.csv`, [
      { key: 'FilingDate', label: 'Filing Date' },
      { key: 'Period', label: 'Period' },
      { key: 'Type', label: 'Type' },
      { key: 'TotalIncome', label: 'Total Income' },
      { key: 'TotalDonations', label: 'Total Donations' },
      { key: 'TotalExpenditures', label: 'Total Expenditures' },
      { key: 'BeginningBalance', label: 'Beginning Balance' },
      { key: 'EndingBalance', label: 'Ending Balance' },
      { key: 'DonationCount', label: 'Donation Count' },
      { key: 'IsAmended', label: 'Amended' }
    ]);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
        <div style={{ fontSize: '1.2rem', color: '#666' }}>Loading entity data...</div>
      </div>
    );
  }

  if (!entity) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <h2>Entity not found</h2>
      </div>
    );
  }

  const entityName = entity.primary_candidate_name || entity.primary_committee_name || 'Unknown Entity';

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {/* Header Section */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          {entityName}
        </h1>
        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.95rem', color: '#666' }}>
          {entity.party_name && <span>{entity.party_name}</span>}
          {entity.office_name && <span>{entity.office_name}</span>}
          {summaryStats && (
            <span>
              Active: {formatDate(summaryStats.first_activity)} - {formatDate(summaryStats.last_activity)}
            </span>
          )}
        </div>
      </div>

      {/* Financial Summary Cards */}
      {financialSummary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Raised</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#059669' }}>
              {formatCurrency(financialSummary.total_raised)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              {financialSummary.donation_count} donations
            </div>
          </div>

          <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Spent</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc2626' }}>
              {formatCurrency(financialSummary.total_spent)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              {financialSummary.expense_count} expenses
            </div>
          </div>

          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Net Amount</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: financialSummary.net_amount >= 0 ? '#059669' : '#dc2626' }}>
              {formatCurrency(financialSummary.net_amount)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              {financialSummary.transaction_count} transactions
            </div>
          </div>

          {summaryStats && (
            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>Cash on Hand</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#0ea5e9' }}>
                {formatCurrency(summaryStats.cash_on_hand)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                {summaryStats.report_count} reports filed
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <button
            onClick={() => setActiveTab('transactions')}
            style={{
              padding: '0.75rem 0',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'transactions' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'transactions' ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === 'transactions' ? '600' : '400',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Transactions ({transactions[0]?.total_count || summaryStats?.transaction_count || 0})
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            style={{
              padding: '0.75rem 0',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'reports' ? '2px solid #3b82f6' : 'none',
              color: activeTab === 'reports' ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === 'reports' ? '600' : '400',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Reports & Donations
          </button>
        </div>
      </div>

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Transaction History</h3>
            <button
              onClick={downloadAllTransactions}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Download CSV
            </button>
          </div>

          <div style={{ overflowX: 'auto', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Date</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600' }}>Amount</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Type</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Name</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Group</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Location</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.transaction_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{formatDate(tx.transaction_date)}</td>
                    <td style={{
                      padding: '0.75rem',
                      textAlign: 'right',
                      fontSize: '0.875rem',
                      color: tx.transaction_type_disposition_id === 1 ? '#059669' : '#dc2626',
                      fontWeight: '500'
                    }}>
                      {formatCurrency(tx.amount)}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {tx.transaction_type}
                        {tx.transaction_group_name && (
                          <span style={{
                            padding: '0.125rem 0.375rem',
                            backgroundColor: tx.transaction_group_color || '#e5e7eb',
                            borderRadius: '0.25rem',
                            fontSize: '0.625rem',
                            fontWeight: '500',
                            whiteSpace: 'nowrap'
                          }}>
                            {tx.transaction_group_name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      {(() => {
                        const name = tx.contributor_name || tx.vendor_name || '';
                        // If name contains pipes, extract the last part
                        if (name && name.includes('|')) {
                          const parts = name.split('|');
                          return parts[parts.length - 1].trim() || '—';
                        }
                        return name || '—';
                      })()}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      {tx.transaction_group_name && (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: tx.transaction_group_color || '#e5e7eb',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                          fontWeight: '500'
                        }}>
                          {tx.transaction_group_name}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                      {tx.city && tx.state ? `${tx.city}, ${tx.state}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMoreTransactions && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button
                onClick={() => loadMoreTransactions()}
                disabled={loadingTransactions}
                style={{
                  padding: '0.75rem 2rem',
                  backgroundColor: loadingTransactions ? '#9ca3af' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.375rem',
                  cursor: loadingTransactions ? 'not-allowed' : 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                {loadingTransactions ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Reports & Donations Tab */}
      {activeTab === 'reports' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setReportTab('reports')}
                style={{
                  padding: '0.5rem 1rem',
                  background: reportTab === 'reports' ? '#eff6ff' : 'none',
                  border: 'none',
                  borderBottom: reportTab === 'reports' ? '2px solid #3b82f6' : 'none',
                  color: reportTab === 'reports' ? '#3b82f6' : '#6b7280',
                  fontWeight: reportTab === 'reports' ? '500' : '400',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                Reports ({reports.length})
              </button>
              <button
                onClick={() => setReportTab('donations')}
                style={{
                  padding: '0.5rem 1rem',
                  background: reportTab === 'donations' ? '#eff6ff' : 'none',
                  border: 'none',
                  borderBottom: reportTab === 'donations' ? '2px solid #3b82f6' : 'none',
                  color: reportTab === 'donations' ? '#3b82f6' : '#6b7280',
                  fontWeight: reportTab === 'donations' ? '500' : '400',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }}
              >
                Donations ({donations[0]?.total_count || summaryStats?.donation_count || 0})
              </button>
            </div>
          </div>

          {/* Reports Sub-tab */}
          {reportTab === 'reports' && (
            <div>
              <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '600' }}>Filed Reports</h3>
                <button
                  onClick={downloadAllReports}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  Download CSV
                </button>
              </div>

              <div style={{ overflowX: 'auto', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Filing Date</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Period</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600' }}>Total Donations</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: '600' }}>Donations</th>
                      <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: '600' }}>PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.report_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{formatDate(report.rpt_file_date)}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{report.rpt_period}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', color: '#059669' }}>
                          {formatCurrency(report.total_donations)}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem' }}>
                          {report.donation_count}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem' }}>
                          {report.pdf_url ? (
                            <a
                              href={report.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: '#2563eb',
                                textDecoration: 'none'
                              }}
                            >
                              📄 View
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Donations Sub-tab */}
          {reportTab === 'donations' && (
            <div>
              <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: '600' }}>Individual Donations</h3>
                <button
                  onClick={downloadAllDonations}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '0.375rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  Download CSV
                </button>
              </div>

              <div style={{ overflowX: 'auto', backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Date</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', fontWeight: '600' }}>Amount</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Donor</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Type</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Occupation</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Employer</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Address</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: '600' }}>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donations.map((donation) => (
                      <tr key={donation.donation_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{formatDate(donation.donation_date)}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', fontSize: '0.875rem', color: '#059669', fontWeight: '500' }}>
                          {formatCurrency(donation.amount)}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.donor_name}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                          {donation.is_pac ? (
                            <span style={{ color: '#7c3aed' }}>PAC</span>
                          ) : donation.is_corporate ? (
                            <span style={{ color: '#ea580c' }}>Corporate</span>
                          ) : (
                            donation.donor_type
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.occupation || '—'}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.employer || '—'}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>{donation.address || '—'}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.875rem' }}>
                          {donation.city && donation.state ? `${donation.city}, ${donation.state}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMoreDonations && (
                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                  <button
                    onClick={() => loadMoreDonations()}
                    disabled={loadingDonations}
                    style={{
                      padding: '0.75rem 2rem',
                      backgroundColor: loadingDonations ? '#9ca3af' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: loadingDonations ? 'not-allowed' : 'pointer',
                      fontSize: '0.875rem'
                    }}
                  >
                    {loadingDonations ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CandidatePage;