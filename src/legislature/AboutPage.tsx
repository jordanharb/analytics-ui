import React from 'react';
import { Link } from 'react-router-dom';

const faqItems = [
  {
    id: 'available-data',
    question: 'What information is available on this platform?',
    answer: (
      <p>
        Use the <Link to="/">Search page</Link> to pull up any legislator, candidate, or committee and open their
        profile. Each profile pulls together every part of the database so you can read transactions (both spending and
        incoming funds), review digitized donation records with the donor’s employer, occupation, and address, grab
        quarterly PDF filings, scan voting history session by session, browse bills with summaries and links to the full
        text, and check sponsorship history. Hop over to the dedicated <Link to="/bills">Bills view</Link> for
        chamber-wide context or use the <Link to="/reports-chat">AI Assistant</Link> when you want to query the same
        data conversationally.
      </p>
    )
  },
  {
    id: 'donor-info',
    question: 'How do I find donor information about a legislator?',
    answer: (
      <p>
        Start from the <Link to="/">Search page</Link>, tap the legislator’s name, and you will land on their detail
        view. The hero area highlights their newest donors and all-time top donors so you can see the biggest names at a
        glance. Scroll down to the Campaign Finance section and expand any committee tied to that person to load its
        Transactions, Donations, and Reports tabs. Transactions list every expenditure and incoming dollar, the
        Donations tab exposes donor occupation, employer, and address, and the Reports tab gives you direct links to the
        filed PDFs. Every table in that section includes a “Download CSV” control in the upper-right corner if you want
        to work in Excel.
      </p>
    )
  },
  {
    id: 'ai-report',
    question: 'How do I run an AI report?',
    answer: (
      <>
        <p>
          Go to the <Link to="/report-generator">Report Generator</Link> tab to choose between the two AI workflows.
          <strong> Theme-Based Analysis</strong> is the interactive option: the system scans all donors tied to your
          selected legislator and clusters them into themes such as real estate developers or healthcare PACs. Each theme
          includes editable search terms (for example, “developer, HOA, property management”), and you can toggle themes
          on or off, rename them, or add your own keywords—try “Colorado River, groundwater, CAP” if you want to zero in
          on water policy donors. <strong>Complete Profile Analysis</strong> is the hands-off mode that reviews every
          donation, vote, and sponsored bill in one pass to surface patterns, outlier votes, and notable funders without
          any manual curation.
        </p>
        <p>
          After selecting a legislator via the search box and picking a legislative session, choose your report type,
          adjust any theme keywords you care about, and click “Generate Report.” Keep the page open while the analysis
          runs. When the narrative appears you can download it as a PDF, and you will also see a chatbot docked on the
          right side of the results page. That chat window is tied to the report you just generated, so you can ask
          follow-up questions like “Which of these bills were vetoed?” or “Show me other votes related to the healthcare
          theme,” and it will cite the relevant passages on the spot.
        </p>
      </>
    )
  },
  {
    id: 'data-updates',
    question: 'How do I update the data for new reporting quarters and legislative sessions?',
    answer: (
      <p>
        Open the <Link to="/scrapers">Scrapers &amp; Workers</Link> page from the side navigation. Two featured cards run
        the automation: “Campaign Finance – Full Update” and “Legislature – Full Update.” Click the play button on the
        Campaign Finance card when a new quarter is released to fetch fresh entities, transactions, PDFs, and donor
        aggregates. Once it reports success, start the Legislature card to grab new sessions, bills, votes, bill text,
        and sponsorships. Both jobs stream progress logs and can run in the background while you browse other tabs, but
        plan for many hours (up to roughly 12 for a full backfill) and avoid launching them simultaneously so nothing
        pauses halfway. When each job finishes, the rest of the app—Search, Bills, profiles, and the Report
        Generator—will automatically reflect the latest filings.
      </p>
    )
  }
];

const AboutPage: React.FC = () => {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1.5rem', color: '#1f2937' }}>
        Frequently Asked Questions
      </h1>
      <div style={{ fontSize: '1rem', lineHeight: 1.8, color: '#374151' }}>
        {faqItems.map((item) => (
          <section key={item.id} id={item.id} style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <a href={`#${item.id}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 700 }}>
                #{item.id}
              </a>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0, color: '#111827' }}>
                {item.question}
              </h2>
            </div>
            {item.answer}
          </section>
        ))}
      </div>
    </div>
  );
};

export default AboutPage;
