'use client';

import React, { useState } from 'react';
import { supabase2 as supabase } from '../lib/supabase2';
import type { PersonSearchResult } from './lib/types';
import { searchPeopleWithSessions } from './lib/search';
import { GoogleGenerativeAI, SchemaType, type Tool } from '@google/generative-ai';
import { getGeminiKey, setGeminiKey } from '../lib/../lib/aiKeyStore';

const GEMINI_API_KEY = getGeminiKey() || import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

interface Person extends PersonSearchResult {
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

type SessionSelection = number | 'combined';

interface AnalysisResult {
  sessionName: string;
  report?: any;
  error?: string;
  phase1?: Phase1RenderData;
}

interface Phase1RenderData {
  sessionName: string;
  data: any;
  summaryStats: any;
  billIds: number[];
  donationIds: string[];
  groups: any[];
  phase1ReportId?: number;
  sessionKey: string;
}

const ReportGeneratorPage: React.FC = () => {
  const [currentLegislator, setCurrentLegislator] = useState<string | null>(null);
  const [currentPersonId, setCurrentPersonId] = useState<number | null>(null);
  const [currentLegislatorIds, setCurrentLegislatorIds] = useState<number[]>([]);
  const [currentEntityIds, setCurrentEntityIds] = useState<number[]>([]);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<SessionSelection[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [autocompleteResults, setAutocompleteResults] = useState<Person[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [searchingLegislator, setSearchingLegislator] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState('');
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[] | null>(null);
  const [currentStep, setCurrentStep] = useState<'search' | 'sessions' | 'progress' | 'results'>('search');
  const [analysisMode, setAnalysisMode] = useState<'twoPhase' | 'singleCall'>('twoPhase');
  const [phase1Previews, setPhase1Previews] = useState<Record<string, Phase1RenderData>>({});
  const [activePhaseView, setActivePhaseView] = useState<'phase1' | 'phase2'>('phase2');
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>(getGeminiKey() || '');

const baseGenerationConfig = {
  temperature: 0.6,
  maxOutputTokens: 8192,
};

const TEN_MINUTES_MS = 10 * 60 * 1000;

const runWithTimeout = async <T,>(executor: (signal: AbortSignal) => Promise<T>, timeoutMs = TEN_MINUTES_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await executor(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

const parseJsonLoose = (raw: string) => {
  const cleaned = raw.trim();
  const variants: string[] = [];

  // Extract JSON from markdown code blocks if present
  const extractFromMarkdown = (text: string) => {
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    return text;
  };

  const fixCommonIssues = (text: string) => {
    return text
      // Fix incomplete strings (common Gemini issue)
      .replace(/"([^"]*?)(?=\s*[}\]])/g, '"$1"')
      .replace(/"([^"]*?)(?=\s*[,])/g, '"$1"')
      // Fix unquoted keys
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
      // Fix trailing commas
      .replace(/,(\s*[}\]])/g, '$1')
      // Fix missing quotes around string values
      .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_\s]*?)(?=\s*[,}\]])/g, (match, value) => {
        const trimmed = value.trim();
        if (!trimmed.startsWith('"') && !trimmed.startsWith("'") && !trimmed.match(/^[0-9.-]+$/) && trimmed !== 'true' && trimmed !== 'false' && trimmed !== 'null') {
          return `: "${trimmed}"`;
        }
        return match;
      })
      // Fix incomplete objects/arrays
      .replace(/([{\[])([^}\]])*$/, (match, opener) => {
        if (opener === '{') return match + '}';
        if (opener === '[') return match + ']';
        return match;
      });
  };

  const balanceDelimiters = (input: string) => {
    let result = input;
    const stack: string[] = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < result.length; i += 1) {
      const char = result[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
      }
    }

    while (stack.length) {
      const open = stack.pop();
      result += open === '{' ? '}' : ']';
    }
    return result;
  };

  const addVariant = (str: string) => {
    const balanced = balanceDelimiters(str);
    if (!variants.includes(balanced)) {
      variants.push(balanced);
    }
    return balanced;
  };

  // Start with the cleaned input
  addVariant(cleaned);

  // Extract from markdown if present
  const fromMarkdown = extractFromMarkdown(cleaned);
  if (fromMarkdown !== cleaned) {
    addVariant(fromMarkdown);
  }

  // Fix common issues
  const fixed = fixCommonIssues(fromMarkdown);
  addVariant(fixed);

  const withoutComments = fixed
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const noTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, '$1');
  const withObjectCommas = noTrailingCommas.replace(/}(?=\s*"|\s*{)/g, '},');
  const withArrayCommas = withObjectCommas.replace(/](?=\s*"|\s*{)/g, '],');

  const withKeyQuotes = withArrayCommas.replace(/([,{\[]\s*)([A-Za-z0-9_]+)(?=\s*:)/g, (_, prefix, key) => `${prefix}"${key}"`);

  addVariant(withoutComments);
  addVariant(noTrailingCommas);
  addVariant(withObjectCommas);
  addVariant(withArrayCommas);
  addVariant(withKeyQuotes);

  let lastError: unknown = null;

  // Try parsing each variant
  for (const candidate of variants) {
    try {
      const parsed = JSON.parse(candidate);
      return parsed;
    } catch (err) {
      lastError = err;
    }
  }

  // If all JSON.parse attempts fail, try Function constructor as last resort
  for (const candidate of variants) {
    try {
      // eslint-disable-next-line no-new-func
      return Function(`"use strict"; return (${candidate});`)();
    } catch (err) {
      lastError = err;
    }
  }

  // If everything fails, return a fallback object with the raw text
  console.warn('Failed to parse JSON, returning fallback object:', lastError);
  return {
    error: 'Failed to parse JSON response',
    raw_text: cleaned.substring(0, 500) + (cleaned.length > 500 ? '...' : ''),
    parse_error: String(lastError)
  };
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
      const people = await searchPeopleWithSessions({ query: term, limit: 10 });

      const mappedData: Person[] = people
        .map((person) => ({
          ...person,
          extra: person.summary ?? `${person.legislator_count} legislators • ${person.entity_count} entities`,
        }))
        .filter((item) => (item.all_legislator_ids?.length || 0) > 0);

      setAutocompleteResults(mappedData);
      setShowAutocomplete(mappedData.length > 0);
    } catch (error) {
      console.error('Autocomplete error:', error);
      setAutocompleteResults([]);
      setShowAutocomplete(false);
    }
  };

  const selectLegislator = (person: Partial<Person>) => {
    setSearchTerm(person.display_name || '');
    setShowAutocomplete(false);
    setCurrentLegislatorIds(person.all_legislator_ids || []);
    searchLegislator(person as Person);
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
          console.warn('get_person_sessions RPC failed, attempting direct query fallback', sessionError);
          try {
            const { data: legSessionRows, error: legSessionError } = await supabase
              .from('rs_person_leg_sessions')
              .select('session_id')
              .eq('person_id', personId);
            if (legSessionError) throw legSessionError;

            const sessionIds = Array.from(new Set((legSessionRows || [])
              .map((row: any) => Number(row.session_id))
              .filter((id) => Number.isFinite(id))));

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
          } catch (fallbackError) {
            console.error('Failed to load sessions for person via fallback path', fallbackError);
            sessionRows = [];
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
    } catch (err: any) {
      setError(err.message || 'Failed to search legislator');
    } finally {
      setSearchingLegislator(false);
    }
  };

  const toggleSession = (sessionId: SessionSelection) => {
    setSelectedSessions((prev: SessionSelection[]) => {
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
      const previewUpdates: Record<string, Phase1RenderData> = {};
      const customBlock = customInstructions.trim()
        ? `================================\nCUSTOM CRITICAL INSTRUCTIONS AND CONTEXT - These Override all other rules:\n${customInstructions}\n================================\n\n`
        : '';

      // Process each selected session
      for (let i = 0; i < selectedSessions.length; i++) {
        const sessionId = selectedSessions[i];
        const isCombined = typeof sessionId === 'string';
        const sessionStartTime = nowMs();

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

        const sessionKey = isCombined
          ? `combined-${sessionIdsForQuery.join('-')}`
          : String(sessionIdsForQuery[0]);

        let phase1ReportId: number | null = null;

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
          const message = billsError instanceof Error ? billsError.message : String(billsError);
          throw new Error(`Bills function failed: ${message}`);
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
          const message = donationsError instanceof Error ? donationsError.message : String(donationsError);
          throw new Error(`Donations function failed: ${message}`);
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

Create a STRUCTURED JSON output with ALL potential donor-bill groups (each bill appears once with every relevant donor nested beneath it):

\`\`\`json
{
  "session_info": ${JSON.stringify(sessionInfo, null, 2)},
  "legislator_info": ${JSON.stringify(legislatorInfo, null, 2)},
  "potential_groups": [
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
      "group_reason": "Why this collection of donors might care about this bill",
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
- Create groups for EVERY significant donor (>$100) and EVERY vote/sponsorship
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
          phase1Result = await runWithTimeout((signal) => model.generateContent(phase1Prompt, { signal }));

          if (!phase1Result || !phase1Result.response) {
            throw new Error('No response from Gemini API');
          }

          phase1Response = phase1Result.response.text();
          console.log('Phase 1 response received, length:', phase1Response.length);
          console.log('[Phase 1 Raw Response]', phase1Response);

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
          phase1Data = parseJsonLoose(jsonSlice);
        } catch (e) {
          throw new Error(`Failed to parse Phase 1 results: ${e}`);
        }

        setProgressText(`Phase 2: Deep dive analysis for ${sessionName}...`);
        setProgressPercent(30 + (i * 40));

        // Phase 2: Deep dive on high-confidence matches
        const rawGroups: any[] = Array.isArray(phase1Data.potential_groups)
          ? phase1Data.potential_groups
          : Array.isArray(phase1Data.potential_pairs)
            ? phase1Data.potential_pairs
            : [];

        const mergedGroupsMap = new Map<number, any>();
        rawGroups.forEach((group: any) => {
          const billId = group.bill_id;
          if (billId == null) return;

          const existing = mergedGroupsMap.get(billId) || {
            ...group,
            donors: [],
            group_reasons: [] as string[],
            confidence_score: Number(group.confidence_score ?? 0),
          };

          const donors = Array.isArray(existing.donors) ? existing.donors : [];
          const newDonors = Array.isArray(group.donors) ? group.donors : [];
          const seen = new Set<string>(
            donors.map((d: any) => String(d.donation_id ?? `${d.name}-${d.amount}-${d.transaction_date}`))
          );

          newDonors.forEach((donor: any) => {
            const dedupeKey = String(donor.donation_id ?? `${donor.name}-${donor.amount}-${donor.transaction_date}`);
            if (!seen.has(dedupeKey)) {
              donors.push(donor);
              seen.add(dedupeKey);
            }
          });

          const reason = group.group_reason ?? group.connection_reason ?? '';
          if (reason && !existing.group_reasons.includes(reason)) {
            existing.group_reasons.push(reason);
          }

          existing.connection_reason = existing.group_reasons.join('; ');
          existing.confidence_score = Math.max(Number(existing.confidence_score ?? 0), Number(group.confidence_score ?? 0));
          existing.donors = donors;
          existing.vote_or_sponsorship = existing.vote_or_sponsorship ?? group.vote_or_sponsorship;
          existing.vote_value = existing.vote_value ?? group.vote_value ?? group.vote;

          mergedGroupsMap.set(billId, existing);
        });

        const potentialGroups = Array.from(mergedGroupsMap.values());
        console.log('Phase 1 potential groups parsed:', potentialGroups.length);

        const autoHigh = potentialGroups.filter((group: any) => Number(group.confidence_score ?? 0) >= 0.7).length;
        const autoMedium = potentialGroups.filter((group: any) => {
          const score = Number(group.confidence_score ?? 0);
          return score >= 0.4 && score < 0.7;
        }).length;
        const autoLow = potentialGroups.filter((group: any) => {
          const score = Number(group.confidence_score ?? 0);
          return score > 0 && score < 0.4;
        }).length;

        const phase1Summary = {
          total_donations: Number(phase1Data.summary_stats?.total_donations ?? summaryStats.total_donations) || 0,
          total_votes: Number(phase1Data.summary_stats?.total_votes ?? summaryStats.total_votes) || 0,
          total_sponsorships: Number(phase1Data.summary_stats?.total_sponsorships ?? summaryStats.total_sponsorships) || 0,
          high_confidence_pairs: typeof phase1Data.summary_stats?.high_confidence_pairs === 'number'
            ? Number(phase1Data.summary_stats.high_confidence_pairs)
            : autoHigh,
          medium_confidence_pairs: typeof phase1Data.summary_stats?.medium_confidence_pairs === 'number'
            ? Number(phase1Data.summary_stats.medium_confidence_pairs)
            : autoMedium,
          low_confidence_pairs: typeof phase1Data.summary_stats?.low_confidence_pairs === 'number'
            ? Number(phase1Data.summary_stats.low_confidence_pairs)
            : autoLow,
        };


        const phase1BillIds = Array.from(new Set(
          potentialGroups
            .map((group: any) => Number(group.bill_id))
            .filter((id) => Number.isFinite(id))
        )) as number[];

        const phase1DonationIds = Array.from(new Set(
          potentialGroups.flatMap((group: any) =>
            (Array.isArray(group.donors) ? group.donors : [])
              .map((donor: any) => donor?.donation_id)
              .filter((donationId: any) => donationId !== null && donationId !== undefined)
              .map((donationId: any) => String(donationId))
          )
        )) as string[];

        const normalizedPhase1Data = {
          ...phase1Data,
          potential_groups: potentialGroups,
          summary_stats: phase1Summary,
        };

        const phase1PreviewBase: Phase1RenderData = {
          sessionName,
          data: normalizedPhase1Data,
          summaryStats: phase1Summary,
          billIds: phase1BillIds,
          donationIds: phase1DonationIds,
          groups: potentialGroups,
          sessionKey,
        };

        previewUpdates[sessionKey] = phase1PreviewBase;
        setPhase1Previews((prev) => ({ ...prev, [sessionKey]: phase1PreviewBase }));

        try {
          const { data: phase1SaveData, error: phase1SaveError } = await supabase.rpc('save_phase1_analysis_report', {
            p_person_id: currentPersonId,
            p_session_id: isCombined ? null : sessionIdsForQuery[0],
            p_phase1_data: normalizedPhase1Data,
            p_session_ids: sessionIdsForQuery,
            p_is_combined: isCombined,
            p_custom_instructions: customInstructions || null,
            p_summary_stats: phase1Summary,
            p_bill_ids: phase1BillIds,
            p_donation_ids: phase1DonationIds,
            p_phase1_report_id: null,
          });

          if (phase1SaveError) {
            const errorCode = (phase1SaveError as any)?.code;
            if (errorCode === 'PGRST202') {
              console.warn('save_phase1_analysis_report is unavailable; skipping persistence for now.');
            } else {
              throw phase1SaveError;
            }
          } else {
            const savedIdRaw = Array.isArray(phase1SaveData) ? phase1SaveData[0] : phase1SaveData;
            if (savedIdRaw !== null && savedIdRaw !== undefined) {
              const parsedPhase1Id = Number.parseInt(String(savedIdRaw), 10);
              if (!Number.isNaN(parsedPhase1Id)) {
                phase1ReportId = parsedPhase1Id;
              }
            }

            if (phase1ReportId) {
              const previewWithId: Phase1RenderData = {
                ...phase1PreviewBase,
                phase1ReportId,
              };
              previewUpdates[sessionKey] = previewWithId;
              setPhase1Previews((prev) => ({ ...prev, [sessionKey]: previewWithId }));
            }
          }
        } catch (phase1SaveErr) {
          const errorCode = (phase1SaveErr as any)?.code;
          if (errorCode === 'PGRST202') {
            console.warn('save_phase1_analysis_report is unavailable; continuing without persistence.');
          } else {
            console.error('Failed to save Phase 1 report:', phase1SaveErr);
            const message = phase1SaveErr instanceof Error ? phase1SaveErr.message : String(phase1SaveErr);
            throw new Error(`Failed to save Phase 1 report: ${message}`);
          }
        }

        const highConfidenceGroups = potentialGroups
          .filter((group: any) => Number(group.confidence_score ?? 0) >= 0.5)
          .slice(0, 10); // Limit to top 10
        console.log('Phase 2 candidates (confidence >= 0.5):', highConfidenceGroups.length);

        let confirmedConnections: any[] = [];
        let rejectedConnections: any[] = [];

        if (highConfidenceGroups.length > 0) {
          // Get full bill details for high-confidence matches
          const billDetailsPromises = highConfidenceGroups.map((group: any) =>
            supabase.rpc('get_bill_details', { p_bill_id: group.bill_id })
          );

          const billDetailsResults = await Promise.all(billDetailsPromises);

          for (let j = 0; j < highConfidenceGroups.length; j++) {
            const group = highConfidenceGroups[j];
            const billDetailResult = billDetailsResults[j];

            console.log('Phase 2 analyzing group:', {
              bill_id: group.bill_id,
              bill_number: group.bill_number,
              confidence: group.confidence_score,
            });

            if (billDetailResult.error) {
              console.warn(`Failed to get details for bill ${group.bill_id}:`, billDetailResult.error);
              continue;
            }

            const billDetails = billDetailResult.data?.[0];
            if (!billDetails) continue;

            const groupReasons = Array.isArray(group.group_reasons) && group.group_reasons.length > 0
              ? group.group_reasons
              : [group.connection_reason ?? group.group_reason ?? ''].filter(Boolean);

            const phase2Prompt = `${customBlock}You are an investigative journalist doing a DEEP DIVE analysis of potential donor-bill connections.

You have been given a list of ${highConfidenceGroups.length} potential groups to investigate (each group contains one bill with all associated donors).

PRIORITY DONORS TO SCRUTINIZE:
- Lobbyists and lobbying firms (check occupation field)
- Political Action Committees (PACs) and organizations
- Major corporate executives, CEOs, presidents (check occupation field)
- High-dollar donors ($500+ for individuals, $1000+ for organizations)
- Interest groups and trade associations
- Donors employed by companies with legislative interests

YOUR MISSION: Validate or reject each connection by examining the actual bill text.

FOR EACH HIGH/MEDIUM CONFIDENCE GROUP:
1. Call get_bill_details with bill_id=<the numeric bill_id from the group>
   - Example: get_bill_details with bill_id=69612
2. Analyze if the bill content ACTUALLY benefits the identified donors
3. Look for specific provisions that align with donor interests
4. Confirm or reject the connection based on evidence
5. CRITICAL: Include the bill_id field in your output for each confirmed connection

GROUP DATA TO ANALYZE:
${JSON.stringify(highConfidenceGroups, null, 2)}

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

GROUP RATIONALES:
${groupReasons.length ? groupReasons.map((reason: string, idx: number) => `- Reason ${idx + 1}: ${reason}`).join('\n') : '- No explicit rationale provided from Phase 1.'}`;

            const phase2Result = await runWithTimeout((signal) => model.generateContent(phase2Prompt, { signal }));
            const phase2Response = phase2Result.response.text();

            try {
              const cleanResponse = phase2Response.replace(/```json\s*|\s*```/g, '').trim();
              const analysis = parseJsonLoose(cleanResponse);

              const confirmedList = Array.isArray(analysis.confirmed_connections) ? analysis.confirmed_connections : [];
              const rejectedList = Array.isArray(analysis.rejected_connections) ? analysis.rejected_connections : [];

              if (confirmedList.length > 0) {
                confirmedConnections.push({
                  ...group,
                  analysis: confirmedList[0]
                });
              }

              if (rejectedList.length > 0) {
                rejectedConnections.push({
                  ...group,
                  analysis: rejectedList[0]
                });
              }
            } catch (e) {
              console.warn(`Failed to parse Phase 2 analysis for bill ${group.bill_id}:`, e);
              // Add a fallback analysis for failed parsing
              rejectedConnections.push({
                ...group,
                analysis: {
                  bill_number: group.bill_number,
                  reason_rejected: "Analysis failed due to parsing error",
                  confidence: 0.1,
                  severity: "low"
                }
              });
            }
          }
        }

        // Compile final report
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
          phase1Matches: potentialGroups.length,
          confirmedConnections,
          rejectedConnections,
          summaryStats: phase1Summary,
          customInstructions: customInstructions || undefined
        };

        const phase2BillIds = Array.from(new Set(
          potentialGroups
            .map((group: any) => Number(group.bill_id))
            .filter((id) => Number.isFinite(id))
        )) as number[];

        const phase2DonationIds = Array.from(new Set(
          potentialGroups.flatMap((group: any) =>
            (Array.isArray(group.donors) ? group.donors : [])
              .map((donor: any) => donor?.donation_id)
              .filter((donationId: any) => donationId !== null && donationId !== undefined)
              .map((donationId: any) => String(donationId))
          )
        )) as string[];

        const sessionDurationMs = Math.round(nowMs() - sessionStartTime);

        let savedReportId: number | undefined;
        try {
          const { data: phase2SaveData, error: phase2SaveError } = await supabase.rpc('save_phase2_analysis_report', {
            p_person_id: currentPersonId,
            p_session_id: isCombined ? null : sessionIdsForQuery[0],
            p_report_data: report,
            p_bill_ids: phase2BillIds,
            p_donation_ids: phase2DonationIds,
            p_is_combined: isCombined,
            p_custom_instructions: customInstructions || null,
            p_analysis_duration_ms: sessionDurationMs,
            p_report_id: null,
            p_phase1_report_id: phase1ReportId,
          });

          if (phase2SaveError) {
            const errorCode = (phase2SaveError as any)?.code;
            if (errorCode === 'PGRST202') {
              console.warn('save_phase2_analysis_report is unavailable; skipping persistence for now.');
            } else {
              throw phase2SaveError;
            }
          } else {
            const savedReportIdRaw = Array.isArray(phase2SaveData) ? phase2SaveData[0] : phase2SaveData;
            if (savedReportIdRaw !== null && savedReportIdRaw !== undefined) {
              const parsedReportId = Number.parseInt(String(savedReportIdRaw), 10);
              if (!Number.isNaN(parsedReportId)) {
                savedReportId = parsedReportId;
                (report as any).reportId = savedReportId;
              }
            }
          }
        } catch (phase2SaveErr) {
          const errorCode = (phase2SaveErr as any)?.code;
          if (errorCode === 'PGRST202') {
            console.warn('save_phase2_analysis_report is unavailable; continuing without persistence.');
          } else {
            console.error('Failed to save Phase 2 report:', phase2SaveErr);
            const message = phase2SaveErr instanceof Error ? phase2SaveErr.message : String(phase2SaveErr);
            throw new Error(`Failed to save Phase 2 report: ${message}`);
          }
        }

        results.push({
          sessionName,
          report,
          phase1: previewUpdates[sessionKey] ?? {
            ...phase1PreviewBase,
            ...(phase1ReportId ? { phase1ReportId } : {}),
          }
        });

        setProgressPercent(70 + (i * 20));
        setProgressText(`Completed analysis for ${sessionName}`);
      }

      setAnalysisResults(results);
      setActivePhaseView('phase2');
      setProgressPercent(100);
      setProgressText('Analysis complete');
      setCurrentStep('results');
    } catch (analysisError: any) {
      console.error('Analysis error:', analysisError);
      throw analysisError;
    }
  };

  const runSingleCallAnalysis = async () => {
    if (!GEMINI_API_KEY) throw new Error('Missing Gemini API key');

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
      `Each bill must appear only once with every relevant donor nested under that bill entry.\n` +
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

      return runWithTimeout(async (signal) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Gemini error: ${res.status} ${text}`);
        }

        return res.json();
      });
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
    const report = parseJsonLoose(jsonSlice);

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
    setPhase1Previews({});
    setActivePhaseView('phase2');

    try {
      if (analysisMode === 'singleCall') {
        await runSingleCallAnalysis();
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
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#f3f4f6',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            fontSize: '0.875rem'
          }}
        >
          AI Settings
        </button>
      </div>
      {showSettings && (
        <div style={{ padding: '1rem', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', marginBottom: '1rem' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: '500' }}>Gemini API Key</label>
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem' }}
              placeholder="AIza..."
            />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => {
                setGeminiKey(geminiKeyInput || null);
                window.location.reload();
              }}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Save & Reload
            </button>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '0.25rem',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fee2e2', border: '1px solid #fecaca', borderRadius: 6, color: '#b91c1c', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>{error}</div>
          {!analyzing && (
            <div>
              <button
                type="button"
                onClick={() => startAnalysis()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#b91c1c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                Retry Analysis
              </button>
            </div>
          )}
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
                    borderBottom: '1px solid #f0f0f0'
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
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Additional Instructions (overrides defaults)</label>
            <textarea
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder="Provide any custom guidance for the AI. These directions override all other instructions."
              rows={4}
              style={{ width: '100%', padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'inherit', fontSize: '0.95em' }}
            />
            {customInstructions.trim() && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>
                When provided, these instructions are injected at the top of every prompt and supersede default guidance.
              </div>
            )}
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

          {Object.values(phase1Previews).length > 0 && (
            <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
              {Object.values(phase1Previews).map((preview) => (
                <div
                  key={preview.sessionKey}
                  style={{
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: '#f9fafb',
                    maxHeight: 320,
                    overflowY: 'auto'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600 }}>Phase 1 Preview — {preview.sessionName}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {preview.billIds.length} bills • {preview.donationIds.length} donations
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
                    <strong>Summary:</strong>
                    <span style={{ marginLeft: 6 }}>
                      {`Votes ${preview.summaryStats.total_votes ?? 0}, Sponsors ${preview.summaryStats.total_sponsorships ?? 0}, Donations ${preview.summaryStats.total_donations ?? 0}`}
                    </span>
                    <span style={{ marginLeft: 10 }}>
                      {`Confidence — High ${preview.summaryStats.high_confidence_pairs ?? 0} • Medium ${preview.summaryStats.medium_confidence_pairs ?? 0} • Low ${preview.summaryStats.low_confidence_pairs ?? 0}`}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Potential Groups</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {preview.groups.map((group: any, groupIdx: number) => (
                        <div key={`${preview.sessionKey}-group-${groupIdx}`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, backgroundColor: '#fff' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {group.bill_number || 'Unknown Bill'} — {group.bill_title || 'Untitled Bill'}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {group.vote_or_sponsorship || 'vote'} • {group.vote_value || 'N/A'} • {group.vote_date || 'Unknown date'}
                            {group.is_party_outlier ? ' • Party Outlier' : ''}
                          </div>
                          {group.connection_reason && (
                            <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                              <strong>Reason:</strong> {group.connection_reason}
                            </div>
                          )}
                          {Array.isArray(group.donors) && group.donors.length > 0 && (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>Donors ({group.donors.length}):</div>
                              <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                                {group.donors.map((donor: any, donorIdx: number) => (
                                  <li key={`${preview.sessionKey}-group-${groupIdx}-donor-${donorIdx}`}>
                                    <strong>{donor.name}</strong> — ${Number(donor.amount ?? 0).toLocaleString()} ({donor.type || 'Unknown'})
                                    {donor.transaction_date && ` • ${donor.transaction_date}`}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {currentStep === 'results' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Analysis Results</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(analysisResults ?? []).some((r) => r.phase1) && (
                <button
                  onClick={() => setActivePhaseView((prev) => (prev === 'phase1' ? 'phase2' : 'phase1'))}
                  style={{ padding: '6px 12px', fontSize: '0.9em', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  {activePhaseView === 'phase1' ? '→ View Phase 2 Results' : '← View Phase 1 Preview'}
                </button>
              )}
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
          {activePhaseView === 'phase1' && (
            <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
              {(analysisResults ?? []).map((result, idx) => {
                if (!result.phase1) return null;
                const phase1 = result.phase1;
                return (
                  <div key={`phase1-${idx}`} style={{ padding: 16, border: '1px solid #d1d5db', borderRadius: 8, backgroundColor: '#f9fafb' }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{result.sessionName} — Phase 1 Preview</h3>
                    {result.error && (
                      <div style={{ marginBottom: 12, padding: 8, borderRadius: 6, backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                        {result.error}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: '#374151' }}>
                        <strong>Summary:</strong>
                        <span style={{ marginLeft: 6 }}>
                          {`Votes ${phase1.summaryStats.total_votes ?? 0}, Sponsors ${phase1.summaryStats.total_sponsorships ?? 0}, Donations ${phase1.summaryStats.total_donations ?? 0}`}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {phase1.billIds.length} bills • {phase1.donationIds.length} donations
                        {phase1.phase1ReportId ? ` • Saved ID ${phase1.phase1ReportId}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                      Confidence — High {phase1.summaryStats.high_confidence_pairs ?? 0} • Medium {phase1.summaryStats.medium_confidence_pairs ?? 0} • Low {phase1.summaryStats.low_confidence_pairs ?? 0}
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {phase1.groups.map((group: any, groupIdx: number) => (
                        <div key={`${phase1.sessionKey}-phase1-${groupIdx}`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, backgroundColor: '#fff' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {group.bill_number || 'Unknown Bill'} — {group.bill_title || 'Untitled Bill'}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {group.vote_or_sponsorship || 'vote'} • {group.vote_value || 'N/A'} • {group.vote_date || 'Unknown date'}
                            {group.is_party_outlier ? ' • Party Outlier' : ''}
                          </div>
                          {group.connection_reason && (
                            <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                              <strong>Reason:</strong> {group.connection_reason}
                            </div>
                          )}
                          {Array.isArray(group.donors) && group.donors.length > 0 && (
                            <div style={{ marginTop: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>Donors ({group.donors.length}):</div>
                              <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                                {group.donors.map((donor: any, donorIdx: number) => (
                                  <li key={`${phase1.sessionKey}-phase1-${groupIdx}-donor-${donorIdx}`}>
                                    <strong>{donor.name}</strong> — ${Number(donor.amount ?? 0).toLocaleString()} ({donor.type || 'Unknown'})
                                    {donor.transaction_date && ` • ${donor.transaction_date}`}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(analysisResults ?? []).map((result, idx) => {
            if (activePhaseView === 'phase1' && result.phase1) {
              return null;
            }
            return (
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
            );
          })}
        </div>
      )}

    </div>
  );
};

export default ReportGeneratorPage;
