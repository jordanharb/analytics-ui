import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import './globals.css';

// Import all page components (to be converted)
import HomePage from './HomePage';
import BillsPage from './BillsPage';
import BulkPage from './BulkExportPage';
import ReportsChatPage from './ReportsChatPage';
import AboutPage from './AboutPage';
import CandidatePage from './CandidatePage';
import ReportGeneratorPage from './ReportGeneratorPage';
import DeprecatedReportGeneratorPage from './deprecated_ReportGeneratorPageV2';
import PersonPage from './PersonPage';
import CampaignFinanceChatView from './chat/CampaignFinanceChatView';
import EntityPage from './finance/EntityPage';

const LegislatureApp: React.FC = () => {
  const location = useLocation();
  const isLegislaturePage = location.pathname.startsWith('/legislature');

  if (!isLegislaturePage) return null;

  return (
    <div style={{ fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', lineHeight: '1.6', color: '#333', backgroundColor: '#fff', height: '100vh', overflow: 'hidden' }}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <header style={{ backgroundColor: '#f8f9fa', borderBottom: '1px solid #e5e5e5', padding: '1rem 0' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <Link
              to="/legislature"
              style={{ fontSize: '1.25rem', fontWeight: '700', textDecoration: 'none', color: '#0066cc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              🏛️ Arizona Campaign Finance
            </Link>

            <nav>
              <ul style={{ display: 'flex', listStyle: 'none', margin: 0, padding: 0, gap: '1.5rem' }}>
                <li>
                  <Link to="/legislature" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    Search
                  </Link>
                </li>
                <li>
                  <Link to="/legislature/bills" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    Bills
                  </Link>
                </li>
                <li>
                  <Link to="/legislature/bulk" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    Bulk Export
                  </Link>
                </li>
                <li>
                  <Link to="/legislature/reports-chat" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    AI Assistant
                  </Link>
                </li>
                <li>
                  <Link to="/legislature/report-generator" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    Report Generator
                  </Link>
                </li>
                <li>
                  <Link to="/legislature/about" style={{ textDecoration: 'none', color: '#4b5563', fontWeight: '500', fontSize: '0.9rem' }}>
                    About
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main style={{ flex: 1, maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem', width: '100%', overflowY: 'auto' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/bills" element={<BillsPage />} />
            <Route path="/bulk" element={<BulkPage />} />
            <Route path="/reports-chat" element={<CampaignFinanceChatView />} />
            <Route path="/reports-chat-legacy" element={<ReportsChatPage />} />
            <Route path="/report-generator" element={<ReportGeneratorPage />} />
            <Route path="/report-generator-v2" element={<DeprecatedReportGeneratorPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/candidate/:id" element={<CandidatePage />} />
            <Route path="/person/:id" element={<PersonPage />} />
            <Route path="/finance/entity/:id" element={<EntityPage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer style={{ backgroundColor: '#f8f9fa', borderTop: '1px solid #e5e5e5', padding: '1rem 0', marginTop: 'auto' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 1rem', textAlign: 'center', fontSize: '0.875rem', color: '#6b7280' }}>
            <p style={{ margin: 0 }}>
              Data sourced from the Arizona Secretary of State.
              This site is not affiliated with any government agency.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LegislatureApp;
