import React, { useState, useEffect } from 'react';
import { Table, formatCurrency, formatDate } from '../Table';
import type { Column } from '../Table';
import { Pagination } from '../Pagination';
import { DownloadButton } from '../DownloadButton';
import { fetchEntityTransactions, getEntityTransactionsCSVUrl } from '../../../lib/legislature-api';
import type { EntityTransaction } from '../../../lib/legislature-types';

interface EntityTransactionsTableProps {
  entityId: number;
}

export const EntityTransactionsTable: React.FC<EntityTransactionsTableProps> = ({ entityId }) => {
  const [transactions, setTransactions] = useState<EntityTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const itemsPerPage = 50;

  useEffect(() => {
    loadTransactions();
  }, [entityId, currentPage]);

  const loadTransactions = async () => {
    setIsLoading(true);
    try {
      const response = await fetchEntityTransactions(entityId, {
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage
      });
      
      if (currentPage === 1) {
        setTransactions(response.data);
      } else {
        setTransactions(prev => [...prev, ...response.data]);
      }
      
      setHasMore(response.has_more || false);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const columns: Column<EntityTransaction>[] = [
    {
      key: 'date',
      header: 'Date',
      accessor: (item) => formatDate(item.date),
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
      accessor: (item) => item.type
    },
    {
      key: 'name',
      header: 'Name',
      accessor: (item) => item.name
    },
    {
      key: 'occupation',
      header: 'Occupation',
      accessor: (item) => item.occupation || '-'
    },
    {
      key: 'location',
      header: 'Location',
      accessor: (item) => item.location || '-'
    }
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Transactions</h2>
        <DownloadButton
          url={getEntityTransactionsCSVUrl(entityId)}
          filename={`transactions_${entityId}.csv`}
          label="Export All Transactions"
        />
      </div>

      <Table
        data={transactions}
        columns={columns}
        isLoading={isLoading && currentPage === 1}
        emptyMessage="No transactions found"
      />

      <Pagination
        currentPage={currentPage}
        itemsPerPage={itemsPerPage}
        onPageChange={setCurrentPage}
        hasMore={hasMore}
        isLoading={isLoading}
      />
    </div>
  );
};