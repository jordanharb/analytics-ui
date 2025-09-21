import React from 'react';

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '800px' }}>
      <h1 style={{
        fontSize: '2rem',
        fontWeight: '700',
        marginBottom: '2rem',
        color: '#1f2937',
      }}>
        About Arizona Campaign Finance Explorer
      </h1>

      {/* Introduction */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Overview
        </h2>
        <p style={{
          fontSize: '1rem',
          lineHeight: '1.8',
          color: '#4b5563',
          marginBottom: '1rem',
        }}>
          The Arizona Campaign Finance Explorer provides easy access to campaign finance data 
          from the Arizona Secretary of State's "See The Money" database. This tool allows you 
          to search for candidates and committees, view their financial reports, and download 
          detailed transaction data for analysis.
        </p>
      </section>

      {/* Data Source */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Data Source
        </h2>
        <div style={{
          padding: '1rem',
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '0.5rem',
        }}>
          <p style={{
            fontSize: '0.95rem',
            lineHeight: '1.6',
            color: '#1e40af',
            margin: 0,
          }}>
            All data is sourced from the official Arizona Secretary of State campaign finance 
            reporting system. The database includes information on:
          </p>
          <ul style={{
            marginTop: '0.75rem',
            marginBottom: 0,
            paddingLeft: '1.5rem',
            color: '#1e40af',
            fontSize: '0.95rem',
            lineHeight: '1.6',
          }}>
            <li>Campaign committees and candidates</li>
            <li>Financial reports and filings</li>
            <li>Individual contributions and expenditures</li>
            <li>PACs and political organizations</li>
          </ul>
        </div>
      </section>

      {/* Features */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Key Features
        </h2>
        <div style={{
          display: 'grid',
          gap: '1rem',
        }}>
          <div style={{
            padding: '1rem',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
          }}>
            <h3 style={{
              fontSize: '1rem',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span>🔍</span> Advanced Search
            </h3>
            <p style={{
              fontSize: '0.9rem',
              color: '#6b7280',
              margin: 0,
            }}>
              Search for candidates and committees using fuzzy matching technology. 
              Find results even with partial names or slight misspellings.
            </p>
          </div>

          <div style={{
            padding: '1rem',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
          }}>
            <h3 style={{
              fontSize: '1rem',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span>📊</span> Comprehensive Data Export
            </h3>
            <p style={{
              fontSize: '0.9rem',
              color: '#6b7280',
              margin: 0,
            }}>
              Download complete datasets in CSV format for analysis in Excel or other tools. 
              Export individual entity data or bulk export multiple entities at once.
            </p>
          </div>

          <div style={{
            padding: '1rem',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
          }}>
            <h3 style={{
              fontSize: '1rem',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span>⚡</span> Fast Performance
            </h3>
            <p style={{
              fontSize: '0.9rem',
              color: '#6b7280',
              margin: 0,
            }}>
              Optimized database queries and caching ensure quick response times. 
              Bulk exports are processed efficiently and cached for repeated requests.
            </p>
          </div>
        </div>
      </section>

      {/* Data Coverage */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Data Coverage
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
        }}>
          <div style={{
            padding: '1rem',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#0066cc',
              marginBottom: '0.25rem',
            }}>
              880+
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: '#6b7280',
            }}>
              Entities Tracked
            </div>
          </div>
          <div style={{
            padding: '1rem',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#16a34a',
              marginBottom: '0.25rem',
            }}>
              1M+
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: '#6b7280',
            }}>
              Transactions
            </div>
          </div>
          <div style={{
            padding: '1rem',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '2rem',
              fontWeight: '700',
              color: '#dc2626',
              marginBottom: '0.25rem',
            }}>
              10K+
            </div>
            <div style={{
              fontSize: '0.9rem',
              color: '#6b7280',
            }}>
              Reports Filed
            </div>
          </div>
        </div>
      </section>

      {/* Known Limitations */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Known Limitations
        </h2>
        <div style={{
          padding: '1rem',
          backgroundColor: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: '0.5rem',
        }}>
          <ul style={{
            margin: 0,
            paddingLeft: '1.5rem',
            fontSize: '0.9rem',
            lineHeight: '1.6',
            color: '#92400e',
          }}>
            <li style={{ marginBottom: '0.5rem' }}>
              Data is updated periodically and may not reflect the most recent filings
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              Transaction previews are limited to 50 most recent entries per entity
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              Bulk exports are limited to {50} entities at a time
            </li>
            <li>
              Some older reports may not have PDF documents available
            </li>
          </ul>
        </div>
      </section>

      {/* Technical Details */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Technical Details
        </h2>
        <p style={{
          fontSize: '0.95rem',
          lineHeight: '1.6',
          color: '#4b5563',
          marginBottom: '1rem',
        }}>
          This application is built with modern web technologies for optimal performance:
        </p>
        <ul style={{
          paddingLeft: '1.5rem',
          fontSize: '0.95rem',
          lineHeight: '1.6',
          color: '#4b5563',
        }}>
          <li><strong>Database:</strong> PostgreSQL with Supabase</li>
          <li><strong>Backend:</strong> Edge Functions for serverless processing</li>
          <li><strong>Frontend:</strong> Next.js 14 with React Server Components</li>
          <li><strong>Search:</strong> PostgreSQL trigram similarity matching</li>
          <li><strong>Export:</strong> Streamed CSV generation with caching</li>
        </ul>
      </section>

      {/* Disclaimer */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Disclaimer
        </h2>
        <div style={{
          padding: '1rem',
          backgroundColor: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '0.5rem',
        }}>
          <p style={{
            fontSize: '0.9rem',
            lineHeight: '1.6',
            color: '#991b1b',
            margin: 0,
          }}>
            This website is an independent project and is not affiliated with, endorsed by, 
            or connected to the Arizona Secretary of State or any government agency. 
            While we strive for accuracy, data may contain errors or omissions. 
            For official records, please visit the Arizona Secretary of State website.
          </p>
        </div>
      </section>

      {/* Contact */}
      <section>
        <h2 style={{
          fontSize: '1.3rem',
          fontWeight: '600',
          marginBottom: '1rem',
          color: '#374151',
        }}>
          Contact & Support
        </h2>
        <p style={{
          fontSize: '0.95rem',
          lineHeight: '1.6',
          color: '#4b5563',
        }}>
          For questions, bug reports, or feature requests, please contact the project maintainers 
          through the GitHub repository. This is an open-source project aimed at improving 
          transparency and accessibility of campaign finance data.
        </p>
      </section>
    </div>
  );
}