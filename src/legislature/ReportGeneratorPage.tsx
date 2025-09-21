'use client';

import React, { useState } from 'react';
import { supabase2 as supabase } from '../lib/supabase2';
import { GoogleGenerativeAI, SchemaType, type Tool } from '@google/generative-ai';

const GEMINI_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

interface Person {
  person_id: number;
  display_name: string;
  all_session_ids?: number[];
  all_legislator_ids?: number[];
  extra?: string; // Additional info like "3 legis IDs • 2 entities"
}

interface Session {
  id: number;
  name: string;
  dateRange?: string;
  vote_count?: number;
  start_date?: string;
  end_date?: string;
}

interface AnalysisResult {
  sessionName: string;
  report?: any;
  error?: string;
}

const ReportGeneratorPage: React.FC = () => {
  const [currentLegislator, setCurrentLegislator] = useState<string | null>(null);
  const [currentPersonId, setCurrentPersonId] = useState<number | null>(null);
  const [currentLegislatorIds, setCurrentLegislatorIds] = useState<number[]>([]);
  const [currentEntityIds, setCurrentEntityIds] = useState<number[]>([]);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<number[] | string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [autocompleteResults, setAutocompleteResults] = useState<Person[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [searchingLegislator, setSearchingLegislator] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [excludeAnalyzedBills, setExcludeAnalyzedBills] = useState(false);
  const [analyzedBillIds, setAnalyzedBillIds] = useState<number[]>([]);
  const [incrementalStats, setIncrementalStats] = useState<any>(null);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[] | null>(null);
  const [currentStep, setCurrentStep] = useState<'search' | 'sessions' | 'progress' | 'results'>('search');
  const [analysisMode, setAnalysisMode] = useState<'twoPhase' | 'singleCall'>('twoPhase');

  const baseGenerationConfig = {
    temperature: 0.6,
    maxOutputTokens: 8192,
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setError(null);
    if (searchTimeout) clearTimeout(searchTimeout);
    const trimmedValue = value.trim();
    if (trimmedValue.length < 2) {
      setShowAutocomplete(false);
      return;
    }
    const timeout = setTimeout(() => searchCachedLegislators(trimmedValue), 300);
    setSearchTimeout(timeout);
  };

  const searchCachedLegislators = async (term: string) => {
    try {
      // Try different possible search function names
      let data, error;

      // First try the search function that exists in LegislatureApp
      try {
        const result = await supabase.rpc('search_legislators_with_sessions', { p_search_term: term });
        data = result.data;
        error = result.error;
      } catch (firstError) {
        // If that fails, try other possible function names
        console.log('search_legislators_with_sessions not found, trying alternatives...');

        try {
          const result = await supabase.rpc('search_people_with_sessions', { p_q: term, p_limit: 10 });
          data = result.data;
          error = result.error;
        } catch (secondError) {
          // Last resort - direct query to rs_people table
          const result = await supabase
            .from('rs_people')
            .select(`
              person_id,
              display_name,
              rs_person_legislators!inner(legislator_id),
              rs_person_cf_entities(entity_id)
            `)
            .ilike('display_name', `%${term}%`)
            .limit(10);

          if (result.error) throw result.error;

          // Transform the data to match expected format
          data = (result.data || []).map((person: any) => ({
            person_id: person.person_id,
            display_name: person.display_name,
            all_legislator_ids: person.rs_person_legislators?.map((l: any) => l.legislator_id) || [],
            extra: `${person.rs_person_legislators?.length || 0} legis IDs • ${person.rs_person_cf_entities?.length || 0} entities`
          }));
          error = null;
        }
      }

      if (error) throw error;

      // Filter to only show people who have legislator records
      const mappedData = (data || [])
        .filter((item: any) => {
          // Check for legislator IDs in different possible formats
          const legisIds = item.all_legislator_ids?.length || 0;
          const extraText = item.extra || '';
          const legisMatch = extraText.match(/(\d+)\s+legis\s+IDs/);
          const legisCount = legisMatch ? parseInt(legisMatch[1]) : legisIds;
          return legisCount > 0; // Only show people with legislator records
        })
        .map((item: any) => ({
          person_id: item.person_id,
          display_name: item.display_name || item.label,
          extra: item.extra,
          all_legislator_ids: item.all_legislator_ids
        }));

      setAutocompleteResults(mappedData);
      setShowAutocomplete(mappedData.length > 0);
    } catch (error) {
      console.error('Autocomplete error:', error);
      setAutocompleteResults([]);
      setShowAutocomplete(false);
    }
  };

  const selectLegislator = (person: Person) => {
    setSearchTerm(person.display_name);
    setShowAutocomplete(false);
    setCurrentLegislatorIds(person.all_legislator_ids || []);
    searchLegislator(person);
  };

  const searchLegislator = async (selectedPerson?: Person) => {
    const name = selectedPerson?.display_name || searchTerm;
    if (!name) {
      setError('Please enter or select a legislator name');
      return;
    }
    setCurrentLegislatorIds(selectedPerson?.all_legislator_ids || []);
    setCurrentEntityIds([]);
    setSearchingLegislator(true);
    setError(null);
    try {
      let sessions: Session[] = [];
      let personId: number | null = null;
      if (selectedPerson?.person_id) {
        personId = selectedPerson.person_id;

        let sessionRows: any[] = [];
        try {
          const { data: sessionData, error: sessionError } = await supabase.rpc('get_person_sessions', { p_person_id: personId });
          if (sessionError) throw sessionError;
          sessionRows = sessionData || [];
        } catch (sessionError) {
          console.warn('get_person_sessions RPC failed, attempting fallback', sessionError);
          try {
            const { data: altData, error: altError } = await supabase.rpc('get_person_sessions_simple', { p_person_id: personId });
            if (altError) throw altError;
            sessionRows = altData || [];
          } catch (fallbackError) {
            console.warn('Fallback get_person_sessions_simple failed, attempting direct query', fallbackError);
            try {
              const { data: legislatorSessions, error: lsError } = await supabase
                .from('rs_person_legislators')
                .select('session_id')
                .eq('person_id', personId);
              if (lsError) throw lsError;

              const sessionIds = (legislatorSessions || [])
                .map((row: any) => row.session_id)
                .filter((id: any) => typeof id === 'number');

              if (sessionIds.length) {
                const { data: directSessions, error: directError } = await supabase
                  .from('mv_sessions_with_dates')
                  .select('session_id, session_name, year, calculated_start, calculated_end, total_votes, date_range_display')
                  .in('session_id', sessionIds);
                if (directError) throw directError;
                sessionRows = directSessions || [];
              } else {
                sessionRows = [];
              }
            } catch (finalError) {
              console.error('Failed to load sessions for person via all paths', finalError);
              throw finalError;
            }
          }
        }

        const sessionMap = new Map();
        (sessionRows || []).forEach((s: any) => {
          if (!sessionMap.has(s.session_id)) {
            sessionMap.set(s.session_id, {
              id: s.session_id,
              name: s.session_name,
              dateRange: s.date_range_display,
              vote_count: s.vote_count ?? s.total_votes,
              start_date: s.start_date ?? s.calculated_start,
              end_date: s.end_date ?? s.calculated_end
            });
          }
        });
        sessions = Array.from(sessionMap.values());

        // Fetch legislator IDs if not already populated
        try {
          if (!selectedPerson?.all_legislator_ids?.length) {
            const { data: legislatorRows, error: legislatorError } = await supabase
              .from('rs_person_legislators')
              .select('legislator_id')
              .eq('person_id', personId);
            if (!legislatorError && legislatorRows) {
              const uniqueIds = Array.from(new Set(legislatorRows.map((row: any) => Number(row.legislator_id))));
              setCurrentLegislatorIds(uniqueIds);
            }
          } else {
            setCurrentLegislatorIds(Array.from(new Set(selectedPerson.all_legislator_ids)));
          }

          const { data: entityRows, error: entityError } = await supabase
            .from('rs_person_cf_entities')
            .select('entity_id')
            .eq('person_id', personId);
          if (!entityError && entityRows) {
            const entities = Array.from(new Set(entityRows.map((row: any) => Number(row.entity_id))));
            setCurrentEntityIds(entities);
          } else {
            setCurrentEntityIds([]);
          }
        } catch (fetchErr) {
          console.log('Optional legislator/entity lookup failed', fetchErr);
        }
      }
      setCurrentLegislator(name);
      setCurrentPersonId(personId);
      setAvailableSessions(sessions);
      setCurrentStep('sessions');
      if (sessions.length === 1 && personId) {
        checkIncrementalAnalysis(sessions[0].id, personId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search legislator');
    } finally {
      setSearchingLegislator(false);
    }
  };

  const checkIncrementalAnalysis = async (sessionId: number, personId: number) => {
    // Implementation omitted for brevity
  };

  const toggleSession = (sessionId: number | string) => {
    setSelectedSessions((prev) => {
      const exists = prev.includes(sessionId);
      if (exists) return prev.filter((s) => s !== sessionId);
      return [...prev, sessionId];
    });
  };

  const runTwoPhaseAnalysisInternal = async () => {
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: baseGenerationConfig,
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are an investigative journalist. Think exhaustively before replying and use the maximum internal reasoning budget available.' }],
        },
      });

      const results: AnalysisResult[] = [];
      const customBlock = customInstructions.trim()
        ? `================================\nCUSTOM CRITICAL INSTRUCTIONS AND CONTEXT - These Override all other rules:\n${customInstructions}\n================================\n\n`
        : '';

      // Process each selected session
      for (let i = 0; i < selectedSessions.length; i++) {
        const sessionId = selectedSessions[i];
        const isCombined = typeof sessionId === 'string';

        let sessionName: string;
        let startDate: string;
        let endDate: string;
        let sessionIdsForQuery: number[] = [];

        if (isCombined) {
          // Combined analysis - get date range from all selected numeric sessions
          const numericSessions = selectedSessions.filter(s => typeof s === 'number');
          const sessions = availableSessions.filter(s => numericSessions.includes(s.id));

          if (sessions.length === 0) {
            throw new Error('No sessions selected for combined analysis');
          }

          sessionName = 'Combined Sessions';
          startDate = sessions.reduce((earliest, s) =>
            s.start_date && (!earliest || s.start_date < earliest) ? s.start_date : earliest, '');
          endDate = sessions.reduce((latest, s) =>
            s.end_date && (!latest || s.end_date > latest) ? s.end_date : latest, '');
          sessionIdsForQuery = Array.from(new Set(sessions.map(s => s.id).filter((id): id is number => typeof id === 'number')));
        } else {
          const session = availableSessions.find(s => s.id === sessionId);
          if (!session) {
            throw new Error(`Session ${sessionId} not found`);
          }
          sessionName = session.name;
          startDate = session.start_date || '';
          endDate = session.end_date || '';
          sessionIdsForQuery = [session.id];
        }

        if (!startDate || !endDate) {
          throw new Error(`Missing date information for ${sessionName}`);
        }

        if (isCombined) {
          const numericSessions = selectedSessions.filter((s): s is number => typeof s === 'number');
          sessionIdsForQuery = Array.from(new Set(availableSessions
            .filter(s => numericSessions.includes(s.id))
            .map(s => s.id)));
        }

        if (!sessionIdsForQuery.length) {
          throw new Error('No valid session IDs selected for analysis');
        }

        // Add 100 days buffer for donations (as per original analysis.mjs)
        const donationStartDate = new Date(new Date(startDate).getTime() - (100 * 24 * 60 * 60 * 1000));
        const donationEndDate = new Date(new Date(endDate).getTime() + (100 * 24 * 60 * 60 * 1000));

        setProgressText(`Phase 1: Analyzing ${sessionName} - gathering data...`);
        setProgressPercent(10 + (i * 40));

        // Phase 1: Get bills and donations data with error handling
        console.log('Fetching data for:', { currentPersonId, startDate, endDate, donationStartDate: donationStartDate.toISOString().split('T')[0], donationEndDate: donationEndDate.toISOString().split('T')[0] });

        let bills = [];
        let donations = [];

        // Try to get bills data
        try {
          const billsData = await supabase.rpc('get_session_bills', {
            p_person_id: currentPersonId,
            p_session_ids: sessionIdsForQuery
          });

          if (billsData.error) {
            console.error('Bills data error:', billsData.error);
            throw new Error(`Failed to fetch bills: ${billsData.error.message}`);
          }
          bills = (billsData.data || []).map((bill: any) => ({
            ...bill,
            bill_title: bill.bill_title || bill.short_title || bill.description || '',
            vote_value: bill.vote_value || bill.vote,
            is_sponsor: bill.is_sponsor ?? false,
            session_id: bill.session_id ?? sessionIdsForQuery[0],
            is_outlier: bill.is_outlier ?? false,
            party_breakdown: bill.party_breakdown ?? null,
          }));
          console.log(`Found ${bills.length} bills for ${sessionName}`);
        } catch (billsError) {
          throw new Error(`Bills function failed: ${billsError.message || billsError}`);
        }

        // Try to get donations data
        try {
          const donationsData = await supabase.rpc('get_legislator_donations', {
            p_person_id: currentPersonId,
            p_start_date: donationStartDate.toISOString().split('T')[0],
            p_end_date: donationEndDate.toISOString().split('T')[0]
          });

          if (donationsData.error) {
            console.error('Donations data error:', donationsData.error);
            throw new Error(`Failed to fetch donations: ${donationsData.error.message}`);
          }
          donations = donationsData.data || [];
          console.log(`Found ${donations.length} donations for ${sessionName}`);
        } catch (donationsError) {
          throw new Error(`Donations function failed: ${donationsError.message || donationsError}`);
        }

        if (bills.length === 0 && donations.length === 0) {
          throw new Error(`No bills or donations found for ${sessionName}. Check if the person has data for this period.`);
        }

        setProgressText(`Phase 1: Analyzing ${sessionName} - AI analysis...`);
        setProgressPercent(20 + (i * 40));

        const legislatorInfo = {
          name: currentLegislator || 'Unknown legislator',
          legislator_ids: currentLegislatorIds,
          entity_ids: currentEntityIds
        };

        const sessionInfo = {
          session_id: isCombined ? 'combined' : sessionIdsForQuery[0],
          session_name: sessionName,
          date_range: `${startDate} to ${endDate}`,
          ...(isCombined ? { all_session_ids: sessionIdsForQuery } : {})
        };

        const votesForPrompt = bills.map((bill: any) => ({
          bill_id: bill.bill_id ?? bill.id,
          bill_number: bill.bill_number,
          bill_title: bill.bill_title,
          vote_or_sponsorship: bill.is_sponsor ? 'sponsor' : 'vote',
          vote_value: bill.vote_value ?? bill.vote,
          vote_date: bill.vote_date,
          is_party_outlier: bill.is_outlier ?? false,
          party_breakdown: bill.party_breakdown ?? null,
          session_id: bill.session_id
        }));

        const sessionStartDateObj = new Date(startDate);
        const donorRecords = donations.map((donation: any) => {
          const transactionDate = donation.transaction_date || donation.donation_date;
          const amountNumber = Number(donation.amount ?? donation.donation_amt ?? 0);
          const daysFromSession = transactionDate && !Number.isNaN(sessionStartDateObj.getTime())
            ? Math.round((new Date(transactionDate).getTime() - sessionStartDateObj.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          return {
            name: donation.clean_donor_name || donation.donor_name || donation.received_from_or_paid_to || 'Unknown Donor',
            employer: donation.transaction_employer || donation.donor_employer || null,
            occupation: donation.transaction_occupation || donation.donor_occupation || null,
            type: donation.donor_type || donation.entity_type || donation.entity_description || 'Unknown',
            amount: amountNumber,
            donation_id: donation.donation_id || donation.transaction_id || donation.id || null,
            transaction_date: transactionDate,
            days_from_session: daysFromSession,
          };
        });

        const summaryStats = {
          total_donations: donations.length,
          total_votes: bills.length,
          total_sponsorships: bills.filter((bill: any) => bill.is_sponsor).length,
          high_confidence_pairs: 0,
          medium_confidence_pairs: 0,
          low_confidence_pairs: 0
        };

        const datasetJson = JSON.stringify({
          session_info: sessionInfo,
          legislator_info: legislatorInfo,
          votes: votesForPrompt,
          donations: donorRecords,
          summary_stats: summaryStats
        }, null, 2);

        const phase1Prompt = `${customBlock}Phase 1 Prompt Template
This prompt is designed to generate a broad list of potential connections using metadata only.

You are an investigative journalist analyzing potential conflicts of interest between campaign donations and legislative activity. Work only with the structured metadata provided. DO NOT call any other tools or read full bill text during Phase 1.

PHASE 1 OUTPUT REQUIREMENTS:

Create a STRUCTURED JSON output with ALL potential donor-bill pairs:

\`\`\`json
{
  "session_info": ${JSON.stringify(sessionInfo, null, 2)},
  "legislator_info": ${JSON.stringify(legislatorInfo, null, 2)},
  "potential_pairs": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "...",
      "vote_or_sponsorship": "vote/sponsor",
      "vote_value": "Y/N",
      "vote_date": "2021-03-15",
      "is_party_outlier": false,
      "donors": [
        {
          "name": "Donor Name (use clean_donor_name field)",
          "employer": "Employer from employer field",
          "occupation": "Occupation if available",
          "type": "donor_type field (Individual/PAC/etc)",
          "amount": 500,
          "donation_id": "preserve donation_id from input",
          "transaction_date": "2021-01-10",
          "days_from_session": 64
        }
      ],
      "connection_reason": "Why this donor might care about this bill",
      "confidence_score": 0.0-1.0
    }
  ],
  "summary_stats": ${JSON.stringify(summaryStats, null, 2)}
}
\`\`\`

SCORING GUIDELINES:
- High confidence (0.7-1.0): Direct industry match + large donation + close timing OR lobbyist/PAC donor
- Medium confidence (0.4-0.69): Industry overlap OR timing correlation OR high-dollar donor ($1000+)
- Low confidence (0.1-0.39): Weak connection but worth investigating

IMPORTANT:
- Create pairs for EVERY significant donor (>$100) and EVERY vote/sponsorship
- Pay SPECIAL attention to lobbyist donors regardless of amount
- Flag all PAC/Organization donations for scrutiny
- Don't filter yet - include low confidence pairs
- Focus on creating a complete dataset for Phase 2 analysis
- DO NOT call get_bill_details in Phase 1!

DATASETS (JSON):
${datasetJson}

Output ONLY the JSON object that follows the schema above. No prose, no markdown fences, no explanations.`;

        // Phase 1 Gemini API call with better error handling
        let phase1Result, phase1Response;
        try {
          console.log('Calling Gemini API for Phase 1 analysis...');
          phase1Result = await model.generateContent(phase1Prompt);

          if (!phase1Result || !phase1Result.response) {
            throw new Error('No response from Gemini API');
          }

          phase1Response = phase1Result.response.text();
          console.log('Phase 1 response received, length:', phase1Response.length);

          if (!phase1Response) {
            throw new Error('Empty response from Gemini API');
          }
        } catch (geminiError: any) {
          console.error('Gemini API Error:', geminiError);
          if (geminiError.message?.includes('location') || geminiError.message?.includes('region')) {
            throw new Error('Gemini API location error: Try changing your VPN to a supported region (US/EU)');
          } else if (geminiError.message?.includes('quota') || geminiError.message?.includes('limit')) {
            throw new Error('Gemini API quota exceeded. Please check your API key usage limits.');
          } else if (geminiError.message?.includes('API key')) {
            throw new Error('Gemini API key error. Please check your VITE_GOOGLE_API_KEY environment variable.');
          } else {
            throw new Error(`Gemini API error: ${geminiError.message || geminiError}`);
          }
        }

        // Parse Phase 1 results
        let phase1Data;
        try {
          const sanitized = phase1Response
            .replace(/```json\s*|```/g, '')
            .trim();

          const firstBrace = sanitized.indexOf('{');
          const lastBrace = sanitized.lastIndexOf('}');

          if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error('Phase 1 response did not contain a JSON object');
          }

          const jsonSlice = sanitized.slice(firstBrace, lastBrace + 1);
          phase1Data = JSON.parse(jsonSlice);
        } catch (e) {
          throw new Error(`Failed to parse Phase 1 results: ${e}`);
        }

        setProgressText(`Phase 2: Deep dive analysis for ${sessionName}...`);
        setProgressPercent(30 + (i * 40));

        // Phase 2: Deep dive on high-confidence matches
        const potentialPairs: any[] = Array.isArray(phase1Data.potential_pairs) ? phase1Data.potential_pairs : [];
        console.log('Phase 1 potential pairs parsed:', potentialPairs.length);
        const highConfidencePairs = potentialPairs
          .filter((p: any) => Number(p.confidence_score ?? 0) >= 0.5)
          .slice(0, 10); // Limit to top 10
        console.log('Phase 2 candidates (confidence >= 0.5):', highConfidencePairs.length);

        let confirmedConnections: any[] = [];
        let rejectedConnections: any[] = [];

        if (highConfidencePairs.length > 0) {
          // Get full bill details for high-confidence matches
          const billDetailsPromises = highConfidencePairs.map((pair: any) =>
            supabase.rpc('get_bill_details', { p_bill_id: pair.bill_id })
          );

          const billDetailsResults = await Promise.all(billDetailsPromises);

          for (let j = 0; j < highConfidencePairs.length; j++) {
            const pair = highConfidencePairs[j];
            const billDetailResult = billDetailsResults[j];

            console.log('Phase 2 analyzing pair:', {
              bill_id: pair.bill_id,
              bill_number: pair.bill_number,
              confidence: pair.confidence_score,
            });

            if (billDetailResult.error) {
              console.warn(`Failed to get details for bill ${pair.bill_id}:`, billDetailResult.error);
              continue;
            }

            const billDetails = billDetailResult.data?.[0];
            if (!billDetails) continue;

            const donorsForPhase2 = pair.donors?.map((d: any) => ({
              name: d.name,
              employer: d.employer ?? null,
              occupation: d.occupation ?? null,
              type: d.type ?? 'Unknown',
              amount: d.amount,
              donation_id: d.donation_id ?? null
            })) ?? [];

            const voteOrSponsorship = pair.vote_or_sponsorship || (pair.is_sponsor ? 'sponsor' : 'vote');
            const voteValue = pair.vote_value ?? pair.vote ?? null;

        const phase2Prompt = `${customBlock}You are an investigative journalist doing a DEEP DIVE analysis of potential donor-bill connections.

You have been given a list of ${highConfidencePairs.length} potential connections to investigate.

PRIORITY DONORS TO SCRUTINIZE:
- Lobbyists and lobbying firms (check occupation field)
- Political Action Committees (PACs) and organizations
- Major corporate executives, CEOs, presidents (check occupation field)
- High-dollar donors ($500+ for individuals, $1000+ for organizations)
- Interest groups and trade associations
- Donors employed by companies with legislative interests

YOUR MISSION: Validate or reject each connection by examining the actual bill text.

FOR EACH HIGH/MEDIUM CONFIDENCE PAIR:
1. Call get_bill_details with bill_id=<the numeric bill_id from the pairing>
   - Example: get_bill_details with bill_id=69612
2. Analyze if the bill content ACTUALLY benefits the identified donors
3. Look for specific provisions that align with donor interests
4. Confirm or reject the connection based on evidence
5. CRITICAL: Include the bill_id field in your output for each confirmed connection

PAIRING DATA TO ANALYZE:
${JSON.stringify(highConfidencePairs, null, 2)}

OUTPUT FORMAT:
\`\`\`json
{
  "confirmed_connections": [
    {
      "bill_id": 12345,
      "bill_number": "HB1234",
      "bill_title": "...",
      "donors": [
        {
          "name": "string",
          "employer": "string or null",
          "occupation": "string or null",
          "type": "string (Individuals, PACs, etc)",
          "amount": number,
          "donation_id": "string (preserve from input)"
        }
      ],
      "total_donor_amount": 0,
      "vote_or_sponsorship": "vote/sponsor",
      "vote_value": "Y/N",
      "key_provisions": [
        "Specific provision that benefits donor"
      ],
      "explanation": "Detailed explanation of how this bill benefits these specific donors",
      "confidence": 0.9,
      "severity": "high/medium/low"
    }
    /* SEVERITY GUIDELINES:
    - HIGH: Direct quid pro quo appearance, outlier votes against party, major financial benefits to high-dollar/lobbyist donors
    - MEDIUM: Clear benefit to donors but with some public benefit as well
    - LOW: Indirect benefits or benefits that align with stated policy positions

    Pay special attention to:
    - Lobbyists voting on transparency/disclosure bills
    - Organizations/PACs getting regulatory relief
    - High-dollar donors ($1000+) receiving tax benefits
    - Corporate executives getting industry advantages */
  ],
  "rejected_connections": [
    {
      "bill_number": "HB5678",
      "reason_rejected": "Bill text shows no clear benefit to donor interests"
    }
  ],
  "session_summary": "Executive summary of the most egregious conflicts of interest found",
  "key_findings": [
    "Top 3-5 most important discoveries"
  ]
}
\`\`\`

Be thorough but focus on the most suspicious connections.

REMEMBER: When analyzing bill text, pay EXTRA attention to provisions that benefit:
- Lobbyists (transparency rules, access rules, reporting requirements)
- Organizations/PACs that donated
- Industries where high-dollar individual donors work
- Companies led by executive donors

For lobbyist donors: even indirect benefits count (e.g., rules that make their job easier).

${process.env.CUSTOM_INSTRUCTIONS ? `================================
CUSTOM CRITICAL INSTRUCTIONS AND CONTEXT - These Override all other rules:
${process.env.CUSTOM_INSTRUCTIONS}
================================` : ''}`;

            const phase2Result = await model.generateContent(phase2Prompt);
            const phase2Response = phase2Result.response.text();

            try {
              const cleanResponse = phase2Response.replace(/```json\s*|\s*```/g, '').trim();
              const analysis = JSON.parse(cleanResponse);

              const confirmedList = Array.isArray(analysis.confirmed_connections) ? analysis.confirmed_connections : [];
              const rejectedList = Array.isArray(analysis.rejected_connections) ? analysis.rejected_connections : [];

              if (confirmedList.length > 0) {
                confirmedConnections.push({
                  ...pair,
                  analysis: confirmedList[0]
                });
              }

              if (rejectedList.length > 0) {
                rejectedConnections.push({
                  ...pair,
                  analysis: rejectedList[0]
                });
              }
            } catch (e) {
              console.warn(`Failed to parse Phase 2 analysis for bill ${pair.bill_id}:`, e);
            }
          }
        }

        // Compile final report
        const autoHigh = potentialPairs.filter((p: any) => Number(p.confidence_score ?? 0) >= 0.7).length;
        const autoMedium = potentialPairs.filter((p: any) => {
          const score = Number(p.confidence_score ?? 0);
          return score >= 0.4 && score < 0.7;
        }).length;
        const autoLow = potentialPairs.filter((p: any) => Number(p.confidence_score ?? 0) > 0 && Number(p.confidence_score ?? 0) < 0.4).length;

        const phase1Summary = {
          total_donations: Number(phase1Data.summary_stats?.total_donations ?? summaryStats.total_donations) || 0,
          total_votes: Number(phase1Data.summary_stats?.total_votes ?? summaryStats.total_votes) || 0,
          total_sponsorships: Number(phase1Data.summary_stats?.total_sponsorships ?? summaryStats.total_sponsorships) || 0,
          high_confidence_pairs: Number(phase1Data.summary_stats?.high_confidence_pairs ?? autoHigh) || 0,
          medium_confidence_pairs: Number(phase1Data.summary_stats?.medium_confidence_pairs ?? autoMedium) || 0,
          low_confidence_pairs: Number(phase1Data.summary_stats?.low_confidence_pairs ?? autoLow) || 0,
        };

        const mergedSessionInfo = {
          ...sessionInfo,
          ...(typeof phase1Data.session_info === 'object' && phase1Data.session_info !== null ? phase1Data.session_info : {})
        };

        const mergedLegislatorInfo = {
          ...legislatorInfo,
          ...(typeof phase1Data.legislator_info === 'object' && phase1Data.legislator_info !== null ? phase1Data.legislator_info : {})
        };

        const report = {
          sessionName,
          sessionInfo: mergedSessionInfo,
          legislatorInfo: mergedLegislatorInfo,
          dateRange: mergedSessionInfo.date_range || sessionInfo.date_range,
          donationPeriod: `${donationStartDate.toISOString().split('T')[0]} to ${donationEndDate.toISOString().split('T')[0]}`,
          billCount: bills.length,
          donationCount: donations.length,
          totalDonations: donations.reduce((sum: number, d: any) => sum + (Number(d.amount ?? d.donation_amt ?? 0)), 0),
          phase1Matches: potentialPairs.length,
          confirmedConnections,
          rejectedConnections,
          summaryStats: phase1Summary,
          customInstructions: customInstructions || undefined
        };

        results.push({
          sessionName,
          report
        });

        setProgressPercent(70 + (i * 20));
        setProgressText(`Completed analysis for ${sessionName}`);
      }

      setAnalysisResults(results);
      setProgressPercent(100);
      setProgressText('Analysis complete');
      setCurrentStep('results');
    } catch (analysisError: any) {
      console.error('Analysis error:', analysisError);
      throw analysisError;
    }
  };

  const runSingleCallAnalysis = async (generationConfig: typeof baseGenerationConfig) => {
    if (!GEMINI_API_KEY) throw new Error('Missing Gemini API key');

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    const availableFunctions: Record<string, {
      description: string;
      parameters: any;
      handler: (args: any) => Promise<any>;
    }> = {
      resolve_legislator: {
        description: 'Resolve a legislator name to their internal IDs and associated entities.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Full legislator name' }
          },
          required: ['name']
        },
        handler: async (args: any) => {
          const { data, error } = await supabase.rpc('resolve_lawmaker_with_entities', { p_name: args.name });
          if (error) throw error;
          return data || [];
        }
      },
      get_sessions: {
        description: 'Fetch all legislative sessions with calculated date ranges.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: []
        },
        handler: async () => {
          const { data, error } = await supabase.rpc('get_session_dates_calculated');
          if (error) throw error;
          return data || [];
        }
      },
      get_votes: {
        description: 'Retrieve voting records for given legislator IDs and optional session IDs.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            legislator_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: 'Array of legislator IDs'
            },
            session_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: 'Optional array of session IDs',
              nullable: true
            }
          },
          required: ['legislator_ids']
        },
        handler: async (args: any) => {
          const payload: any = {
            p_legislator_ids: args.legislator_ids,
            p_session_ids: args.session_ids ?? null
          };
          const { data, error } = await supabase.rpc('votes_with_party_outliers', payload);
          if (error) throw error;
          return data || [];
        }
      },
      get_donations: {
        description: 'Retrieve donations for campaign entities, optionally scoped to sessions.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            entity_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: 'Array of entity IDs'
            },
            session_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: 'Optional session IDs for filtering',
              nullable: true
            }
          },
          required: ['entity_ids']
        },
        handler: async (args: any) => {
          const { data, error } = await supabase.rpc('get_donations_with_relevance', {
            p_entity_ids: args.entity_ids,
            p_session_ids: args.session_ids ?? null
          });
          if (error) throw error;
          return data || [];
        }
      },
      get_sponsorships: {
        description: 'Retrieve bill sponsorships for legislators.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            legislator_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER }
            },
            session_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              nullable: true
            }
          },
          required: ['legislator_ids']
        },
        handler: async (args: any) => {
          const { data, error } = await supabase.rpc('bill_sponsorships_for_legislator', {
            p_legislator_ids: args.legislator_ids,
            p_session_ids: args.session_ids ?? null
          });
          if (error) throw error;
          return data || [];
        }
      },
      get_bill_details: {
        description: 'Fetch full bill text and summary for a given bill ID.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            bill_id: { type: SchemaType.NUMBER }
          },
          required: ['bill_id']
        },
        handler: async (args: any) => {
          const { data, error } = await supabase.rpc('get_bill_details', { p_bill_id: args.bill_id });
          if (error) throw error;
          return data?.[0] || null;
        }
      },
      get_bill_rts: {
        description: 'Request-to-Speak positions for a bill.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            bill_id: { type: SchemaType.NUMBER }
          },
          required: ['bill_id']
        },
        handler: async (args: any) => {
          try {
            const { data, error } = await supabase.rpc('get_bill_rts', { p_bill_id: args.bill_id });
            if (error) throw error;
            return data || [];
          } catch (rpcError: any) {
            console.warn('get_bill_rts RPC failed, attempting direct table query', rpcError);
            try {
              const { data: directData, error: directError } = await supabase
                .from('rts_positions')
                .select('position_id, entity_name, representing, "position", submitted_date')
                .eq('bill_id', args.bill_id)
                .order('submitted_date', { ascending: false });
              if (directError) throw directError;
              return directData || [];
            } catch (tableError) {
              console.error('Failed to load RTS positions for bill', args.bill_id, tableError);
              return [];
            }
          }
        }
      }
    };

    const toolDeclarations: Tool[] = [{
      functionDeclarations: Object.entries(availableFunctions).map(([name, config]) => ({
        name,
        description: config.description,
        parameters: config.parameters
      }))
    }];

    let numericSessions = selectedSessions.filter((s): s is number => typeof s === 'number');
    if (!numericSessions.length && selectedSessions.includes('combined')) {
      numericSessions = availableSessions.map(s => s.id);
    }
    const sessionMetadata = availableSessions
      .filter(s => numericSessions.includes(s.id))
      .map(s => ({
        id: s.id,
        name: s.name,
        start_date: s.start_date,
        end_date: s.end_date,
        vote_count: s.vote_count
      }));

    const combinedSessionRange = sessionMetadata.reduce<{ start?: string; end?: string }>((acc, session) => {
      if (session.start_date && (!acc.start || session.start_date < acc.start)) acc.start = session.start_date;
      if (session.end_date && (!acc.end || session.end_date > acc.end)) acc.end = session.end_date;
      return acc;
    }, {});

    setProgressText('Single-pass analysis: compiling baseline dataset...');
    setProgressPercent(10);

    const legislatorInfo = {
      name: currentLegislator || 'Unknown legislator',
      legislator_ids: currentLegislatorIds,
      entity_ids: currentEntityIds
    };

    const baselineSessions: any[] = [];
    const sessionCache = new Map<number, Session>();
    availableSessions.forEach((s) => {
      if (typeof s.id === 'number') {
        sessionCache.set(s.id, s);
      }
    });

    const fetchSessionMeta = async (sessionId: number): Promise<Session | null> => {
      if (sessionCache.has(sessionId)) {
        return sessionCache.get(sessionId) || null;
      }

      const { data, error } = await supabase
        .from('mv_sessions_with_dates')
        .select('session_id, session_name, calculated_start, calculated_end, total_votes, date_range_display')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (error) {
        console.warn('Unable to fetch metadata for session', sessionId, error);
        return null;
      }

      if (!data) return null;

      const meta: Session = {
        id: data.session_id,
        name: data.session_name,
        dateRange: data.date_range_display,
        vote_count: data.total_votes,
        start_date: data.calculated_start,
        end_date: data.calculated_end,
      };

      sessionCache.set(sessionId, meta);
      return meta;
    };

    for (let i = 0; i < selectedSessions.length; i++) {
      const selection = selectedSessions[i];
      const isCombined = typeof selection === 'string';

      let sessionName: string;
      let startDate: string;
      let endDate: string;
      let sessionIdsForQuery: number[] = [];

      if (isCombined) {
        const combinedNumeric = selectedSessions.filter((s): s is number => typeof s === 'number');
        const combinedSessions = (await Promise.all(combinedNumeric.map(fetchSessionMeta))).filter((s): s is Session => !!s);

        if (combinedSessions.length === 0) {
          throw new Error('No sessions selected for combined analysis');
        }

        sessionName = 'Combined Sessions';
        startDate = combinedSessions.reduce((earliest, s) =>
          s.start_date && (!earliest || s.start_date < earliest) ? s.start_date : earliest, '');
        endDate = combinedSessions.reduce((latest, s) =>
          s.end_date && (!latest || s.end_date > latest) ? s.end_date : latest, '');
        sessionIdsForQuery = Array.from(new Set(combinedSessions.map(s => s.id)));
      } else {
        const session = await fetchSessionMeta(selection);
        if (!session) {
          throw new Error(`Session ${selection} not found`);
        }
        sessionName = session.name;
        startDate = session.start_date || '';
        endDate = session.end_date || '';
        sessionIdsForQuery = [session.id];
      }

      if (isCombined) {
        const combinedNumeric = selectedSessions.filter((s): s is number => typeof s === 'number');
        sessionIdsForQuery = Array.from(new Set(
          await Promise.all(combinedNumeric.map(async (id) => {
            const session = await fetchSessionMeta(id);
            return session?.id;
          }))
        )).filter((id): id is number => typeof id === 'number');

        if (!sessionIdsForQuery.length) {
          // fallback to all known sessions
          sessionIdsForQuery = Array.from(sessionCache.keys());
        }
      }

      if (!startDate || !endDate) {
        throw new Error(`Missing date information for ${sessionName}`);
      }

      if (!sessionIdsForQuery.length) {
        throw new Error('No valid session IDs selected for analysis');
      }

      const donationStartDate = new Date(new Date(startDate).getTime() - (100 * 24 * 60 * 60 * 1000));
      const donationEndDate = new Date(new Date(endDate).getTime() + (100 * 24 * 60 * 60 * 1000));

      setProgressText(`Single-pass baseline: ${sessionName}`);
      setProgressPercent((prev) => Math.min(55, prev + 8));

      let bills: any[] = [];
      let donations: any[] = [];

      try {
        const billsData = await supabase.rpc('get_session_bills', {
          p_person_id: currentPersonId,
          p_session_ids: sessionIdsForQuery
        });
        if (billsData.error) throw billsData.error;
        bills = (billsData.data || []).map((bill: any) => ({
          ...bill,
          bill_title: bill.bill_title || bill.short_title || bill.description || '',
          vote_value: bill.vote_value || bill.vote,
          is_sponsor: bill.is_sponsor ?? false,
          session_id: bill.session_id ?? sessionIdsForQuery[0],
          is_outlier: bill.is_outlier ?? false,
          party_breakdown: bill.party_breakdown ?? null,
        }));
      } catch (billError: any) {
        throw new Error(`Failed to fetch bills for ${sessionName}: ${billError.message || billError}`);
      }

      try {
        const donationsData = await supabase.rpc('get_legislator_donations', {
          p_person_id: currentPersonId,
          p_start_date: donationStartDate.toISOString().split('T')[0],
          p_end_date: donationEndDate.toISOString().split('T')[0]
        });
        if (donationsData.error) throw donationsData.error;
        donations = donationsData.data || [];
      } catch (donationError: any) {
        throw new Error(`Failed to fetch donations for ${sessionName}: ${donationError.message || donationError}`);
      }

      const baselineVotes = bills.map((bill: any) => ({
        bill_id: bill.bill_id ?? bill.id,
        bill_number: bill.bill_number,
        bill_title: bill.bill_title,
        vote_or_sponsorship: bill.is_sponsor ? 'sponsor' : 'vote',
        vote_value: bill.vote_value ?? bill.vote,
        vote_date: bill.vote_date,
        is_party_outlier: bill.is_outlier ?? false,
        party_breakdown: bill.party_breakdown ?? null,
        session_id: bill.session_id
      }));

      const sessionStartDateObj = new Date(startDate);
      const baselineDonations = (donations || []).map((donation: any) => {
        const transactionDate = donation.transaction_date || donation.donation_date;
        const amountNumber = Number(donation.amount ?? donation.donation_amt ?? 0);
        const daysFromSession = transactionDate && !Number.isNaN(sessionStartDateObj.getTime())
          ? Math.round((new Date(transactionDate).getTime() - sessionStartDateObj.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          name: donation.clean_donor_name || donation.donor_name || donation.received_from_or_paid_to || 'Unknown Donor',
          employer: donation.transaction_employer || donation.donor_employer || null,
          occupation: donation.transaction_occupation || donation.donor_occupation || null,
          type: donation.donor_type || donation.entity_type || donation.entity_description || 'Unknown',
          amount: amountNumber,
          donation_id: donation.donation_id || donation.transaction_id || donation.id || null,
          transaction_date: transactionDate,
          days_from_session: daysFromSession,
        };
      });

      const summaryStats = {
        total_bills: bills.length,
        total_donations: donations.length,
        total_sponsorships: bills.filter((bill: any) => bill.is_sponsor).length,
        outlier_votes: bills.filter((bill: any) => bill.is_outlier).length,
      };

      const sessionInfo = {
        session_id: isCombined ? 'combined' : sessionIdsForQuery[0],
        session_name: sessionName,
        date_range: `${startDate} to ${endDate}`,
        ...(isCombined ? { all_session_ids: sessionIdsForQuery } : {})
      };

      baselineSessions.push({ session_info: sessionInfo, votes: baselineVotes, donations: baselineDonations, summary: summaryStats });
    }

    const initialDataset = {
      legislator_info: legislatorInfo,
      sessions: baselineSessions,
    };

    const datasetJson = JSON.stringify(initialDataset, null, 2);

    setProgressText('Single-pass analysis: instructing Gemini to gather data...');
    setProgressPercent(60);

    const customBlockSingle = customInstructions.trim()
      ? `================================\nCUSTOM CRITICAL INSTRUCTIONS AND CONTEXT - These Override all other rules:\n${customInstructions}\n================================\n\n`
      : '';

    const singlePrompt = `${customBlockSingle}Single-Pass Investigative Analysis\n\n` +
      `You are an investigative journalist investigating links between campaign donors and legislative activity for ${currentLegislator}.\n` +
      `You may call the provided tools (resolve_legislator, get_sessions, get_votes, get_donations, get_sponsorships, get_bill_details, get_bill_rts).\n` +
      `Always cite evidence directly from bill details and RTS positions when making claims.\n` +
      `Focus on identifying THEMES tying donors to bills, rather than individual donor-bill pairs.\n` +
      `For each theme, list every relevant bill and every related donor exhaustively.\n` +
      `Selected sessions: ${JSON.stringify(sessionMetadata)}. Combined range: ${combinedSessionRange.start || 'unknown'} to ${combinedSessionRange.end || 'unknown'}.\n` +
      `Baseline dataset for reference (metadata only):\n\`\`\`json\n${datasetJson}\n\`\`\`\n` +
      `If you need additional data, call the appropriate tool. Once confident, produce the final structured report.\n\n` +
      `OUTPUT FORMAT (JSON):\n` +
      `\`\`\`json\n` +
      `{
  "session_info": {
    "selected_session_ids": ${JSON.stringify(numericSessions)},
    "combined_range": "${(combinedSessionRange.start || 'unknown')} to ${(combinedSessionRange.end || 'unknown')}"
  },
  "overall_summary": "Concise overview of the most important findings.",
  "themes": [
    {
      "theme": "Short label for the theme",
      "description": "Explain how this theme ties donors to legislation.",
      "confidence": 0.0,
      "evidence_summary": "Narrative citing key points.",
      "bills": [
        {
          "bill_id": 0,
          "bill_number": "HB1234",
          "bill_title": "...",
          "vote_value": "Y/N",
          "is_outlier": false,
          "citations": ["Quoted passage or section from the bill text"],
          "rts_positions": ["Summaries of relevant RTS testimonies"],
          "analysis": "Explain why this bill matters for the theme."
        }
      ],
      "donors": [
        {
          "name": "Donor name",
          "employer": "Employer",
          "occupation": "Occupation",
          "type": "Individual/PAC/etc",
          "total_amount": 0,
          "donation_ids": ["..."],
          "notes": "Why this donor aligns with the theme"
        }
      ]
    }
  ],
  "data_sources": [
    "List every tool output you relied on"
  ]
}
\`\`\`\n` +
      `Return ONLY that JSON object.`;

    setProgressText('Single-pass analysis: instructing Gemini to gather data...');
    setProgressPercent((prev) => Math.max(prev, 65));

    const executeTool = async (name: string, args: any) => {
      const fn = availableFunctions[name];
      if (!fn) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return fn.handler(args || {});
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: singlePrompt }]
      }
    ];

    const sendToGemini = async () => {
      const body = {
        contents,
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are an investigative journalist. Use the maximum available thinking budget before delivering conclusions.' }]
        },
        tools: toolDeclarations,
        generationConfig: {
          temperature: baseGenerationConfig.temperature,
          maxOutputTokens: baseGenerationConfig.maxOutputTokens,
        },
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini error: ${res.status} ${text}`);
      }

      return res.json();
    };

    let data = await sendToGemini();
    let candidate = data?.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new Error('Gemini returned no content for single-pass analysis.');
    }

    let parts = candidate.content.parts;
    contents.push({ role: 'model', parts });

    let functionCalls = parts.filter((part: any) => part.functionCall).map((part: any) => part.functionCall);

    while (true) {
      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      for (const call of functionCalls) {
        setProgressText(`Executing tool: ${call.name}`);
        setProgressPercent((prev) => Math.min(90, prev + 3));
        try {
          const toolResult = await executeTool(call.name, call.args || {});
          contents.push({
            role: 'user',
            parts: [{ text: `TOOL_RESPONSE ${call.name} ${JSON.stringify(toolResult)}` }]
          });
        } catch (toolError: any) {
          contents.push({
            role: 'user',
            parts: [{ text: `TOOL_RESPONSE ${call.name} {"error": ${JSON.stringify(String(toolError))}}` }]
          });
        }
      }

      data = await sendToGemini();
      candidate = data?.candidates?.[0];
      if (!candidate?.content?.parts) {
        throw new Error('Gemini returned no content after tool execution.');
      }

      parts = candidate.content.parts;
      contents.push({ role: 'model', parts });
      functionCalls = parts.filter((part: any) => part.functionCall).map((part: any) => part.functionCall);
    }

    let finalText = '';
    const textParts = parts.filter((part: any) => part.text).map((part: any) => part.text);
    finalText = textParts.join('\n').trim();

    if (!finalText) {
      throw new Error('Single-call analysis did not return any content.');
    }

    const sanitized = finalText.replace(/```json\s*|```/g, '').trim();
    const firstBrace = sanitized.indexOf('{');
    const lastBrace = sanitized.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('Single-call response did not contain a JSON object.');
    }

    const jsonSlice = sanitized.slice(firstBrace, lastBrace + 1);
    const report = JSON.parse(jsonSlice);

    const summaryName = analysisMode === 'singleCall' && selectedSessions.length > 1
      ? 'Combined Single-Pass Analysis'
      : (availableSessions.find(s => s.id === selectedSessions[0])?.name || 'Single-Pass Analysis');

    setAnalysisResults([{ sessionName: summaryName, report }]);
    setProgressPercent(100);
    setProgressText('Single-pass analysis complete');
    setCurrentStep('results');
  };

  const startAnalysis = async () => {
    if (selectedSessions.length === 0) {
      alert('Please select at least one session or the combined option');
      return;
    }

    if (!GEMINI_API_KEY) {
      setError('Missing Gemini API key. Please set VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY in environment variables.');
      return;
    }

    if (!currentPersonId) {
      setError('No person selected for analysis');
      return;
    }

    setCurrentStep('progress');
    setAnalyzing(true);
    setProgressText('Starting analysis...');
    setProgressPercent(5);
    setError(null);

    try {
      if (analysisMode === 'singleCall') {
        await runSingleCallAnalysis(baseGenerationConfig);
      } else {
        await runTwoPhaseAnalysisInternal();
      }
    } catch (analysisError: any) {
      console.error('Analysis error:', analysisError);
      setError(analysisError.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Campaign Finance Report Generator</h1>
      <p style={{ marginBottom: 24, color: '#555' }}>
        Generate detailed analyses of potential conflicts of interest between campaign donations and legislative activity.
        Select a legislator, choose sessions, and let the AI perform a two-phase analysis.
      </p>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {/* Search section */}
      {currentStep === 'search' && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Search for a legislator</label>
          <input
            type="text"
            value={searchTerm}
            onChange={handleInputChange}
            placeholder="Type a legislator's name..."
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
          {showAutocomplete && autocompleteResults.length > 0 && (
            <div style={{ border: '1px solid #eee', borderTop: 'none', borderRadius: '0 0 6px 6px', backgroundColor: '#fff' }}>
              {autocompleteResults.map((p) => (
                <div
                  key={p.person_id}
                  onClick={() => selectLegislator({
                    person_id: p.person_id,
                    display_name: p.display_name,
                    extra: p.extra
                  })}
                  style={{
                    padding: 8,
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    ':hover': { backgroundColor: '#f9f9f9' }
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.display_name}</div>
                  {p.extra && <div style={{ fontSize: '0.8em', color: '#666' }}>{p.extra}</div>}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => searchLegislator()}
            disabled={searchingLegislator}
            style={{ marginTop: 12, padding: '8px 16px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            {searchingLegislator ? 'Searching...' : 'Select Legislator'}
          </button>
        </div>
      )}

      {/* Sessions selection */}
      {currentStep === 'sessions' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600 }}>Available Sessions {currentLegislator ? `for ${currentLegislator}` : ''}</div>
            <button
              onClick={() => setCurrentStep('search')}
              style={{ padding: '4px 8px', fontSize: '0.9em', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              ← Change Person
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                checked={analysisMode === 'twoPhase'}
                onChange={() => setAnalysisMode('twoPhase')}
              />
              <span>Two-Phase (pairs + deep dives)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio"
                checked={analysisMode === 'singleCall'}
                onChange={() => setAnalysisMode('singleCall')}
              />
              <span>Single Call (themes & bill evidence)</span>
            </label>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {availableSessions.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedSessions.includes(s.id)}
                  onChange={() => toggleSession(s.id)}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: '0.9em', color: '#666' }}>{s.dateRange || `${s.start_date || ''} to ${s.end_date || ''}`}</div>
                  {typeof s.vote_count === 'number' && (
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{s.vote_count} votes</div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {availableSessions.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={selectedSessions.includes('combined')}
                onChange={() => toggleSession('combined')}
              />
              <div>
                <div style={{ fontWeight: 600 }}>Combined Analysis</div>
                <div style={{ fontSize: '0.9em', color: '#666' }}>Analyze all selected sessions together</div>
              </div>
            </label>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button
              onClick={startAnalysis}
              disabled={selectedSessions.length === 0 || analyzing}
              style={{ padding: '10px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              {analyzing ? 'Starting...' : 'Start Analysis'}
            </button>
            <button
              onClick={() => setCurrentStep('search')}
              style={{ padding: '10px 20px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              Back to Search
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {currentStep === 'progress' && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Analysis Progress</h3>
          <div style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ marginTop: 12, color: '#555' }}>{progressText}</div>
        </div>
      )}

      {/* Results */}
      {currentStep === 'results' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Analysis Results</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setCurrentStep('sessions')}
                style={{ padding: '6px 12px', fontSize: '0.9em', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                ← New Analysis
              </button>
              <button
                onClick={() => setCurrentStep('search')}
                style={{ padding: '6px 12px', fontSize: '0.9em', background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                ← Change Person
              </button>
            </div>
          </div>
          {(analysisResults ?? []).map((result, idx) => (
            <div key={idx} style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16, backgroundColor: '#fafafa' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{result.sessionName}</h3>

              {typeof result.report === 'object' && result.report ? (
                Array.isArray(result.report?.themes) ? (
                  <>
                    <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0f0f0', borderRadius: 6 }}>
                      {result.report.overall_summary && (
                        <div><strong>Overall Summary:</strong> {result.report.overall_summary}</div>
                      )}
                      {result.report.session_info && (
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                          <strong>Session Info:</strong> {JSON.stringify(result.report.session_info)}
                        </div>
                      )}
                    </div>

                    {(result.report.themes || []).map((theme: any, themeIdx: number) => (
                      <div key={themeIdx} style={{ marginBottom: 16, padding: 12, border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{theme.theme}</h4>
                        {theme.description && <div style={{ color: '#374151', marginBottom: 6 }}>{theme.description}</div>}
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Confidence: {(Number(theme.confidence ?? 0) * 100).toFixed(0)}%</div>

                        <div style={{ marginBottom: 8 }}>
                          <strong>Bills ({theme.bills?.length || 0}):</strong>
                          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                            {(theme.bills || []).map((bill: any, billIdx: number) => (
                              <li key={billIdx} style={{ marginBottom: 6 }}>
                                <div><strong>{bill.bill_number}</strong> — {bill.bill_title}</div>
                                {bill.vote_value && (
                                  <div style={{ fontSize: 12, color: '#6b7280' }}>Vote: {bill.vote_value}{bill.is_outlier ? ' (OUTLIER)' : ''}</div>
                                )}
                                {Array.isArray(bill.citations) && bill.citations.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4 }}>
                                    <strong>Citations:</strong>
                                    <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                                      {bill.citations.map((cite: string, citeIdx: number) => (
                                        <li key={citeIdx}>{cite}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {Array.isArray(bill.rts_positions) && bill.rts_positions.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4 }}>
                                    <strong>RTS Positions:</strong>
                                    <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                                      {bill.rts_positions.map((pos: string, posIdx: number) => (
                                        <li key={posIdx}>{pos}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {bill.analysis && (
                                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4 }}>{bill.analysis}</div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <strong>Donors ({theme.donors?.length || 0}):</strong>
                          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                            {(theme.donors || []).map((donor: any, donorIdx: number) => (
                              <li key={donorIdx}>
                                <div><strong>{donor.name}</strong> — ${Number(donor.total_amount ?? donor.amount ?? 0).toLocaleString()}</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                  {donor.type || 'Unknown type'} • {donor.employer || 'Unknown employer'} • {donor.occupation || 'Unknown occupation'}
                                </div>
                                {donor.notes && (
                                  <div style={{ fontSize: 12, color: '#4b5563' }}>{donor.notes}</div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}

                    {Array.isArray(result.report.data_sources) && result.report.data_sources.length > 0 && (
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        <strong>Data Sources:</strong> {result.report.data_sources.join('; ')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0f0f0', borderRadius: 6 }}>
                      <div><strong>Period:</strong> {result.report.dateRange}</div>
                      <div><strong>Donations Period:</strong> {result.report.donationPeriod}</div>
                      <div><strong>Bills Analyzed:</strong> {result.report.billCount}</div>
                      <div><strong>Donations:</strong> {result.report.donationCount} totaling ${result.report.totalDonations?.toLocaleString()}</div>
                      <div><strong>Phase 1 Matches:</strong> {result.report.phase1Matches}</div>
                      {result.report.summaryStats && (
                        <>
                          <div><strong>Total Donations Considered:</strong> {result.report.summaryStats.total_donations}</div>
                          <div><strong>Total Votes:</strong> {result.report.summaryStats.total_votes}</div>
                          <div><strong>Total Sponsorships:</strong> {result.report.summaryStats.total_sponsorships}</div>
                          <div><strong>High Confidence Pairs:</strong> {result.report.summaryStats.high_confidence_pairs}</div>
                          <div><strong>Medium Confidence Pairs:</strong> {result.report.summaryStats.medium_confidence_pairs}</div>
                          <div><strong>Low Confidence Pairs:</strong> {result.report.summaryStats.low_confidence_pairs}</div>
                        </>
                      )}
                    </div>

                    {result.report.confirmedConnections?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>
                          ⚠️ Confirmed Conflicts of Interest ({result.report.confirmedConnections.length})
                        </h4>
                        {result.report.confirmedConnections.map((connection: any, connIdx: number) => (
                          <div key={connIdx} style={{ padding: 8, border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 8, backgroundColor: '#fef2f2' }}>
                            <div style={{ fontWeight: 600 }}>{connection.bill_number}: {connection.bill_title}</div>
                            <div><strong>Vote:</strong> {connection.vote_value ?? connection.vote} {connection.is_outlier && <span style={{ color: '#dc2626' }}>(OUTLIER)</span>}</div>
                            <div><strong>Donors:</strong> {connection.donors?.map((d: any) => `${d.name} ($${d.amount})`).join(', ')}</div>
                            <div><strong>Confidence:</strong> {(connection.confidence_score * 100).toFixed(0)}%</div>
                            <div style={{ marginTop: 4 }}><strong>Analysis:</strong> {connection.analysis?.explanation}</div>
                            {connection.analysis?.key_provisions && (
                              <div style={{ marginTop: 4 }}>
                                <strong>Key Provisions:</strong>
                                <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
                                  {connection.analysis.key_provisions.map((provision: string, provIdx: number) => (
                                    <li key={provIdx}>{provision}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {result.report.rejectedConnections?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>
                          ✅ Investigated but Rejected ({result.report.rejectedConnections.length})
                        </h4>
                        {result.report.rejectedConnections.map((connection: any, connIdx: number) => (
                          <div key={connIdx} style={{ padding: 8, border: '1px solid #bbf7d0', borderRadius: 4, marginBottom: 8, backgroundColor: '#f0fdf4' }}>
                            <div style={{ fontWeight: 600 }}>{connection.bill_number}: {connection.bill_title}</div>
                            <div><strong>Initial Reason:</strong> {connection.connection_reason}</div>
                            <div><strong>Why Rejected:</strong> {connection.analysis?.explanation}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(!result.report.confirmedConnections || result.report.confirmedConnections.length === 0) && (
                      <div style={{ padding: 8, backgroundColor: '#f0fdf4', borderRadius: 6, color: '#16a34a' }}>
                        ✅ No conflicts of interest identified for this session.
                      </div>
                    )}
                  </>
                )
              ) : (
                <div style={{ color: '#374151' }}>
                  {typeof result.report === 'string' ? result.report : 'Report generated.'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Debug info for previously-declared state */}
      {(analyzedBillIds.length > 0 || incrementalStats) && (
        <div style={{ marginTop: 24, color: '#6b7280' }}>
          <div>Analyzed Bill IDs: {analyzedBillIds.length}</div>
          {incrementalStats && (
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(incrementalStats, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportGeneratorPage;
