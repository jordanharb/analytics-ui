import React, { useState, useEffect } from 'react';
import { 
  fetchPersonFinanceOverview,
  fetchPersonTransactions,
  fetchPersonReports,
  getPersonTransactionsCSVUrl,
  getPersonReportsCSVUrl
} from '../../../lib/legislature-people-api';
import { fetchPersonDonations } from '../../../lib/legislature-api';
import { Table, formatCurrency, formatDate } from '../Table';
import type { Column } from '../Table';
import { DownloadButton } from '../DownloadButton';
import { Tabs } from '../Tabs';
import type { 
  PersonFinanceOverview,
  PersonTransaction,
  PersonReport
} from '../../../lib/legislature-people-types';
import type { PersonDonation } from '../../../lib/legislature-types';

interface Props {
  personId: number;
  entityIds: number[];
}

export const PersonFinance: React.FC<Props> = ({ personId, entityIds }) => {
  const [overview, setOverview] = useState<PersonFinanceOverview | null>(null);
  const [transactions, setTransactions] = useState<PersonTransaction[]>([]);
  const [reports, setReports] = useState<PersonReport[]>([]);
  const [donations, setDonations] = useState<PersonDonation[]>([]);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [isLoadingDonations, setIsLoadingDonations] = useState(false);
  const [transactionPage, setTransactionPage] = useState(1);
  const [donationPage, setDonationPage] = useState(1);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [hasMoreDonations, setHasMoreDonations] = useState(false);

  useEffect(() => {
    loadOverview();
    loadReports();
  }, [personId]);

  const loadOverview = async () => {
    setIsLoadingOverview(true);
    try {
      const data = await fetchPersonFinanceOverview(personId);
      setOverview(data);
    } catch (error) {
      console.error('Failed to load finance overview:', error);
    } finally {
      setIsLoadingOverview(false);
    }
  };

  const loadTransactions = async (reset: boolean = true) => {
    setIsLoadingTransactions(true);
    try {
      const offset = reset ? 0 : (transactionPage - 1) * 50;
      const { data, hasMore } = await fetchPersonTransactions(personId, 50, offset);
      
      if (reset) {
        setTransactions(data);
        setTransactionPage(1);
      } else {
        setTransactions(prev => [...prev, ...data]);
      }
      setHasMoreTransactions(hasMore);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setIsLoadingTransactions(false);
    }
  };

  const loadReports = async () => {
    setIsLoadingReports(true);
    try {
      const data = await fetchPersonReports(personId);
      setReports(data);
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setIsLoadingReports(false);
    }
  };

  const loadDonations = async (reset: boolean = true) => {
    setIsLoadingDonations(true);
    try {
      const offset = reset ? 0 : (donationPage - 1) * 100;
      const { data, has_more } = await fetchPersonDonations(personId, { limit: 100, offset });
      
      if (reset) {
        setDonations(data);
        setDonationPage(1);
      } else {
        setDonations(prev => [...prev, ...data]);
      }
      setHasMoreDonations(has_more || false);
    } catch (error) {
      console.error('Failed to load donations:', error);
    } finally {
      setIsLoadingDonations(false);
    }
  };

  const transactionColumns: Column<PersonTransaction>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (item) => formatDate(item.transaction_date),
      sortable: true
    },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (item) => {
        const isIncome = item.disposition_id === 1;
        return (
          <span className={isIncome ? 'text-green-600' : 'text-red-600'}>
            {formatCurrency(item.amount, false)}
          </span>
        );
      },
      sortable: true
    },
    {
      key: 'type',
      header: 'Type',
      accessor: (item) => item.transaction_type
    },
    {
      key: 'name',
      header: 'Name',
      accessor: (item) => item.name
    },
    {
      key: 'entity',
      header: 'Entity',
      accessor: (item) => (
        <span className="text-sm text-gray-600">{item.entity_name}</span>
      )
    }
  ];

  const reportColumns: Column<PersonReport>[] = [
    {
      key: 'name',
      header: 'Report Name',
      accessor: (item) => item.report_name
    },
    {
      key: 'entity',
      header: 'Entity',
      accessor: (item) => (
        <span className="text-sm text-gray-600">{item.entity_name}</span>
      )
    },
    {
      key: 'filing',
      header: 'Filing Date',
      accessor: (item) => formatDate(item.filing_date)
    },
    {
      key: 'period',
      header: 'Period',
      accessor: (item) => item.period || '-'
    },
    {
      key: 'total',
      header: 'Total Donations',
      accessor: (item) => formatCurrency(item.donations_total || 0, false)
    },
    {
      key: 'pdf',
      header: 'PDF',
      accessor: (item) => item.pdf_url ? (
        <a href={item.pdf_url} target="_blank" rel="noopener noreferrer" 
          className="text-blue-600 hover:text-blue-800">
          View PDF
        </a>
      ) : '-'
    }
  ];

  const donationColumns: Column<PersonDonation>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (item) => formatDate(item.donation_date),
      sortable: true
    },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (item) => (
        <span className="text-green-600">
          {formatCurrency(item.amount, false)}
        </span>
      ),
      sortable: true
    },
    {
      key: 'donor',
      header: 'Donor',
      accessor: (item) => item.donor_name
    },
    {
      key: 'type',
      header: 'Type',
      accessor: (item) => item.donation_type
    },
    {
      key: 'entity',
      header: 'Entity',
      accessor: (item) => item.entity_name
    }
  ];

  if (isLoadingOverview) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!overview || overview.entity_count === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No campaign finance data found for this person.
      </div>
    );
  }

  const tabs = [
    {
      id: 'transactions',
      label: `Transactions (${overview.transaction_count})`,
      content: (
        <div>
          <div className="mb-4 flex justify-end">
            <DownloadButton
              url={getPersonTransactionsCSVUrl(personId, entityIds)}
              filename={`transactions_${personId}.csv`}
              label="Export All Transactions"
            />
          </div>
          {transactions.length === 0 && !isLoadingTransactions ? (
            <div className="text-center py-8 text-gray-500">
              Click "Load Transactions" to view transaction history
            </div>
          ) : (
            <>
              <Table
                data={transactions}
                columns={transactionColumns}
                isLoading={isLoadingTransactions}
                emptyMessage="No transactions found"
              />
              {transactions.length === 0 && (
                <div className="text-center mt-6">
                  <button
                    onClick={() => loadTransactions(true)}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Load Transactions
                  </button>
                </div>
              )}
              {hasMoreTransactions && (
                <div className="text-center mt-6">
                  <button
                    onClick={() => {
                      setTransactionPage(p => p + 1);
                      loadTransactions(false);
                    }}
                    disabled={isLoadingTransactions}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    {isLoadingTransactions ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )
    },
    {
      id: 'reports',
      label: `Reports (${reports.length})`,
      content: (
        <div>
          <div className="mb-4 flex justify-end">
            <DownloadButton
              url={getPersonReportsCSVUrl(personId, entityIds)}
              filename={`reports_${personId}.csv`}
              label="Export All Reports"
            />
          </div>
          <Table
            data={reports}
            columns={reportColumns}
            isLoading={isLoadingReports}
            emptyMessage="No reports found"
          />
        </div>
      )
    },
    {
      id: 'donations',
      label: 'Donations',
      content: (
        <div>
          {donations.length === 0 && !isLoadingDonations ? (
            <div className="text-center py-8 text-gray-500">
              Click "Load Donations" to view donation history
            </div>
          ) : (
            <>
              <Table
                data={donations}
                columns={donationColumns}
                isLoading={isLoadingDonations}
                emptyMessage="No donations found"
              />
              {donations.length === 0 && (
                <div className="text-center mt-6">
                  <button
                    onClick={() => loadDonations(true)}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Load Donations
                  </button>
                </div>
              )}
              {hasMoreDonations && (
                <div className="text-center mt-6">
                  <button
                    onClick={() => {
                      setDonationPage(p => p + 1);
                      loadDonations(false);
                    }}
                    disabled={isLoadingDonations}
                    className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    {isLoadingDonations ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )
    }
  ];

  return (
    <div>
      {/* Finance Overview */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-900">
            {formatCurrency(overview.total_raised, false)}
          </div>
          <div className="text-sm text-green-700">Total Raised</div>
        </div>
        <div className="bg-red-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-900">
            {formatCurrency(overview.total_spent, false)}
          </div>
          <div className="text-sm text-red-700">Total Spent</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-900">
            {overview.entity_count}
          </div>
          <div className="text-sm text-blue-700">
            Campaign {overview.entity_count === 1 ? 'Entity' : 'Entities'}
          </div>
        </div>
      </div>

      {/* Entity Details */}
      {overview.entity_details.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Linked Entities</h4>
          <div className="space-y-2">
            {overview.entity_details.map(entity => (
              <div key={entity.entity_id} className="flex justify-between text-sm">
                <span>{entity.display_name}</span>
                <span className="text-gray-600">
                  Raised: {formatCurrency(entity.total_raised, false)} • 
                  Spent: {formatCurrency(entity.total_spent, false)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs tabs={tabs} defaultTab="transactions" />
    </div>
  );
};