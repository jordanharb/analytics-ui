'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase2 as supabase } from '../lib/supabase2';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { PersonSearchResult as SharedPersonResult } from './lib/types';
import { searchPeopleWithSessions } from './lib/search';

// Optional backend base URL. If not set, run in client-only mode and simulate streaming.
const RAW_BASE = (import.meta as any)?.env?.VITE_BACKEND_BASE_URL as string | undefined;
const HAS_BACKEND = typeof RAW_BASE === 'string' && RAW_BASE.trim().length > 0;
const API_BASE: string | null = HAS_BACKEND ? RAW_BASE!.trim() : null;
// API endpoints (only used when API_BASE is set)
const PROGRESS_SSE_URL = API_BASE ? `${API_BASE}/api/progress` : '';
const ANALYSIS_STREAM_URL = API_BASE ? `${API_BASE}/api/reports/stream` : '';
// Incremental analysis now fetched via Supabase RPC, not HTTP route

// Types
type PersonSearchResult = SharedPersonResult;

interface Session {
  id: number;
  name: string;
  dateRange?: string;
  vote_count?: number;
  start_date?: string;
  end_date?: string;
}

type SelectedSessionId = number | 'combined';

interface IncrementalStats {
  analyzed_bills: number;
  report_count: number;
  last_analysis?: string;
}

interface Phase1Donor {
  name: string;
  employer?: string;
  occupation?: string;
  type: string;
  amount?: number;
  transaction_date?: string;
  days_from_session?: number;
}

interface Phase1Pair {
  bill_id: number;
  bill_number: string;
  bill_title?: string;
  vote_or_sponsorship: 'vote' | 'sponsor';
  vote_value?: 'Y' | 'N' | null;
  vote_date?: string;
  is_party_outlier?: boolean;
  donors: Phase1Donor[];
  connection_reason?: string;
  confidence_score: number;
}

interface Phase1Output {
  session_info: { session_id: number; session_name: string; date_range: string };
  legislator_info: { name: string; legislator_ids: number[]; entity_ids: number[] };
  potential_pairs: Phase1Pair[];
  summary_stats?: Record<string, number>;
}

interface Phase2Confirmed {
  bill_id: number;
  bill_number: string;
  bill_title?: string;
  donors: Omit<Phase1Donor, 'days_from_session'>[];
  total_donor_amount?: number;
  vote_or_sponsorship: 'vote' | 'sponsor';
  vote_value?: 'Y' | 'N';
  key_provisions?: string[];
  explanation?: string;
  confidence?: number;
  severity?: 'high' | 'medium' | 'low';
}

interface Phase2Rejected {
  bill_number: string;
  reason_rejected: string;
}

interface Phase2Output {
  confirmed_connections: Phase2Confirmed[];
  rejected_connections?: Phase2Rejected[];
  session_summary?: string;
  key_findings?: string[];
}

type ProgressEventType = 'connected' | 'phase_start' | 'detail' | 'phase_complete' | 'log' | 'complete' | 'error';
interface ProgressEvent {
  type: ProgressEventType;
  message?: string;
  phase?: 'phase1' | 'phase2';
  success?: boolean;
  reportPath?: string;
}

interface AnalysisResult {
  sessionName: string;
  phase1?: Phase1Output;
  phase2?: Phase2Output;
  error?: string;
  reportPath?: string;
}

const MAX_AUTOCOMPLETE = 10;
const DEBOUNCE_MS = 300;

