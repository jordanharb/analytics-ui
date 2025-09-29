# Gemini AI Output Schemas - Campaign Finance Analysis

This document describes the structured JSON outputs that Gemini AI produces at each step of the campaign finance analysis process. These schemas define exactly what data the AI returns so the application can process it properly.

## Current Active Flow (Theme-Based Analysis)

### Step 1: Theme Generation
**What it does**: Analyzes donor data to identify patterns and group donors into themes (like "Healthcare Industry", "Real Estate Lobby", etc.)

**Input**: List of donors and their donations to a legislator
**Output**: List of donor themes with evidence

```json
{
  "themes": [
    {
      "id": "healthcare-lobby",
      "title": "Healthcare Industry Lobby",
      "description": "Multiple healthcare companies and medical associations donated large amounts during healthcare reform debates. This suggests coordinated industry influence on medical policy.",
      "industry_tags": ["healthcare", "medical", "insurance"],
      "heuristics_used": ["industry_cluster", "timing"],
      "donor_ids": [12345, 67890],
      "donor_names": ["Arizona Medical Association", "Phoenix Healthcare Inc"],
      "donor_totals": [5000.00, 2500.00],
      "evidence": [
        "AMA donated $5,000 on Jan 15, 2021",
        "Phoenix Healthcare gave $2,500 same week"
      ],
      "query_suggestions": ["medical", "healthcare", "insurance", "hospital"],
      "confidence": 0.85
    }
  ]
}
```

**Key Fields Explained**:
- `id`: Computer-friendly name for the theme
- `title`: Human-readable theme name
- `description`: Explanation of why these donors are grouped together
- `industry_tags`: Keywords describing the industry/sector
- `heuristics_used`: Methods used to group donors (timing, industry, geography, etc.)
- `donor_ids`: Database IDs of donors in this theme
- `donor_names`: Human-readable donor names
- `evidence`: Bullet points supporting why this is a theme
- `query_suggestions`: Search terms to find related bills
- `confidence`: How sure the AI is about this theme (0-1 scale)

### Step 2: Query Expansion (Optional)
**What it does**: If a theme doesn't have enough search terms, generates more

**Input**: A theme with fewer than 25 search queries
**Output**: Additional search terms

```json
{
  "queries": [
    "medical malpractice",
    "healthcare reform",
    "insurance regulation",
    "hospital funding"
  ]
}
```

### Step 3: Final Theme Report
**What it does**: After finding related bills, creates a comprehensive report linking donors to specific legislation

**Input**: Theme data + related bills found + voting records
**Output**: Complete analysis report

```json
{
  "report": {
    "overall_summary": "Representative Smith received $50,000 from healthcare donors and consistently voted in favor of industry-friendly bills during the 2021 session. The timing of donations clustered around key healthcare votes suggests potential influence campaigns.",

    "session_info": {
      "session_id": 57,
      "session_name": "2021 Regular Session"
    },

    "themes": [
      {
        "theme": "Healthcare Industry Lobby",
        "description": "Medical industry donors coordinated giving around healthcare reform votes",
        "summary": "15 healthcare donors gave $50,000 total, legislator voted pro-industry on 8/10 bills",
        "confidence": 0.9,

        "donors": [
          {
            "name": "Arizona Medical Association",
            "total": "$5,000",
            "notes": "Gave maximum contribution day before healthcare vote",
            "transaction_ids": ["TXN-2021-001", "TXN-2021-047"],
            "donation_dates": ["2021-03-14", "2021-04-02"],
            "employer": "Medical Association",
            "occupation": "Healthcare Lobby"
          }
        ],

        "queries_used": ["medical", "healthcare", "insurance"],

        "bills": [
          {
            "bill_id": 1234,
            "bill_number": "HB2021",
            "title": "Medical Malpractice Reform Act",
            "reason": "Reduces liability caps benefiting healthcare providers",
            "vote": "Y",
            "stakeholders": ["hospitals", "insurance companies"],
            "takeaways": "Vote saved industry millions in potential liability because Section 12-542.01(A) states 'The total amount of noneconomic damages awarded to all claimants may not exceed two hundred fifty thousand dollars,' directly limiting hospital malpractice exposure per A.R.S. § 12-542.01(A)"
          }
        ]
      }
    ],

    "transactions_cited": [
      {
        "public_transaction_id": 123456789,
        "donor": "Arizona Medical Association",
        "date": "2021-03-14",
        "amount": 5000.00,
        "linked_bills": ["HB2021", "SB1045"]
      }
    ],

    "markdown_summary": "# Healthcare Industry Analysis\n\nRepresentative Smith received significant healthcare industry support during the 2021 session... [COMPREHENSIVE MULTI-PAGE NARRATIVE WITH FULL CITATIONS, STATUTE REFERENCES, BILL EXCERPTS, AND DETAILED ANALYSIS - NO LENGTH LIMITS]"
  }
}
```

