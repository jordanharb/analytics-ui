import React from 'react';

const AboutPage: React.FC = () => {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '1.5rem', color: '#1f2937' }}>
        About Arizona Campaign Finance Explorer
      </h1>

      <div style={{ fontSize: '1rem', lineHeight: '1.8', color: '#374151' }}>
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Data Source
          </h2>
          <p style={{ marginBottom: '1rem' }}>
            All campaign finance data is sourced directly from the Arizona Secretary of State's office.
            This includes candidate committees, political action committees (PACs), and other registered
            political entities operating in Arizona.
          </p>
          <p>
            The data is regularly updated to ensure accuracy and completeness. However, there may be
            delays between when reports are filed and when they appear in our system.
          </p>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Features
          </h2>
          <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong>Search:</strong> Find candidates, committees, and PACs by name or keyword
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong>Browse Bills:</strong> Explore legislative bills and voting records
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong>Bulk Export:</strong> Download large datasets for analysis
            </li>
            <li style={{ marginBottom: '0.5rem' }}>
              <strong>AI Reports:</strong> Generate intelligent analysis using artificial intelligence
            </li>
          </ul>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Data Coverage
          </h2>
          <p style={{ marginBottom: '1rem' }}>
            Our database includes:
          </p>
          <ul style={{ listStyle: 'disc', paddingLeft: '1.5rem' }}>
            <li>Campaign finance reports from 2010 to present</li>
            <li>Individual contributions and expenditures</li>
            <li>Committee registrations and terminations</li>
            <li>Legislative bills and voting records</li>
            <li>Legislator profiles and histories</li>
          </ul>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Disclaimer
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
            This website is not affiliated with any government agency or political organization.
            While we strive for accuracy, users should verify important information with official sources.
            The data presented here is for informational purposes only and should not be considered
            legal or financial advice.
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem', color: '#1f2937' }}>
            Contact
          </h2>
          <p>
            For questions, corrections, or technical issues, please contact our support team.
            We appreciate feedback and suggestions for improving this resource.
          </p>
        </section>
      </div>
    </div>
  );
};

export default AboutPage;