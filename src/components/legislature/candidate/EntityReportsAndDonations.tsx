import React, { useState, useEffect } from 'react';
import { Table, TableLink, formatCurrency, formatDate } from '../Table';
import type { Column } from '../Table';
import { Pagination } from '../Pagination';
import { DownloadButton } from '../DownloadButton';
import { fetchEntityReports, fetchEntityDonations, getEntityDonationsCSVUrl, getReportCSVUrl } from '../../../lib/legislature-api';
import type { EntityReport, EntityDonation } from '../../../lib/legislature-types';

interface EntityReportsAndDonationsProps {
  entityId: number;
}

export const EntityReportsAndDonations: React.FC<EntityReportsAndDonationsProps> = ({ entityId }) => {
  const [reports, setReports] = useState<EntityReport[]>([]);
  const [donations, setDonations] = useState<EntityDonation[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [isLoadingDonations, setIsLoadingDonations] = useState(true);
  const [donationsPage, setDonationsPage] = useState(1);
  const [hasMoreDonations, setHasMoreDonations] = useState(false);
  const itemsPerPage = 20;

  useEffect(() => {
    loadReports();
    loadDonations();
  }, [entityId]);

  useEffect(() => {
    if (donationsPage > 1) {
      loadDonations();
    }
  }, [donationsPage]);

  const loadReports = async () => {
    setIsLoadingReports(true);
    try {
      const data = await fetchEntityReports(entityId);
      setReports(data);
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setIsLoadingReports(false);
    }
  };

  const loadDonations = async () => {
    setIsLoadingDonations(true);
    try {
      const response = await fetchEntityDonations(entityId, {
        limit: itemsPerPage,
        offset: (donationsPage - 1) * itemsPerPage
      });
      setDonations(prev => donationsPage === 1 ? response.data : [...prev, ...response.data]);
      setHasMoreDonations(response.has_more || false);
    } catch (error) {
      console.error('Failed to load donations:', error);
    } finally {
      setIsLoadingDonations(false);
    }
  };

  const reportColumns: Column<EntityReport>[] = [
    { key: 'report_name', header: 'Report', accessor: (item) => item.report_name },
    { key: 'filing_date', header: 'Filing Date', accessor: (item) => formatDate(item.filing_date) },
    { key: 'period', header: 'Period', accessor: (item) => `${formatDate(item.period_start)} - ${formatDate(item.period_end)}` },
    { key: 'donations_total', header: 'Total', accessor: (item) => formatCurrency(item.donations_total || 0) },
    { key: 'items_count', header: 'Donations', accessor: (item) => item.items_count?.toLocaleString() || '0' },
    {
      key: 'actions',
      header: ' ',
      accessor: (item) => (
        <div className="flex gap-2 justify-end">
          {item.pdf_url && <a href={item.pdf_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm">PDF</a>}
          {item.csv_url && <DownloadButton url={getReportCSVUrl(item.report_id)} filename={`report_${item.report_id}.csv`} small />}
        </div>
      )
    }
  ];

  const donationColumns: Column<EntityDonation>[] = [
    { key: 'date', header: 'Date', accessor: (item) => formatDate(item.date) },
    { key: 'donor_name', header: 'Donor', accessor: (item) => item.donor_name },
    { key: 'amount', header: 'Amount', accessor: (item) => formatCurrency(item.amount) },
    { key: 'donor_type', header: 'Type', accessor: (item) => item.donor_type },
    { key: 'occupation', header: 'Occupation', accessor: (item) => item.occupation || '-' },
    { key: 'location', header: 'Location', accessor: (item) => item.location || '-' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-4">Filed Reports</h2>
        <Table 
          data={reports} 
          columns={reportColumns} 
          isLoading={isLoadingReports} 
          emptyMessage="No reports found for this entity."
        />
      </div>
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Donations</h2>
          <DownloadButton 
            url={getEntityDonationsCSVUrl(entityId)} 
            filename={`donations_${entityId}.csv`} 
            label="Export All Donations"
          />
        </div>
        <Table 
          data={donations} 
          columns={donationColumns} 
          isLoading={isLoadingDonations && donationsPage === 1} 
          emptyMessage="No donations found for this entity."
        />
        <Pagination 
          currentPage={donationsPage} 
          onPageChange={setDonationsPage} 
          hasMore={hasMoreDonations} 
          isLoading={isLoadingDonations}
          itemsPerPage={itemsPerPage}
        />
      </div>
    </div>
  );
};