**Key Fields Explained**:
- `overall_summary`: High-level findings across all themes
- `session_info`: Which legislative session was analyzed
- `themes`: Detailed breakdown of each donor theme found
  - `donors`: Specific donors with enhanced detail including:
    - `transaction_ids`: Database IDs for each donation for verification
    - `donation_dates`: Exact dates of each contribution
    - `employer` and `occupation`: Additional donor context
    - `notes`: Timing and suspicious patterns
  - `bills`: Specific legislation that benefits these donors
    - `takeaways`: MUST include direct statute citations and exact legal language
  - `queries_used`: Search terms that found the bills
- `transactions_cited`: Individual donations with database IDs for verification
- `markdown_summary`: **COMPREHENSIVE MULTI-PAGE NARRATIVE** with no length restrictions - should include full analysis, all citations, complete statute references, and detailed explanations

## Legacy Flow (Currently Broken - Two-Phase Analysis)

This was the original more detailed approach that's currently not working but could be restored.

### Phase 1: Find Potential Connections
**What it does**: Quickly scans all donations and bills to find possible conflicts of interest without reading full bill text

```json
{
  "session_info": {"session_name": "2021 Regular", "date_range": "Jan-May 2021"},
  "legislator_info": {"name": "John Smith", "party": "R", "district": "15"},

  "potential_groups": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "Healthcare Reform Act",
      "vote_or_sponsorship": "vote",
      "vote_value": "Y",
      "vote_date": "2021-03-15",
      "is_party_outlier": false,

      "donors": [
        {
          "name": "Arizona Medical Association",
          "employer": "Medical Association",
          "occupation": "Lobbyist",
          "type": "PAC",
          "amount": 5000,
          "donation_id": "TXN-2021-001",
          "transaction_date": "2021-01-10",
          "days_from_session": 64
        }
      ],

      "group_reason": "Healthcare donors gave large amounts before healthcare vote",
      "confidence_score": 0.8
    }
  ],

  "summary_stats": {"total_potential_conflicts": 5, "high_confidence": 2}
}
```

### Phase 2: Confirm Connections
**What it does**: Reads full bill text for high-confidence matches to confirm actual conflicts of interest

```json
{
  "confirmed_connections": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "Healthcare Reform Act",

      "donors": [
        {
          "name": "Arizona Medical Association",
          "employer": "Medical Association",
          "occupation": "Lobbyist",
          "type": "PAC",
          "amount": 5000,
          "donation_id": "TXN-2021-001"
        }
      ],

      "total_donor_amount": 5000,
      "vote_or_sponsorship": "vote",
      "vote_value": "Y",

      "key_provisions": [
        "Reduces malpractice liability caps from $1M to $500K",
        "Limits class action lawsuits against hospitals"
      ],

      "explanation": "This bill directly benefits medical providers by reducing their legal liability. The AMA donated $5,000 two months before the vote, which passed by one vote with Smith's support.",

      "confidence": 0.95,
      "severity": "high"
    }
  ]
}
```

**Severity Guidelines**:
- **HIGH**: Clear quid pro quo appearance, votes against party line, major donor benefits
- **MEDIUM**: Clear donor benefit but some public benefit too
- **LOW**: Weak connection, standard industry support

## Technical Notes

- All outputs must be valid JSON (no markdown code blocks or extra text)
- Confidence scores range from 0.0 (no confidence) to 1.0 (completely certain)
- Every bill cited must include specific statute references and bill excerpts
- All financial amounts must include the actual database transaction IDs for verification
- The AI must cite specific evidence (dates, amounts, vote timing) for all claims
- **CRITICAL**: `takeaways` field must always include direct quotes from statutes with proper A.R.S. citations
- **CRITICAL**: `markdown_summary` should be comprehensive with no artificial length limits - use maximum thinking and analysis
- **CRITICAL**: `donors` array must include transaction_ids and donation_dates for each donor for full traceability

## Editing Instructions

Feel free to modify any of these schemas by:
1. Adding new required fields
2. Removing fields you don't need
3. Changing field names to be clearer
4. Adjusting the confidence score ranges
5. Modifying the severity categories
6. Adding validation rules or constraints

Just edit this document and I'll update the code to match your changes.