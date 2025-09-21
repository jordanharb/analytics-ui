import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Arizona Campaign Finance Explorer',
  description: 'Search and download campaign finance data from Arizona elections',
  keywords: 'Arizona, campaign finance, elections, candidates, committees, contributions, expenditures',
  authors: [{ name: 'Arizona Campaign Finance Explorer' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        lineHeight: '1.6',
        color: '#333',
        backgroundColor: '#fff',
        margin: 0,
        padding: 0,
      }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <header style={{
            backgroundColor: '#f8f9fa',
            borderBottom: '1px solid #e5e5e5',
            padding: '1rem 0',
          }}>
            <div style={{
              maxWidth: '1200px',
              margin: '0 auto',
              padding: '0 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
            }}>
              <a 
                href="/" 
                style={{
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  textDecoration: 'none',
                  color: '#0066cc',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                🏛️ Arizona Campaign Finance
              </a>
              
              <nav>
                <ul style={{
                  display: 'flex',
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  gap: '1.5rem',
                }}>
                  <li>
                    <a 
                      href="/" 
                      style={{
                        textDecoration: 'none',
                        color: '#4b5563',
                        fontWeight: '500',
                        fontSize: '0.9rem',
                      }}
                    >
                      Search
                    </a>
                  </li>
                  <li>
                    <a 
                      href="/bills" 
                      style={{
                        textDecoration: 'none',
                        color: '#4b5563',
                        fontWeight: '500',
                        fontSize: '0.9rem',
                      }}
                    >
                      Bills
                    </a>
                  </li>
                  <li>
                    <a 
                      href="/bulk" 
                      style={{
                        textDecoration: 'none',
                        color: '#4b5563',
                        fontWeight: '500',
                        fontSize: '0.9rem',
                      }}
                    >
                      Bulk Export
                    </a>
                  </li>
                  <li>
                    <a 
                      href="/reports-chat" 
                      style={{
                        textDecoration: 'none',
                        color: '#4b5563',
                        fontWeight: '500',
                        fontSize: '0.9rem',
                      }}
                    >
                      AI Reports
                    </a>
                  </li>
                  <li>
                    <a 
                      href="/about" 
                      style={{
                        textDecoration: 'none',
                        color: '#4b5563',
                        fontWeight: '500',
                        fontSize: '0.9rem',
                      }}
                    >
                      About
                    </a>
                  </li>
                </ul>
              </nav>
            </div>
          </header>

          {/* Main Content */}
          <main style={{
            flex: 1,
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem 1rem',
            width: '100%',
          }}>
            {children}
          </main>

          {/* Footer */}
          <footer style={{
            backgroundColor: '#f8f9fa',
            borderTop: '1px solid #e5e5e5',
            padding: '1rem 0',
            marginTop: 'auto',
          }}>
            <div style={{
              maxWidth: '1200px',
              margin: '0 auto',
              padding: '0 1rem',
              textAlign: 'center',
              fontSize: '0.875rem',
              color: '#6b7280',
            }}>
              <p style={{ margin: 0 }}>
                Data sourced from the Arizona Secretary of State. 
                This site is not affiliated with any government agency.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}