const ReportGeneratorPageV2: React.FC = () => {
  // Search/autocomplete state
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [autocomplete, setAutocomplete] = useState<PersonSearchResult[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Selected person/sessions
  const [currentLegislator, setCurrentLegislator] = useState<string | null>(null);
  const [currentPersonId, setCurrentPersonId] = useState<number | null>(null);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);
  const [selectedSessions, setSelectedSessions] = useState<SelectedSessionId[]>([]);
  const [incrementalStats, setIncrementalStats] = useState<IncrementalStats | null>(null);
  const [analyzedBillIds, setAnalyzedBillIds] = useState<number[]>([]);

  // Workflow
  const [step, setStep] = useState<'search' | 'sessions' | 'progress' | 'results'>('search');
  const [customInstructions, setCustomInstructions] = useState('');
  const [excludeAnalyzedBills, setExcludeAnalyzedBills] = useState(false);

  // Progress/SSE
  const [progressText, setProgressText] = useState('');
  const [progressDetails, setProgressDetails] = useState<string[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Results
  const [results, setResults] = useState<AnalysisResult[]>([]);

  // Errors
  const [error, setError] = useState<string | null>(null);

  // Resolve Gemini key from common env names (Vite exposes only VITE_* at runtime).
  const GEMINI_API_KEY: string | undefined =
    import.meta.env.VITE_GOOGLE_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    // Try a few alternates if user named them differently
    (import.meta as any)?.env?.VITE_GOOGLE_GENAI_API_KEY ||
    (import.meta as any)?.env?.VITE_GEMINI ||
    (import.meta as any)?.env?.GOOGLE_API_KEY ||
    (import.meta as any)?.env?.GEMINI_API_KEY;

  const appendDetail = (msg: string) => setProgressDetails((prev) => [...prev, msg].slice(-500));
  const incPercent = (amt = 1, cap = 95) => setProgressPercent((p) => Math.min(cap, p + amt));
  const withTimeout = async <T,>(p: Promise<T>, ms = 60000): Promise<T> =>
    await Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Request timed out after ${ms}ms`)), ms)),
    ]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    setError(null);
    if (searchTimeout) clearTimeout(searchTimeout);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setShowAutocomplete(false);
      setAutocomplete([]);
      return;
    }
    const timeout = setTimeout(() => searchCachedPeople(trimmed), DEBOUNCE_MS);
    setSearchTimeout(timeout);
  };

  const searchCachedPeople = async (term: string) => {
    try {
      const items = await searchPeopleWithSessions({ query: term, limit: MAX_AUTOCOMPLETE });
      setAutocomplete(items.slice(0, MAX_AUTOCOMPLETE));
      setShowAutocomplete((items?.length ?? 0) > 0);
    } catch (err) {
      console.error('ReportGeneratorV2: Autocomplete error:', err);
      setShowAutocomplete(false);
    }
  };

  const selectLegislator = (person: PersonSearchResult) => {
    setSearchTerm(person.display_name);
    setCurrentLegislator(person.display_name);
    setCurrentPersonId(person.person_id);
    setShowAutocomplete(false);
    void searchLegislator(person);
  };

  const searchLegislator = async (selectedPerson?: PersonSearchResult) => {
    const name = selectedPerson?.display_name || searchTerm.trim();
    if (!name) {
      setError('Please enter or select a legislator name');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      let sessions: Session[] = [];
      let personId: number | null = null;
      if (selectedPerson?.person_id) {
        personId = selectedPerson.person_id;
        const { data: sessionData, error: sessionError } = await supabase.rpc('get_person_sessions', { p_person_id: personId });
        if (sessionError) throw sessionError;
        const sessionMap = new Map<number, Session>();
        (sessionData || []).forEach((s: any) => {
          if (!sessionMap.has(s.session_id)) {
            sessionMap.set(s.session_id, {
              id: s.session_id,
              name: s.session_name,
              dateRange: s.start_date && s.end_date ? `${s.start_date} to ${s.end_date}` : undefined,
              vote_count: s.vote_count ?? undefined,
              start_date: s.start_date ?? undefined,
              end_date: s.end_date ?? undefined,
            });
          }
        });
        sessions = Array.from(sessionMap.values());
      }
      setCurrentLegislator(name);
      setCurrentPersonId(personId);
      setAvailableSessions(sessions);
      setSelectedSessions([]);
      setIncrementalStats(null);
      setAnalyzedBillIds([]);
      setStep('sessions');
      if (sessions.length === 1 && personId) {
        void checkIncrementalAnalysis(sessions[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search legislator');
    } finally {
      setSearching(false);
    }
  };

  const checkIncrementalAnalysis = async (sessionId: number) => {
    if (!currentPersonId) {
      setIncrementalStats(null);
      setAnalyzedBillIds([]);
      return;
    }
    try {
      // Use Supabase RPC: get_analyzed_bills_stats(p_person_id, p_session_id)
      const { data, error: rpcError } = await supabase.rpc('get_analyzed_bills_stats', {
        p_person_id: currentPersonId,
        p_session_id: sessionId,
      });
      if (rpcError) throw rpcError;
      // Data may be a row or array; normalize
      const row: any = Array.isArray(data) ? data[0] : data;
      if (row) {
        const stats: IncrementalStats = {
          analyzed_bills: Number(row.analyzed_bills ?? 0),
          report_count: Number(row.report_count ?? row.reports ?? 0),
          last_analysis: row.last_analysis ?? row.last_analyzed_at ?? undefined,
        };
        const ids = row.analyzedBillIds || row.analyzed_bill_ids || [];
        setIncrementalStats(stats);
        setAnalyzedBillIds(Array.isArray(ids) ? ids : []);
      } else {
        setIncrementalStats(null);
        setAnalyzedBillIds([]);
      }
    } catch (err) {
      console.error('ReportGeneratorV2: Incremental check error:', err);
      setIncrementalStats(null);
      setAnalyzedBillIds([]);
    }
  };

  const toggleSession = (sessionId: SelectedSessionId) => {
    setSelectedSessions((prev) => {
      const exists = prev.includes(sessionId);
      // If toggling combined, disable others
      if (sessionId === 'combined') {
        return exists ? [] : ['combined'];
      }
      // If combined is selected, ignore individual toggles
      if (prev.includes('combined')) {
        return prev;
      }
      if (exists) {
        const next = prev.filter((s) => s !== sessionId);
        return next;
      }
      const next = [...prev, sessionId];
      return next;
    });
  };

  // When selection changes, fetch incremental stats for single-session case
  useEffect(() => {
    if (selectedSessions.length === 1 && selectedSessions[0] !== 'combined') {
      void checkIncrementalAnalysis(selectedSessions[0] as number);
    } else {
      setIncrementalStats(null);
      setAnalyzedBillIds([]);
    }
  }, [selectedSessions]);

  const startAnalysis = async () => {
    if (selectedSessions.length === 0) {
      alert('Please select at least one session or the combined option');
      return;
    }
    setStep('progress');
    setProgressText('Initializing analysis...');
    setProgressDetails([]);
    setProgressPercent(0);
    setError(null);

    // Prepare session info
    const isCombined = selectedSessions[0] === 'combined';
    const sessionInfo: Session[] = isCombined
      ? availableSessions
      : availableSessions.filter((s) => selectedSessions.includes(s.id));

    // If a backend is configured, use SSE. Otherwise, simulate client-side streaming.
    if (HAS_BACKEND && API_BASE) {
      console.info('ReportGeneratorV2: Using backend mode at', API_BASE);
      try {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        const es = new EventSource(PROGRESS_SSE_URL);
        eventSourceRef.current = es;
        let currentStep = 0;
        const totalSteps = Math.max(1, sessionInfo.length * 10);

        es.onmessage = (ev) => {
          try {
            const data: ProgressEvent = JSON.parse(ev.data);
            if (data.type === 'connected') {
              // no-op
            } else if (data.type === 'phase_start') {
              setProgressText(data.message || 'Processing...');
              currentStep += 1;
              setProgressPercent(Math.min(95, Math.round((currentStep / totalSteps) * 100)));
            } else if (data.type === 'detail') {
              setProgressDetails((prev) => [...prev, data.message || ''].slice(-500));
              currentStep += 0.5;
              setProgressPercent((pct) => Math.min(95, pct + 1));
            } else if (data.type === 'phase_complete') {
              if (data.phase === 'phase1') {
                setProgressText('Phase 1 complete. Starting Phase 2...');
                currentStep += 3;
              }
              setProgressPercent(Math.min(95, Math.round((currentStep / totalSteps) * 100)));
            } else if (data.type === 'log') {
              setProgressText(data.message || 'Working...');
              setProgressPercent((pct) => Math.min(95, pct + 1));
            } else if (data.type === 'complete') {
              setProgressText('Complete');
              setProgressPercent(100);
              es.close();
              eventSourceRef.current = null;
              setResults((prev) => [
                ...prev,
                {
                  sessionName: isCombined ? 'Combined Sessions' : sessionInfo.map((s) => s.name).join(', '),
                  reportPath: data.reportPath,
                },
              ]);
              setStep('results');
            } else if (data.type === 'error') {
              setError(data.message || 'Analysis error');
              es.close();
              eventSourceRef.current = null;
            }
          } catch {
            // ignore malformed lines
          }
        };

        es.onerror = (e) => {
          console.error('ReportGeneratorV2: SSE error', e);
          setError('Connection error with progress stream');
          es.close();
          eventSourceRef.current = null;
        };

        // Trigger analysis on server
        const resp = await fetch(ANALYSIS_STREAM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personId: currentPersonId,
            isCombined,
            sessions: sessionInfo,
            customInstructions: customInstructions.trim() || undefined,
            excludeAnalyzedBills,
            analyzedBillIds,
          }),
        });
        if (!resp.ok) {
          const status = resp.status;
          throw new Error(`Failed to start analysis: ${status}. Backend: ${ANALYSIS_STREAM_URL}`);
        }
      } catch (err: any) {
        console.error('ReportGeneratorV2: startAnalysis error:', err);
        setError(err.message || 'Failed to start analysis');
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        setStep('sessions');
      }
      return;
    }

    // Client-only real analysis pipeline (no backend)
    try {
      if (!GEMINI_API_KEY) {
        throw new Error('Missing Gemini API key (VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY)');
      }
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const toISO = (d: Date) => d.toISOString().split('T')[0];

      for (const s of sessionInfo) {
        // Compute date window (180d before to 180d after session)
        const start = s.start_date ? new Date(s.start_date) : new Date();
        const end = s.end_date ? new Date(s.end_date) : new Date();
        const startWindow = new Date(start.getTime() - 180 * 24 * 60 * 60 * 1000);
        const endWindow = new Date(end.getTime() + 180 * 24 * 60 * 60 * 1000);

        setProgressText(`Phase 1: Fetching session data — ${s.name}`);
        appendDetail(`Fetching bills ${toISO(startWindow)} to ${toISO(endWindow)} for person ${currentPersonId}`);

        // Fetch bills tied to the person in the session window
        const { data: billsData, error: billsErr } = await supabase.rpc('get_session_bills', {
          p_person_id: currentPersonId,
          p_session_ids: [s.id],
        });
        if (billsErr) throw billsErr;
        const totalBills = Array.isArray(billsData) ? billsData.length : 0;
        appendDetail(`Fetched ${totalBills} bills`);
        incPercent(3);

        // Fetch donations/transactions in the same window
        appendDetail('Fetching donations/transactions');
        const { data: donationsData, error: donErr } = await supabase.rpc('get_legislator_donations', {
          p_person_id: currentPersonId,
          p_start_date: toISO(startWindow),
          p_end_date: toISO(endWindow),
        });
        if (donErr) throw donErr;
        const totalDonations = Array.isArray(donationsData) ? donationsData.length : 0;
        appendDetail(`Fetched ${totalDonations} donations`);
        incPercent(3);

        // Build compact payloads for LLM (limit sizes for client)
        const MAX_BILLS = 300;
        const MAX_DONATIONS = 500;
        const billsRows = Array.isArray(billsData) ? billsData : [];
        const donationsRows = Array.isArray(donationsData) ? donationsData : [];

        // Include all outliers first, then fill up to cap with recent items
        const outliers = billsRows.filter((b: any) => (b.is_outlier ?? b.is_party_outlier) === true);
        const nonOutliers = billsRows.filter((b: any) => !((b.is_outlier ?? b.is_party_outlier) === true));
        const recentSorted = nonOutliers.sort((a: any, b: any) => new Date(b.vote_date || b.last_vote_date || 0).getTime() - new Date(a.vote_date || a.last_vote_date || 0).getTime());
        const billsSelected = [...outliers.slice(0, MAX_BILLS), ...recentSorted].slice(0, MAX_BILLS);

        const topDonations = donationsRows
          .map((d: any) => ({ ...d, _amt: Number(d.amount ?? d.donation_amt ?? 0) }))
          .sort((a: any, b: any) => b._amt - a._amt)
          .slice(0, MAX_DONATIONS);

        appendDetail(`Preparing ${billsSelected.length} bills and ${topDonations.length} donations for Phase 1`);

        const billsCompact = billsSelected.map((b: any) => ({
          bill_id: b.bill_id ?? b.id ?? null,
          bill_number: b.bill_number ?? b.number ?? null,
          bill_title: b.short_title ?? b.now_title ?? b.description ?? null,
          vote_or_sponsorship: b.is_sponsor ? 'sponsor' : 'vote',
          vote_value: b.vote_value ?? null,
          vote_date: b.vote_date ?? null,
          is_party_outlier: b.is_outlier ?? b.is_party_outlier ?? false,
        }));

        const donorsCompact = topDonations.map((d: any) => ({
          name: d.clean_donor_name ?? d.donor_name ?? d.received_from_or_paid_to ?? 'Unknown',
          employer: d.transaction_employer ?? d.donor_employer ?? null,
          occupation: d.transaction_occupation ?? d.donor_occupation ?? null,
          type: d.donor_type ?? d.entity_description ?? d.transaction_type ?? 'Unknown',
          amount: Number(d.amount ?? d.donation_amt ?? 0),
          transaction_date: d.transaction_date ?? d.donation_date ?? null,
        }));

        // Phase 1 prompt
        setProgressText(`Phase 1: Pairing generation — ${s.name}`);
        appendDetail('Calling Gemini for Phase 1 JSON');
        const phase1Prompt = `You are the AI Finance Analyzer. Generate JSON ONLY per the schema below.\n\nSchema:\n${JSON.stringify({
          session_info: { session_id: s.id, session_name: s.name, date_range: s.dateRange || '' },
          legislator_info: { name: currentLegislator, legislator_ids: [], entity_ids: [] },
          potential_pairs: [
            {
              bill_id: 0,
              bill_number: 'HB0000',
              bill_title: '...'
            },
          ],
          summary_stats: {},
        }, null, 2)}\n\nData:\n- Bills: ${JSON.stringify(billsCompact).slice(0, 100000)}\n- Donations: ${JSON.stringify(donorsCompact).slice(0, 100000)}\n\nOutput strict JSON with keys: session_info, legislator_info, potential_pairs, summary_stats.`;

        let p1Json: Phase1Output | null = null;
        let p1Text = '';
        try {
          const p1 = await withTimeout(model.generateContent(phase1Prompt), 90000);
          p1Text = p1.response.text();
          const start = p1Text.indexOf('{');
          const end = p1Text.lastIndexOf('}');
          p1Json = JSON.parse(p1Text.slice(start, end + 1));
          appendDetail('Phase 1 JSON parsed successfully');
        } catch (e: any) {
          appendDetail(`Phase 1 generation failed: ${e?.message || 'unknown error'}`);
          p1Json = {
            session_info: { session_id: s.id, session_name: s.name, date_range: s.dateRange || '' },
            legislator_info: { name: currentLegislator || '', legislator_ids: [], entity_ids: [] },
            potential_pairs: [],
            summary_stats: {},
          };
        }
        incPercent(10);

        // Phase 2: deep dive on top pairs
        setProgressText(`Phase 2: Deep analysis — ${s.name}`);
        const pairs = (p1Json?.potential_pairs || []).filter((p) => (p.confidence_score ?? 0) >= 0.5).slice(0, 20);
        const confirmed: Phase2Confirmed[] = [];
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i];
          appendDetail(`Phase 2: fetching bill details for ${pair.bill_number}`);
          const { data: billDetails, error: billErr } = await supabase.rpc('get_bill_details', { p_bill_id: pair.bill_id });
          if (billErr) {
            appendDetail(`Bill details error for ${pair.bill_id}: ${billErr.message}`);
          }
          // Optional RTS
          let rts: any = null;
          try {
            const { data: rtsData } = await supabase.rpc('get_bill_rts', { p_bill_id: pair.bill_id });
            rts = rtsData || null;
          } catch {
            // ignore
          }

          const p2Prompt = `You are the AI Finance Analyzer. Using the bill details and the pairing, return JSON ONLY per the schema below.\n\nPairing:${JSON.stringify(pair)}\n\nBill details:${JSON.stringify(billDetails)}\nRTS (optional):${JSON.stringify(rts)}\n\nSchema:${JSON.stringify({
            confirmed_connections: [
              {
                bill_id: pair.bill_id,
                bill_number: pair.bill_number,
                bill_title: pair.bill_title || '',
                donors: pair.donors || [],
                total_donor_amount: 0,
                vote_or_sponsorship: pair.vote_or_sponsorship,
                vote_value: pair.vote_value || null,
                key_provisions: [],
                explanation: '',
                confidence: 0.9,
                severity: 'high',
              },
            ],
            session_summary: '',
            key_findings: [],
          }, null, 2)}\nReturn strict JSON.`;

          try {
            const p2 = await withTimeout(model.generateContent(p2Prompt), 90000);
            const p2Text = p2.response.text();
            const start = p2Text.indexOf('{');
            const end = p2Text.lastIndexOf('}');
            const obj: Phase2Output = JSON.parse(p2Text.slice(start, end + 1));
            confirmed.push(...(obj.confirmed_connections || []));
            appendDetail(`Phase 2 parsed for ${pair.bill_number}`);
          } catch (e: any) {
            appendDetail(`Phase 2 failed for ${pair.bill_number}: ${e?.message || 'parse error'}`);
          }
          incPercent(3);
        }

        setResults((prev) => [
          ...prev,
          {
            sessionName: s.name,
            phase1: p1Json || undefined,
            phase2: { confirmed_connections: confirmed },
          },
        ]);
      }

      setProgressText('Complete');
      setProgressPercent(100);
      setStep('results');
    } catch (err: any) {
      console.error('ReportGeneratorV2: client pipeline error:', err);
      setError(err.message || 'Client analysis failed');
      setStep('sessions');
    }
  };

  const filteredAutocomplete = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return autocomplete.filter((p) => p.display_name.toLowerCase().includes(term)).slice(0, MAX_AUTOCOMPLETE);
  }, [autocomplete, searchTerm]);

  // UI
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Report Generator (V2)</h1>

      {error && (
        <div style={{ color: '#b91c1c', background: '#fee2e2', padding: 10, borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {step === 'search' && (
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>Search Legislator</label>
          <input
            id="legislator-input-v2"
            type="text"
            value={searchTerm}
            onChange={handleInputChange}
            placeholder="Type at least 2 characters..."
            style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
          />
          {showAutocomplete && filteredAutocomplete.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, background: '#fff', border: '1px solid #e5e7eb', width: '100%', borderRadius: 6, marginTop: 6, maxHeight: 240, overflowY: 'auto' }}>
              {filteredAutocomplete.map((p) => (
                <div
                  key={p.person_id}
                  onClick={() => selectLegislator(p)}
                  style={{ padding: 8, cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 600 }}>{p.display_name}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => searchLegislator()}
              disabled={searching}
              style={{ padding: '8px 12px', borderRadius: 6, background: '#2563eb', color: '#fff' }}
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {step === 'sessions' && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            Available Sessions {currentLegislator ? `for ${currentLegislator}` : ''}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#e8f5e9', padding: 10, borderRadius: 6 }}>
              <input
                type="checkbox"
                checked={selectedSessions.includes('combined')}
                onChange={() => toggleSession('combined')}
              />
              <span>
                <strong>📊 All Sessions (Combined)</strong> — Analyze all sessions together in one report
              </span>
            </label>

            <div style={{ borderTop: '2px solid #e5e7eb', margin: '6px 0', textAlign: 'center', color: '#6b7280' }}>
              OR select individual sessions
            </div>

            {availableSessions.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: selectedSessions.includes('combined') ? 0.5 : 1 }}>
                <input
                  type="checkbox"
                  disabled={selectedSessions.includes('combined')}
                  checked={selectedSessions.includes(s.id)}
                  onChange={() => toggleSession(s.id)}
                />
                <span>
                  <strong>{s.name}</strong>
                  {s.dateRange ? ` — ${s.dateRange}` : ''}
                  {typeof s.vote_count === 'number' ? ` (${s.vote_count} votes)` : ''}
                </span>
              </label>
            ))}
          </div>

          {/* Incremental stats */}
          {selectedSessions.length === 1 && selectedSessions[0] !== 'combined' && incrementalStats && (
            <div style={{ marginTop: 12, padding: 10, border: '1px dashed #c7d2fe', background: '#eef2ff', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Incremental Analysis Available</div>
              <div style={{ display: 'grid', gap: 4 }}>
                <div>
                  <span style={{ color: '#6b7280' }}>Bills previously reported:</span>
                  &nbsp;<strong>{incrementalStats.analyzed_bills}</strong>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Reports generated:</span>
                  &nbsp;<strong>{incrementalStats.report_count}</strong>
                </div>
                {incrementalStats.last_analysis && (
                  <div>
                    <span style={{ color: '#6b7280' }}>Last analysis:</span>
                    &nbsp;<strong>{new Date(incrementalStats.last_analysis).toLocaleDateString()}</strong>
                  </div>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={excludeAnalyzedBills}
                  onChange={(e) => setExcludeAnalyzedBills(e.target.checked)}
                />
                <span>Exclude already analyzed bills</span>
              </label>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Custom Instructions (optional)</label>
            <textarea
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={4}
              style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
              placeholder="Add any custom guidance for analysis..."
            />
          </div>

          <button
            onClick={startAnalysis}
            disabled={!currentPersonId || (selectedSessions.length === 0)}
            style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, background: '#059669', color: '#fff' }}
          >
            Start Analysis
          </button>
        </div>
      )}

      {step === 'progress' && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 8 }}>{progressText}</div>
          <div style={{ height: 10, background: '#eee', borderRadius: 6 }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', background: '#2563eb', borderRadius: 6 }} />
          </div>
          <div style={{ marginTop: 12, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6, height: 200, overflowY: 'auto', background: '#fff' }}>
            {progressDetails.map((line, idx) => (
              <div key={idx} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: '#374151' }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'results' && (
        <div style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Results</h2>
          {results.length === 0 && (
            <div style={{ color: '#6b7280' }}>No results yet.</div>
          )}
          {results.map((r, idx) => (
            <div key={idx} style={{ padding: 12, border: '1px solid #eee', borderRadius: 6, marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{r.sessionName}</div>
              {r.reportPath && (
                <div style={{ marginTop: 6 }}>
                  Report saved at: <code>{r.reportPath}</code>
                </div>
              )}
            </div>
          ))}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={() => setStep('sessions')} style={{ padding: '8px 12px', borderRadius: 6, background: '#e5e7eb' }}>
              Back to Sessions
            </button>
            <button onClick={() => setStep('search')} style={{ padding: '8px 12px', borderRadius: 6, background: '#e5e7eb' }}>
              New Search
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportGeneratorPageV2;
