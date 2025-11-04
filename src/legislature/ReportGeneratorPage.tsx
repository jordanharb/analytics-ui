'use client';

import React, { useState, useEffect } from 'react';
import { supabase2 as supabase } from '../lib/supabase2';
import type { PersonSearchResult } from './lib/types';
import { searchPeopleWithSessions } from './lib/search';
import { GoogleGenerativeAI, SchemaType, type Tool } from '@google/generative-ai';
import { getGeminiKey, setGeminiKey } from '../lib/../lib/aiKeyStore';
import { embeddingService } from '../services/embeddingService';
import { ReportChatView } from './chat/ReportChatView';

const GEMINI_API_KEY = getGeminiKey() || import.meta.env.VITE_GOOGLE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;

interface Person extends PersonSearchResult {
  extra?: string; // Additional info like "3 legis IDs * 2 entities"
}

interface Session {
  id: number;
  name: string;
  dateRange: string;
  voteCount: number;
  startDate: string | null;
  endDate: string | null;
}

type SessionSelection = number;

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

interface DonorRecord {
  transaction_entity_id: number;
  entity_name: string;
  total_to_recipient: number;
  donation_count: number;
  top_employer?: string | null;
  top_occupation?: string | null;
  best_match?: number | null;
  entity_type_id?: number | null;
  entity_type_name?: string | null;
  [key: string]: any;
}

interface DonorTheme {
  id: string;
  title: string;
  description: string;
  summary?: string;
  industry_tags?: string[];
  heuristics_used?: string[];
  evidence?: string[];
  donor_ids: number[];
  donor_names: string[];
  donor_totals?: number[]; // Total donation amounts for each donor
  query_suggestions: string[];
  confidence?: number;
}

interface DonorThemeContext {
  legislatorName: string;
  sessionId: number;
  sessionName: string;
  sessionIdsForBills: number[];
  entityIds: number[];
  legislatorIds: number[];
  primaryLegislatorId: number;
  sessionLegislatorMap: Record<number, number[]>;
  donors: DonorRecord[];
  transactions: DonorTransaction[];
  daysBefore: number;
  daysAfter: number;
  sessionStartDate?: string | null;
  sessionEndDate?: string | null;
}

interface DonorTransaction {
  public_transaction_id: number;
  transaction_entity_id: number;
  transaction_date: string;
  amount: number;
  transaction_employer?: string | null;
  transaction_occupation?: string | null;
  memo?: string | null;
  committee_name?: string | null;
  transaction_entity_type_id?: number | null;
  entity_type_name?: string | null;
  transaction_entity_name?: string | null;
  [key: string]: any;
}

type GeminiModel = 'gemini-2.0-flash-exp' | 'gemini-2.0-flash-thinking-exp-01-21' | 'gemini-2.5-flash' | 'gemini-2.5-pro';

const ReportGeneratorPage: React.FC = () => {
  const [currentLegislator, setCurrentLegislator] = useState<string | null>(null);
  const [currentPersonId, setCurrentPersonId] = useState<number | null>(null);

  // Model selection for each analysis step
  const [singleCallModel, setSingleCallModel] = useState<GeminiModel>('gemini-2.5-pro');
  const [themeGenerationModel, setThemeGenerationModel] = useState<GeminiModel>('gemini-2.5-flash');
  const [queryExpansionModel, setQueryExpansionModel] = useState<GeminiModel>('gemini-2.5-flash');
  const [finalReportModel, setFinalReportModel] = useState<GeminiModel>('gemini-2.5-pro');
  const [currentLegislatorIds, setCurrentLegislatorIds] = useState<number[]>([]);
  const [primaryLegislatorId, setPrimaryLegislatorId] = useState<number | null>(null);
  const [currentEntityIds, setCurrentEntityIds] = useState<number[]>([]);
  const [availableSessions, setAvailableSessions] = useState<Session[]>([]);
  const [sessionLegislatorMap, setSessionLegislatorMap] = useState<Record<number, number[]>>({});
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
  const [currentStep, setCurrentStep] = useState<'search' | 'sessions' | 'progress' | 'results' | 'donorThemeThemes' | 'donorThemeProgress'>('search');
  const [analysisMode, setAnalysisMode] = useState<'twoPhase' | 'singleCall' | 'donorTheme'>('donorTheme');
  const [phase1Previews, setPhase1Previews] = useState<Record<string, Phase1RenderData>>({});
  const [activePhaseView, setActivePhaseView] = useState<'phase1' | 'phase2'>('phase2');
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>(getGeminiKey() || '');

  const normalizeLegislatorIds = (
    ids: Array<number | null | undefined> | null | undefined,
  ): number[] => {
    if (!ids || !Array.isArray(ids) || !ids.length) {
      return [];
    }

    const unique = new Set<number>();
    ids.forEach((value) => {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric)) {
        unique.add(numeric);
      }
    });

    const ordered = Array.from(unique);
    ordered.sort((a, b) => b - a);
    return ordered;
  };

  const applyLegislatorIds = (
    ids: Array<number | null | undefined> | null | undefined,
  ): number[] => {
    const normalized = normalizeLegislatorIds(ids);
    setCurrentLegislatorIds(normalized);
    setPrimaryLegislatorId(normalized.length ? normalized[0] : null);
    return normalized;
  };

  const [donorThemes, setDonorThemes] = useState<DonorTheme[] | null>(null);
  const [donorThemeContext, setDonorThemeContext] = useState<DonorThemeContext | null>(null);
  const [completedThemes, setCompletedThemes] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<Map<string, any>>(new Map());
  const [themeListId, setThemeListId] = useState<number | null>(null);
  const [existingThemeLists, setExistingThemeLists] = useState<any[]>([]);
  const [existingAnalysisReports, setExistingAnalysisReports] = useState<any[]>([]);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const [billDetails, setBillDetails] = useState<Map<number, any>>(new Map());
  const [loadingBillDetails, setLoadingBillDetails] = useState<Set<number>>(new Set());
  // const [loadingExistingThemes, setLoadingExistingThemes] = useState(false);

  // Check for existing theme lists and analysis reports when person or sessions change
  useEffect(() => {
    const checkExisting = async () => {
      if (currentPersonId && selectedSessions.length > 0) {
        // setLoadingExistingThemes(true);
        const existing = await checkExistingThemeLists();
        setExistingThemeLists(existing);

        // Load existing analysis reports for single sessions
        if (selectedSessions.length === 1 && typeof selectedSessions[0] === 'number') {
          const reports = await loadExistingAnalysisReports(currentPersonId, selectedSessions[0]);
          setExistingAnalysisReports(reports);
        } else {
          setExistingAnalysisReports([]);
        }
        // setLoadingExistingThemes(false);
      } else {
        setExistingThemeLists([]);
        setExistingAnalysisReports([]);
      }
    };

    checkExisting();
  }, [currentPersonId, selectedSessions]);

  // Track active donor theme selection for UI/analytics if needed.
  // Currently we only store context; selection can be inferred from analysis results.
  const [donorThemeProgress, setDonorThemeProgress] = useState<{ text: string; percent: number } | null>(null);

  // Query suggestions editing state
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editingQueries, setEditingQueries] = useState<string>('');

  // PDF and report management state

  const startEditingQueries = (themeId: string, currentQueries: string[]) => {
    setEditingThemeId(themeId);
    setEditingQueries(currentQueries.join('\n'));
  };

  const saveEditedQueries = () => {
    if (!editingThemeId || !donorThemes) return;

    const updatedThemes = donorThemes.map(theme => {
      if (theme.id === editingThemeId) {
        const newQueries = editingQueries
          .split('\n')
          .map(q => q.trim())
          .filter(Boolean);
        return { ...theme, query_suggestions: newQueries };
      }
      return theme;
    });

    setDonorThemes(updatedThemes);
    setEditingThemeId(null);
    setEditingQueries('');
  };

  const cancelEditingQueries = () => {
    setEditingThemeId(null);
    setEditingQueries('');
  };

  // Helper function to calculate and format date ranges
  const getDateRangeInfo = (context: DonorThemeContext) => {
    if (!context.sessionStartDate || !context.sessionEndDate) {
      return {
        sessionRange: 'Session dates unavailable',
        donationRange: `${context.daysBefore} days before to ${context.daysAfter} days after session`,
        donationStartDate: null,
        donationEndDate: null
      };
    }

    const sessionStart = new Date(context.sessionStartDate);
    const sessionEnd = new Date(context.sessionEndDate);

    const donationStart = new Date(sessionStart.getTime() - (context.daysBefore * 24 * 60 * 60 * 1000));
    const donationEnd = new Date(sessionStart.getTime() + (context.daysAfter * 24 * 60 * 60 * 1000));

    const formatDate = (date: Date) => date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });

    return {
      sessionRange: `${formatDate(sessionStart)} to ${formatDate(sessionEnd)}`,
      donationRange: `${formatDate(donationStart)} to ${formatDate(donationEnd)}`,
      donationStartDate: donationStart,
      donationEndDate: donationEnd
    };
  };

  // Markdown to HTML conversion for PDF
  const convertMarkdownToHtml = (markdown: string): string => {
    if (!markdown) return '';

    return markdown
      // Headers
      .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')

      // Bold text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

      // Lists - handle nested bullets
      .replace(/^[\s]*- (.*$)/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')

      // Clean up nested lists
      .replace(/<\/ul>\s*<ul>/g, '')

      // Paragraphs - convert double newlines to paragraph breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hul])/gm, '<p>')
      .replace(/(?<!>)$/gm, '</p>')

      // Clean up empty paragraphs and fix formatting
      .replace(/<p><\/p>/g, '')
      .replace(/<p>(<[hul])/g, '$1')
      .replace(/(<\/[hul]>)<\/p>/g, '$1')

      // Single line breaks
      .replace(/\n/g, '<br>');
  };

  // PDF Generation Functions
  const generateThemeListPDF = () => {
    if (!donorThemes || !donorThemeContext) return;

    const dateInfo = getDateRangeInfo(donorThemeContext);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Donor Theme Analysis - ${donorThemeContext.legislatorName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
          h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
          h2 { color: #1e40af; margin-top: 30px; }
          h3 { color: #374151; margin-top: 20px; }
          .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 30px; }
          .theme { break-inside: avoid; margin-bottom: 25px; padding: 15px; border: 1px solid #e5e7eb; border-radius: 8px; }
          .theme-title { font-weight: bold; color: #1e40af; font-size: 16px; margin-bottom: 8px; }
          .donors { margin: 10px 0; }
          .donor-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin: 10px 0; }
          .donor-item { padding: 6px 10px; background: #f3f4f6; border-radius: 4px; font-size: 12px; border-left: 3px solid #059669; }
          .donor-name { font-weight: 500; }
          .donor-amount { color: #059669; font-weight: bold; }
          .queries { margin-top: 15px; }
          .query-item { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 8px; background: #dbeafe; border-radius: 3px; font-size: 11px; }
          .summary { background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
          .type-indicator { font-size: 9px; padding: 2px 4px; border-radius: 2px; color: white; font-weight: bold; margin-left: 4px; }
          .type-pac { background: #dc2626; }
          .type-individual { background: #16a34a; }
          .type-business { background: #2563eb; }
          @media print { body { margin: 20px; } .theme { page-break-inside: avoid; } }
        </style>
      </head>
      <body>
        <h1>Donor Theme Analysis - ${donorThemeContext.legislatorName}</h1>
        <div class="subtitle">${donorThemeContext.sessionName} • Generated ${new Date().toLocaleDateString()}</div>

        <div class="summary">
          <h3>Analysis Summary</h3>
          <p><strong>Total Themes Identified:</strong> ${donorThemes.length}</p>
          <p><strong>Total Donors Analyzed:</strong> ${donorThemeContext.donors?.length || 0}</p>
          <p><strong>Total Transactions:</strong> ${donorThemeContext.transactions?.length || 0}</p>
          <p><strong>Session Period:</strong> ${dateInfo.sessionRange}</p>
          <p><strong>Donation Analysis Period:</strong> ${dateInfo.donationRange}</p>
        </div>

        ${donorThemes.map(theme => `
          <div class="theme">
            <div class="theme-title">${theme.title || 'Untitled Theme'}</div>
            <div style="margin: 8px 0; color: #6b7280; font-style: italic;">${theme.description || ''}</div>

            <div class="donors">
              <strong>Donors (${theme.donor_names?.length || 0}):</strong>
              <div class="donor-grid">
                ${(theme.donor_names || []).map((name, idx) => {
                  const total = theme.donor_totals?.[idx];
                  const displayTotal = total ? `$${total.toLocaleString()}` : 'Unknown';

                  // Get donor info for additional details
                  const donorInfo = donorThemeContext?.donors?.find(d => d.entity_name === name);
                  return `
                    <div class="donor-item">
                      <div class="donor-name">${name}</div>
                      <div class="donor-amount">${displayTotal}</div>
                      ${donorInfo?.entity_type_name ? `<div style="font-size: 10px; margin-top: 2px; color: #6b7280;">${donorInfo.entity_type_name}${donorInfo.top_employer ? ' • ' + donorInfo.top_employer : ''}${donorInfo.top_occupation ? ' • ' + donorInfo.top_occupation : ''}</div>` : ''}
                      ${donorInfo?.transaction_entity_id ? `<div style="font-size: 9px; margin-top: 2px; color: #9ca3af;">ID: ${donorInfo.transaction_entity_id}</div>` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>

          </div>
        `).join('')}
      </body>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };
  };

  const generateFinalReportPDF = (reportData: any) => {
    if (!reportData?.report) return;

    const dateInfo = donorThemeContext ? getDateRangeInfo(donorThemeContext) : {
      sessionRange: 'Session dates unavailable',
      donationRange: 'Donation dates unavailable'
    };

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const report = reportData.report;
    const printHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Campaign Finance Analysis Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; color: #333; }
          h1 { color: #1e40af; border-bottom: 3px solid #1e40af; padding-bottom: 10px; }
          h2 { color: #1e40af; margin-top: 30px; border-left: 4px solid #1e40af; padding-left: 12px; }
          h3 { color: #374151; margin-top: 20px; }
          .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 30px; }
          .summary { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .theme-section { break-inside: avoid; margin-bottom: 35px; background: #fefefe; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
          .confidence { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; margin: 8px 0; }
          .confidence-high { background: #dcfce7; color: #15803d; }
          .confidence-medium { background: #fef3c7; color: #d97706; }
          .confidence-low { background: #fee2e2; color: #dc2626; }
          .donor-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin: 15px 0; }
          .donor-item { margin: 8px 0; padding: 12px; background: #f8fafc; border-radius: 6px; border-left: 4px solid #059669; }
          .donor-name { font-weight: bold; color: #1e293b; }
          .donor-amount { color: #059669; font-weight: bold; font-size: 14px; }
          .donor-details { font-size: 12px; color: #64748b; margin-top: 4px; }
          .bill-list { margin: 15px 0; }
          .bill-item { margin: 12px 0; padding: 15px; background: #f1f5f9; border-radius: 6px; border-left: 4px solid #2563eb; }
          .bill-title { font-weight: bold; color: #1e40af; }
          .bill-details { margin: 5px 0; font-size: 13px; }
          .vote-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin: 0 4px; }
          .vote-yes { background: #dcfce7; color: #15803d; }
          .vote-no { background: #fee2e2; color: #dc2626; }
          .markdown-content { margin-top: 30px; line-height: 1.8; }
          .markdown-content h1, .markdown-content h2, .markdown-content h3, .markdown-content h4 {
            color: #1e40af; margin-top: 20px; margin-bottom: 10px;
          }
          .markdown-content h4 {
            font-size: 16px; border-left: 3px solid #1e40af; padding-left: 8px;
          }
          .markdown-content p {
            margin: 10px 0; text-align: justify;
          }
          .markdown-content ul {
            margin: 15px 0; padding-left: 20px;
          }
          .markdown-content li {
            margin: 8px 0; line-height: 1.6;
          }
          .markdown-content strong {
            color: #1f2937; font-weight: 600;
          }
          @media print { body { margin: 20px; } .theme-section { page-break-inside: avoid; } }
        </style>
      </head>
      <body>
        <h1>Campaign Finance Analysis Report</h1>
        <div class="subtitle">${report.session_info?.session_name || 'Unknown Session'} • Generated ${new Date().toLocaleDateString()}</div>

        <div class="summary">
          <h2>Executive Summary</h2>
          <p>${report.overall_summary || 'No summary available.'}</p>
          <p><strong>Session Period:</strong> ${dateInfo.sessionRange}</p>
          <p><strong>Donation Analysis Period:</strong> ${dateInfo.donationRange}</p>
        </div>

        ${(report.themes || []).map((theme: any) => {
          const confidence = theme.confidence || 0;
          const confidenceClass = confidence >= 0.8 ? 'confidence-high' : confidence >= 0.5 ? 'confidence-medium' : 'confidence-low';
          const confidenceText = confidence >= 0.8 ? 'HIGH CONFIDENCE' : confidence >= 0.5 ? 'MEDIUM CONFIDENCE' : 'LOW CONFIDENCE';

          return `
            <div class="theme-section">
              <h2>${theme.theme}</h2>
              <div class="confidence ${confidenceClass}">${confidenceText} (${Math.round(confidence * 100)}%)</div>
              <p><strong>Summary:</strong> ${theme.summary || theme.description}</p>

              <h3>Donors (${theme.donors?.length || 0})</h3>
              <div class="donor-list">
                ${(theme.donors || []).map((donor: any) => `
                  <div class="donor-item">
                    <div class="donor-name">${donor.name}</div>
                    <div class="donor-amount">${donor.total}</div>
                    <div class="donor-details">
                      ${donor.employer ? `<div><strong>Employer:</strong> ${donor.employer}</div>` : ''}
                      ${donor.occupation ? `<div><strong>Occupation:</strong> ${donor.occupation}</div>` : ''}
                      ${donor.type ? `<div><strong>Type:</strong> ${donor.type}</div>` : ''}
                      ${(donor.transaction_ids || donor.donation_dates) ? `<div><strong>Transactions:</strong> ${(donor.transaction_ids || []).length} donations on ${(donor.donation_dates || []).join(', ')}</div>` : ''}
                      ${donor.notes ? `<div><em>${donor.notes}</em></div>` : ''}
                    </div>
                  </div>
                `).join('')}
              </div>

              <h3>Related Bills (${theme.bills?.length || 0})</h3>
              <div class="bill-list">
                ${(theme.bills || []).map((bill: any) => `
                  <div class="bill-item">
                    <div class="bill-title">${bill.bill_number} - ${bill.title}</div>
                    <div class="bill-details">
                      <span class="vote-badge ${bill.vote === 'Y' ? 'vote-yes' : 'vote-no'}">VOTE: ${bill.vote || 'Unknown'}</span>
                      <strong>Reason:</strong> ${bill.reason}
                    </div>
                    ${bill.takeaways ? `<div style="margin-top: 8px;"><strong>Key Takeaways:</strong> ${bill.takeaways}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}

        ${report.transactions_cited ? `
          <div class="summary">
            <h2>Transaction Details</h2>
            <div style="font-size: 12px; line-height: 1.4;">
              ${(report.transactions_cited || []).map((txn: any) => `
                <div style="margin: 8px 0; padding: 8px; background: #f8fafc; border-radius: 4px;">
                  <strong>ID ${txn.public_transaction_id}:</strong> ${txn.donor} gave $${txn.amount?.toLocaleString()} on ${txn.date}
                  ${txn.linked_bills ? `<div style="margin-top: 4px; color: #6b7280;">Linked to: ${txn.linked_bills.join(', ')}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${report.markdown_summary ? `
          <div class="markdown-content">
            <h2>Detailed Analysis</h2>
            ${convertMarkdownToHtml(report.markdown_summary)}
          </div>
        ` : ''}
      </body>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
      printWindow.close();
    };
  };

  // Database functions for saving/loading reports
  const saveThemeListToDatabase = async () => {
    if (!donorThemes || !donorThemeContext) return null;

    try {
      const { data, error } = await supabase.rpc('save_donor_theme_list', {
        p_person_id: currentPersonId,
        p_legislator_name: donorThemeContext.legislatorName,
        p_session_id: donorThemeContext.sessionId,
        p_session_name: donorThemeContext.sessionName,
        p_model_used: themeGenerationModel,
        p_themes_json: donorThemes,
        p_donor_context_json: donorThemeContext,
        p_total_donors: donorThemeContext.donors?.length || 0,
        p_total_transactions: donorThemeContext.transactions?.length || 0
      });

      if (error) throw error;

      const listId = typeof data === 'number' ? data : (Array.isArray(data) ? data[0] : null);
      if (listId) {
        setThemeListId(listId);
        console.log('Theme list saved successfully with ID:', listId);
        return listId;
      }
      return null;
    } catch (err) {
      console.error('Error saving theme list:', err);
      return null;
    }
  };

  const saveReportToDatabase = async (themeId: string, reportData: any) => {
    if (!themeListId && !await saveThemeListToDatabase()) {
      console.error('Cannot save report without theme list ID');
      return;
    }

    const listId = themeListId || await saveThemeListToDatabase();
    if (!listId || !donorThemeContext) return;

    const theme = donorThemes?.find(t => t.id === themeId);
    if (!theme) return;

    try {
      const { data, error } = await supabase.rpc('save_theme_analysis_report', {
        p_theme_list_id: listId,
        p_theme_id: themeId,
        p_theme_title: theme.title,
        p_person_id: currentPersonId,
        p_legislator_name: donorThemeContext.legislatorName,
        p_session_id: donorThemeContext.sessionId,
        p_session_name: donorThemeContext.sessionName,
        p_model_used: finalReportModel,
        p_report_json: reportData,
        p_confidence_score: theme.confidence
      });

      if (error) throw error;
      setSavedReports(prev => new Map(prev.set(themeId, { reportId: data, reportData })));
      console.log('Report saved successfully with ID:', data);
    } catch (err) {
      console.error('Error saving report:', err);
    }
  };

  const loadSavedReport = async (themeId: string) => {
    console.log('Loading saved report for theme:', themeId);
    console.log('Current savedReports Map:', savedReports);
    console.log('Theme list ID:', themeListId);

    const savedReport = savedReports.get(themeId);
    if (savedReport) {
      console.log('Found cached report reference...');

      // If reportData is already loaded, use it directly
      if (savedReport.reportData) {
        console.log('Using cached report data');
        setAnalysisResults([{
          sessionName: `Theme Analysis`,
          report: savedReport.reportData
        }]);
        setCurrentStep('results');
        return;
      }

      // If reportData is null, load it from the database using the reportId
      console.log('Loading full report data from database for report ID:', savedReport.reportId);
      try {
        const { data: fullReport, error: reportError } = await supabase
          .from('cf_theme_analysis_reports')
          .select('report_json')
          .eq('id', savedReport.reportId)
          .single();

        if (reportError) {
          console.error('Error loading full report:', reportError);
          return;
        }

        if (fullReport?.report_json) {
          console.log('Successfully loaded full report data');
          // Cache the loaded data
          setSavedReports(prev => new Map(prev.set(themeId, {
            reportId: savedReport.reportId,
            reportData: fullReport.report_json
          })));

          setAnalysisResults([{
            sessionName: 'Donor Theme Analysis',
            report: fullReport.report_json
          }]);
          setCurrentStep('results');
          return;
        } else {
          console.error('Report JSON not found in database record');
          return;
        }
      } catch (error) {
        console.error('Error loading report from database:', error);
        return;
      }
    }

    // Load from database using theme list ID and theme ID
    if (!themeListId) {
      console.error('No theme list ID available to load saved report');
      return;
    }

    console.log('Loading report from database...');

    try {
      const { data, error } = await supabase.rpc('get_theme_analysis_reports', {
        p_theme_list_id: themeListId
      });

      if (error) {
        console.error('RPC error:', error);
        throw error;
      }

      console.log('RPC returned data:', data);

      const reportRecord = data?.find((r: any) => r.theme_id === themeId);
      if (!reportRecord) {
        console.error('No saved report found for theme:', themeId);
        console.log('Available theme IDs:', data?.map((r: any) => r.theme_id));
        return;
      }

      console.log('Found report record:', reportRecord);

      // Load the full report JSON from the record
      const { data: fullReport, error: reportError } = await supabase
        .from('cf_theme_analysis_reports')
        .select('report_json')
        .eq('id', reportRecord.id)
        .single();

      if (reportError) {
        console.error('Report loading error:', reportError);
        throw reportError;
      }
      if (!fullReport?.report_json) {
        console.error('No report JSON found');
        return;
      }

      setAnalysisResults([{
        sessionName: `Theme Analysis`,
        report: fullReport.report_json
      }]);
      setCurrentStep('results');
      console.log('Successfully loaded saved report for theme:', themeId);
    } catch (err) {
      console.error('Error loading saved report:', err);
    }
  };

  // Function to load existing analysis reports (both two-phase and single-call)
  const loadExistingAnalysisReports = async (personId: number, sessionId: number): Promise<any[]> => {
    try {
      // Check both theme analysis reports and single-step reports
      const [themeReports, singleStepReports] = await Promise.all([
        // Multi-step theme analysis reports
        supabase
          .from('cf_theme_analysis_reports')
          .select(`
            id,
            created_at,
            session_id,
            theme_title,
            model_used,
            generation_date,
            report_json,
            confidence_score,
            donor_count,
            bill_count
          `)
          .eq('person_id', personId)
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(5),

        // Single-step reports (theme_list_id is null for single-step)
        supabase
          .from('cf_theme_analysis_reports')
          .select(`
            id,
            created_at,
            session_id,
            theme_title,
            model_used,
            generation_date,
            report_json,
            confidence_score,
            donor_count,
            bill_count
          `)
          .eq('person_id', personId)
          .eq('session_id', sessionId)
          .is('theme_list_id', null)
          .order('created_at', { ascending: false })
          .limit(5)
      ]);

      const allReports = [];

      if (themeReports.data) {
        allReports.push(...themeReports.data.map(r => ({ ...r, report_type: 'theme_analysis' })));
      }

      if (singleStepReports.data) {
        allReports.push(...singleStepReports.data.map(r => ({ ...r, report_type: 'single_step' })));
      }

      if (themeReports.error) {
        console.error('Error loading theme analysis reports:', themeReports.error);
      }

      if (singleStepReports.error) {
        console.error('Error loading single-step reports:', singleStepReports.error);
      }

      // Sort combined results by created_at and return up to 10
      return allReports
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10);

    } catch (err) {
      console.error('Error loading analysis reports:', err);
      return [];
    }
  };

  // Function to fetch full bill details
  const fetchBillDetails = async (billId: number) => {
    if (billDetails.has(billId)) {
      return billDetails.get(billId);
    }

    setLoadingBillDetails(prev => new Set(prev.add(billId)));

    try {
      const { data, error } = await supabase.rpc('get_bill_details', {
        p_bill_id: billId
      });

      if (error) {
        console.error('Error fetching bill details:', error);
        return null;
      }

      setBillDetails(prev => new Map(prev.set(billId, data)));
      return data;
    } catch (err) {
      console.error('Error fetching bill details:', err);
      return null;
    } finally {
      setLoadingBillDetails(prev => {
        const newSet = new Set(prev);
        newSet.delete(billId);
        return newSet;
      });
    }
  };

  // Function to toggle bill expansion
  const toggleBillExpansion = async (billId: number) => {
    if (expandedBills.has(billId)) {
      // Collapse
      setExpandedBills(prev => {
        const newSet = new Set(prev);
        newSet.delete(billId);
        return newSet;
      });
    } else {
      // Expand and fetch details if needed
      setExpandedBills(prev => new Set(prev.add(billId)));
      if (!billDetails.has(billId)) {
        await fetchBillDetails(billId);
      }
    }
  };

  // Function to check for existing theme lists for the current person and sessions
  const checkExistingThemeLists = async (): Promise<any[]> => {
    if (!currentPersonId || selectedSessions.length === 0) return [];

    try {
      const { data, error } = await supabase
        .from('cf_donor_theme_lists')
        .select('id, created_at, model_used, total_donors, total_transactions, themes_json')
        .eq('person_id', currentPersonId)
        .in('session_id', selectedSessions)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error checking existing theme lists:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error checking existing theme lists:', error);
      return [];
    }
  };

  const loadExistingThemeList = async (themeListId: number) => {
    try {
      const { data, error } = await supabase
        .from('cf_donor_theme_lists')
        .select('*')
        .eq('id', themeListId)
        .single();

      if (error) {
        console.error('Error loading theme list:', error);
        return;
      }

      if (data) {
        // Load the theme list data
        setThemeListId(data.id);
        setDonorThemes(data.themes_json || []);
        setDonorThemeContext(data.donor_context_json || {});
        setCurrentStep('donorThemeThemes');

        // Load existing reports for this theme list
        await loadExistingReportsForThemes(data.id);

        console.log('Successfully loaded existing theme list:', data.id);
      }
    } catch (error) {
      console.error('Error loading existing theme list:', error);
    }
  };

  const loadExistingReportsForThemes = async (listId?: number) => {
    const targetListId = listId || themeListId;
    if (!targetListId) return;

    try {
      const { data, error } = await supabase.rpc('get_theme_analysis_reports', {
        p_theme_list_id: targetListId
      });

      if (error) throw error;

      const reportsMap = new Map();
      data?.forEach((report: any) => {
        reportsMap.set(report.theme_id, {
          reportId: report.id,
          reportData: null // We'll load the full data when needed
        });
      });

      setSavedReports(reportsMap);
      console.log(`Loaded ${reportsMap.size} existing reports for theme list`);
    } catch (err) {
      console.error('Error loading existing reports:', err);
    }
  };

const baseGenerationConfig = {
  temperature: 0.6,
  maxOutputTokens: 8192,
};

// Model-specific token limits based on official Google API specs
const getMaxOutputTokens = (model: string): number => {
  if (model.includes('gemini-2.5-pro') || model.includes('gemini-2.5-flash')) {
    return 65536; // Both 2.5 Pro and Flash support up to 65,536 output tokens
  } else if (model.includes('gemini-2.0-flash-thinking')) {
    return 65536; // Thinking models also support high output limits
  }
  return 8192; // Default fallback for older models
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

const DONOR_THEME_SYSTEM_PROMPT = `You are a progressive investigative journalist producing long-form, fully-cited reports analyzing campaign finance to expose corporate influence and protect public interests.

Hard rules:
1) EXCLUDE funding from the Citizens Clean Elections Commission, EXCLUDE "Multiple Contributors," and EXCLUDE the candidate's own committees. Do not mention them.
2) ALWAYS cite individual transactions: donor name, amount, date, and public_transaction_id.
3) Build 12-20+ distinct donor themes (cap 30) in the first pass. Be exhaustive across multiple lenses:
   * Industry/sector (employer, occupation, PAC category, entity_type/group)
   * Corporate and family networks (shared surnames, shared addresses, known company officers)
   * PAC coalitions and affiliate families
   * Geography (out-of-state vs in-state, specific cities/regions)
   * Timing patterns (donation clusters around bill/vote dates)
   * Contribution size patterns (max-out donors, frequent small donors--excluding CCEC)
4) For each theme, generate 15-30 search queries mixing jargon, synonyms, and statute phrasing (e.g., "A.R.S.", "section", "statute", "amend", "repeal", "exemption", "fee", "preemption"). PRIORITIZE identifying potentially harmful bills that could undermine public interests, harm marginalized communities, or benefit wealthy donors at the expense of ordinary citizens.
5) Iteratively call tools to run EXHAUSTIVE bill searches until two consecutive iterations yield no new bills or ~1000 bills are accumulated. Lower p_min_text_score stepwise: 0.35->0.25->0.15->0.10 when needed.
6) Every cited bill must include at least one statute reference and one excerpt (from bills.bill_summary or bills.bill_text), plus the legislator's vote/sponsor context.
7) Return STRICT JSON exactly matching the requested schema when asked. Write as exhaustively and comprehensively as possible, including extensive bill text quotes and detailed analysis. Prioritize thoroughness over brevity.`;

const chunkArray = <T,>(values: T[], size: number): T[][] => {
  if (size <= 0) return [values];
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
};

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const sanitizeSearchQuery = (query: string): string => {
  if (!query) return '';
  return query
    .replace(/["']/g, '')
    .replace(/\btitle\s+\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const fetchPersonSessions = async (personId: number): Promise<{
  personId: number;
  sessionCount: number;
  sessions: Session[];
}> => {
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_person_sessions', {
    p_person_id: personId,
  });
  if (rpcError) throw rpcError;

  const sessionsFromRpc = (rpcData ?? []) as Array<{
    session_id: number;
    session_name: string | null;
    year: number | null;
    start_date: string | null;
    end_date: string | null;
    vote_count?: number | null;
    date_range_display?: string | null;
  }>;

  const sessionIds = sessionsFromRpc.map((s) => s.session_id).filter((id) => Number.isFinite(id));

  if (!sessionIds.length) {
    return { personId, sessionCount: 0, sessions: [] };
  }

  const { data: mvDates, error: mvDatesError } = await supabase
    .from('mv_sessions_with_dates')
    .select('session_id, first_vote_date, last_vote_date, official_start_date, official_end_date, date_range_display')
    .in('session_id', sessionIds);
  if (mvDatesError) {
    console.warn('mv_sessions_with_dates lookup failed, falling back to RPC values only', mvDatesError);
  }

  const mvDateMap = new Map<number, any>((mvDates ?? []).map((record: any) => [record.session_id, record]));

  const { data: mvCounts, error: mvCountsError } = await supabase
    .from('mv_person_session_bill_counts')
    .select('session_id, bill_count')
    .eq('person_id', personId)
    .in('session_id', sessionIds);
  if (mvCountsError) {
    console.warn('mv_person_session_bill_counts lookup failed; defaulting vote counts to RPC values', mvCountsError);
  }

  const countsMap = new Map<number, number>((mvCounts ?? []).map((record: any) => [record.session_id, Number(record.bill_count) || 0]));

  const sessions: Session[] = sessionsFromRpc.map((session) => {
    const mv = mvDateMap.get(session.session_id) as any | undefined;
    const start = mv?.first_vote_date ?? mv?.official_start_date ?? session.start_date ?? null;
    const end = mv?.last_vote_date ?? mv?.official_end_date ?? session.end_date ?? null;
    const dateRange = mv?.date_range_display ?? (start && end ? `${start} - ${end}` : '');
    const voteCount = countsMap.get(session.session_id) ?? session.vote_count ?? 0;

    return {
      id: session.session_id,
      name: session.session_name ?? `Session ${session.session_id}`,
      startDate: start,
      endDate: end,
      dateRange,
      voteCount,
    };
  });

  return {
    personId,
    sessionCount: sessions.length,
    sessions,
  };
};

const buildTransactionWindowPayload = (args: {
  personId?: number | null;
  recipientEntityIds?: number[] | null;
  sessionId: number;
  includeTransactionEntityIds?: number[] | null;
  daysBefore?: number;
  daysAfter?: number;
  minAmount?: number;
  excludeNamePatterns?: string[] | null;
  excludeSelfCommittees?: boolean;
}) => {
  const {
    personId = null,
    recipientEntityIds = null,
    sessionId,
    includeTransactionEntityIds = null,
    daysBefore = 45,
    daysAfter = 45,
    minAmount = 0,
    excludeNamePatterns = ['citizens clean elections', 'multiple contributors'],
    excludeSelfCommittees = true,
  } = args;

  return {
    p_person_id: personId,
    p_recipient_entity_ids: recipientEntityIds,
    p_session_id: sessionId,
    p_include_transaction_entity_ids: includeTransactionEntityIds ?? [],
    p_days_before: daysBefore,
    p_days_after: daysAfter,
    p_min_amount: minAmount,
    p_exclude_entity_ids: null,
    p_exclude_name_patterns: excludeNamePatterns ?? ['citizens clean elections', 'multiple contributors'],
    p_exclude_self_committees: excludeSelfCommittees,
    p_from: null,
    p_to: null,
  };
};

const listDonorTransactionsWindow = async (args: {
  personId?: number | null;
  recipientEntityIds?: number[] | null;
  sessionId: number;
  includeTransactionEntityIds?: number[] | null;
  daysBefore?: number;
  daysAfter?: number;
  minAmount?: number;
  excludeNamePatterns?: string[] | null;
  excludeSelfCommittees?: boolean;
}): Promise<DonorTransaction[]> => {
  const payload = buildTransactionWindowPayload(args);
  const { data, error } = await supabase.rpc('list_donor_transactions_window', payload);
  if (error) throw error;
  return (data ?? []) as DonorTransaction[];
};

const searchBillsForLegislatorRpc = async (args: {
  sessionId: number;
  personId: number;
  searchTerms?: string[] | null;
  queryVectors?: string[] | null;
  minScore?: number;
  limit?: number;
  offset?: number;
}): Promise<any[]> => {
  const {
    sessionId,
    personId,
    searchTerms = null,
    queryVectors = null,
    minScore = 0.3,
    limit = 500,
    offset = 0,
  } = args;

  const { data, error } = await supabase.rpc('search_bills_for_legislator_optimized', {
    p_session_id: sessionId,
    p_person_id: personId,
    p_search_terms: searchTerms,
    p_query_vecs: queryVectors,
    p_min_text_score: minScore,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw error;
  return data ?? [];
};

function logAndExecute<T>(
  functionName: string,
  params: unknown,
  execution: () => T | Promise<T>
): T | Promise<T> {
  const start = nowMs();
  console.groupCollapsed(`[FUNCTION CALL] ==> ${functionName}`);
  console.log('INPUT:', params);
  console.groupEnd();

  const finalize = (status: 'SUCCESS' | 'FAILED', payload: unknown) => {
    const duration = Math.round(nowMs() - start);
    console.groupCollapsed(`[FUNCTION CALL] <== ${functionName} ${status} (${duration}ms)`);
    if (status === 'SUCCESS') {
      console.log('OUTPUT:', payload);
    } else {
      console.error('ERROR:', payload);
    }
    console.groupEnd();
  };

  try {
    const result = execution();
    if (result && typeof (result as PromiseLike<T>).then === 'function') {
      return Promise.resolve(result).then(
        (value) => {
          finalize('SUCCESS', value);
          return value;
        },
        (error: unknown) => {
          finalize('FAILED', error);
          throw error;
        }
      ) as T | Promise<T>;
    }

    finalize('SUCCESS', result);
    return result;
  } catch (error: unknown) {
    finalize('FAILED', error);
    throw error;
  }
}

const startFunctionLog = (functionName: string, params: unknown) => {
  const start = nowMs();
  console.groupCollapsed(`[FUNCTION CALL] ==> ${functionName}`);
  console.log('INPUT:', params);
  console.groupEnd();

  const finalize = (status: 'SUCCESS' | 'FAILED', payload: unknown) => {
    const duration = Math.round(nowMs() - start);
    console.groupCollapsed(`[FUNCTION CALL] <== ${functionName} ${status} (${duration}ms)`);
    if (status === 'SUCCESS') {
      console.log('OUTPUT:', payload);
    } else {
      console.error('ERROR:', payload);
    }
    console.groupEnd();
  };

  return {
    success: (output: unknown) => finalize('SUCCESS', output),
    failure: (error: unknown) => finalize('FAILED', error),
  };
};

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

const extractJsonObject = (text: string) => {
  const cleaned = text.replace(/```json\s*|```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Response did not contain a JSON object.');
  }
  return cleaned.slice(firstBrace, lastBrace + 1);
};

// formatCurrency helper was previously used to render donor totals in interim logs;
// removed to satisfy TypeScript unused checks.

const callGeminiJson = async <T = any>(prompt: string, { system, temperature = baseGenerationConfig.temperature, model = 'gemini-2.5-flash' }: { system?: string; temperature?: number; model?: GeminiModel } = {}): Promise<T> => {
  return logAndExecute('callGeminiJson', { prompt, system, temperature, model }, async () => {
    if (!GEMINI_API_KEY) {
      throw new Error('Missing Gemini API key');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

    const body: any = {
      contents: [{ role: 'user', parts: [{ text: prompt }]}],
      generationConfig: {
        temperature,
        maxOutputTokens: getMaxOutputTokens(model),
      },
    };

    if (system) {
      body.systemInstruction = { role: 'system', parts: [{ text: system }] };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Gemini error: ${response.status} ${text}`);
    }

    const data = await response.json();
    console.log('Gemini raw response:', JSON.stringify(data, null, 2));
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const textContent = parts.filter((part: any) => part.text).map((part: any) => part.text).join('\n');

    if (!textContent) {
      console.error('No text content found in Gemini response:', {
        data,
        candidate,
        parts,
        model
      });
      throw new Error(`Gemini returned no text content. Model: ${model}, Parts: ${JSON.stringify(parts)}`);
    }

    const jsonSlice = extractJsonObject(textContent);
    return parseJsonLoose(jsonSlice) as T;
  });
};

const callSupabaseRpc = async <T = any>(fn: string, args: Record<string, unknown>): Promise<T> => {
  return logAndExecute(fn, args, async () => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      throw error;
    }
    return data as T;
  }) as Promise<T>;
};

const callMcpToolProxy = async <T = any>(tool: string, args: Record<string, unknown>): Promise<T> => {
  return logAndExecute(`MCP Proxy: ${tool}`, args, async () => {
    const response = await fetch(`/api/mcp/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.success === false) {
      const message = payload?.error || `Tool ${tool} failed with status ${response.status}`;
      throw new Error(message);
    }
    return (payload.result ?? payload) as T;
  }) as Promise<T>;
};

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    return logAndExecute<void>('handleInputChange', { value: e.target.value }, () => {
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
    });
  };

  const searchCachedLegislators = async (term: string) => {
    return (logAndExecute<Person[]>('searchCachedLegislators', { term }, async () => {
      const people = await searchPeopleWithSessions({ query: term, limit: 10 });

      const mappedData: Person[] = people
        .map((person) => ({
          ...person,
          extra: person.summary ?? `${person.legislator_count} legislators * ${person.entity_count} entities`,
        }))
        .filter((item) => (item.all_legislator_ids?.length || 0) > 0);

      setAutocompleteResults(mappedData);
      setShowAutocomplete(mappedData.length > 0);
      return mappedData;
    }) as Promise<Person[]>).catch((err) => {
      console.error('Autocomplete error:', err);
      setAutocompleteResults([]);
      setShowAutocomplete(false);
      return [];
    });
  };

  const selectLegislator = (person: Partial<Person>) => {
    return logAndExecute<void>('selectLegislator', { person }, () => {
      setSearchTerm(person.display_name || '');
      setShowAutocomplete(false);
      setSessionLegislatorMap({});
      applyLegislatorIds(person.all_legislator_ids ?? []);
      searchLegislator(person as Person);
    });
  };

const searchLegislator = async (selectedPerson?: Person) => {
    const name = selectedPerson?.display_name || searchTerm;
    if (!name) {
      setError('Please enter or select a legislator name');
      return;
    }

    setSessionLegislatorMap({});
    applyLegislatorIds(selectedPerson?.all_legislator_ids ?? []);
    setCurrentEntityIds([]);
    setSearchingLegislator(true);
    setError(null);

    return logAndExecute<{ personId: number | null; sessionCount: number } | null>(
      'searchLegislator',
      { name, selectedPerson },
      async () => {
        try {
          let sessions: Session[] = [];
          let personId: number | null = null;

          if (selectedPerson?.person_id) {
            personId = selectedPerson.person_id;

            try {
              const sessionResult = await fetchPersonSessions(personId);
              sessions = sessionResult.sessions.map((session) => ({
                id: session.id,
                name: session.name,
                dateRange: session.dateRange,
                voteCount: session.voteCount,
                startDate: session.startDate,
                endDate: session.endDate,
              }));
            } catch (sessionsError) {
              console.error('Failed to load sessions for person', sessionsError);
              sessions = [];
            }

            try {
              if (!selectedPerson?.all_legislator_ids?.length) {
                const { data: legislatorRows, error: legislatorError } = await supabase
                  .from('rs_person_legislators')
                  .select('legislator_id')
                  .eq('person_id', personId);
                if (!legislatorError && legislatorRows) {
                  const uniqueIds = Array.from(new Set(legislatorRows.map((row: any) => Number(row.legislator_id))));
                  applyLegislatorIds(uniqueIds);
                }
              } else {
                applyLegislatorIds(selectedPerson.all_legislator_ids);
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

              try {
                const { data: sessionLegRows, error: sessionLegError } = await supabase
                  .from('rs_person_leg_sessions')
                  .select('session_id, legislator_id')
                  .eq('person_id', personId);

                if (!sessionLegError && sessionLegRows) {
                  const sessionMap: Record<number, number[]> = {};
                  sessionLegRows.forEach((row: any) => {
                    const sessionId = Number(row.session_id);
                    const legislatorId = Number(row.legislator_id);
                    if (!Number.isFinite(sessionId) || !Number.isFinite(legislatorId)) return;
                    if (!sessionMap[sessionId]) {
                      sessionMap[sessionId] = [];
                    }
                    sessionMap[sessionId].push(legislatorId);
                  });

                  Object.keys(sessionMap).forEach((key) => {
                    const sessionId = Number(key);
                    sessionMap[sessionId] = normalizeLegislatorIds(sessionMap[sessionId]);
                  });

                  const combinedFromSessions = normalizeLegislatorIds(
                    sessionLegRows.map((row: any) => Number(row.legislator_id)),
                  );
                  if (combinedFromSessions.length) {
                    applyLegislatorIds(combinedFromSessions);
                  }
                  setSessionLegislatorMap(sessionMap);
                } else {
                  setSessionLegislatorMap({});
                }
              } catch (sessionLegErr) {
                console.warn('Failed to load session->legislator mapping', sessionLegErr);
                setSessionLegislatorMap({});
              }
            } catch (fetchErr) {
              console.log('Optional legislator/entity lookup failed', fetchErr);
            }
          }

        setCurrentLegislator(name);
        setCurrentPersonId(personId);
        setAvailableSessions(sessions);
        setCurrentStep('sessions');
        return {
          personId,
          sessionCount: sessions.length,
          sessions: sessions.map((session) => ({
            id: session.id,
            name: session.name,
            dateRange: session.dateRange,
            voteCount: session.voteCount,
            startDate: session.startDate,
            endDate: session.endDate,
          })),
        };
        } catch (err: any) {
          setError(err?.message || 'Failed to search legislator');
          throw err;
        } finally {
          setSearchingLegislator(false);
        }
      }
    );
  };

  const toggleSession = (sessionId: SessionSelection) => {
    logAndExecute<SessionSelection[]>('toggleSession', { sessionId, previous: selectedSessions }, () => {
      let next: SessionSelection[] = [];
      setSelectedSessions((prev: SessionSelection[]) => {
        const exists = prev.includes(sessionId);
        next = exists ? prev.filter((s) => s !== sessionId) : [...prev, sessionId];
        return next;
      });
      return next;
    });
  };

  const runTwoPhaseAnalysisInternal = async () => {
    const logger = startFunctionLog('runTwoPhaseAnalysisInternal', {
      selectedSessions,
      analysisMode,
      currentPersonId,
      customInstructions: customInstructions?.trim() ? '[provided]' : '[empty]'
    });
    try {
      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-pro',
        generationConfig: baseGenerationConfig,
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are a progressive investigative journalist analyzing campaign finance to expose corporate influence and protect public interests. When analyzing bills, prioritize identifying potentially harmful legislation that could undermine public interests, harm marginalized communities, or benefit wealthy/corporate donors at the expense of ordinary citizens. Think exhaustively before replying and use the maximum internal reasoning budget available.' }],
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
        const isCombined = selectedSessions.length > 1;
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
            s.startDate && (!earliest || s.startDate < earliest) ? s.startDate : earliest, '');
          endDate = sessions.reduce((latest, s) =>
            s.endDate && (!latest || s.endDate > latest) ? s.endDate : latest, '');
          sessionIdsForQuery = Array.from(new Set(sessions.map(s => s.id).filter((id): id is number => typeof id === 'number')));
        } else {
          const session = availableSessions.find(s => s.id === sessionId);
          if (!session) {
            throw new Error(`Session ${sessionId} not found`);
          }
          sessionName = session.name;
          startDate = session.startDate || '';
          endDate = session.endDate || '';
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
          const transactionDate = donation.donation_date;
          const amountNumber = Number(donation.amount ?? donation.donation_amt ?? 0);
          const daysFromSession = transactionDate && !Number.isNaN(sessionStartDateObj.getTime())
            ? Math.round((new Date(transactionDate).getTime() - sessionStartDateObj.getTime()) / (1000 * 60 * 60 * 24))
            : null;

          // Use entity type name from database lookup, with fallback logic
          let donorType = donation.entity_type_name || 'Unknown';

          // If no entity type name, use fallback logic
          if (!donation.entity_type_name) {
            if (donation.is_pac) {
              donorType = 'PAC';
            } else if (donation.is_corporate) {
              donorType = 'Business/Corporate';
            } else if (donation.donation_type) {
              donorType = donation.donation_type;
            } else {
              donorType = 'Individual';
            }
          }

          return {
            name: donation.donor_name || 'Unknown Donor',
            employer: donation.donor_employer || null,
            occupation: donation.donor_occupation || null,
            type: donorType,
            amount: amountNumber,
            donation_id: donation.id || null,
            transaction_date: transactionDate,
            days_from_session: daysFromSession,
            donation_type: donation.donation_type,
            is_pac: donation.is_pac,
            is_corporate: donation.is_corporate,
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

const phase1Prompt = `${customBlock}Phase 1 Progressive Investigation Template
This prompt is designed to generate a broad list of potential connections using metadata only.

You are a progressive investigative journalist analyzing potential conflicts of interest between corporate/special interest donors and legislative activity. PRIORITIZE bills that could harm public interests or benefit wealthy donors. Work only with the structured metadata provided. DO NOT call any other tools or read full bill text during Phase 1.

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

            const phase2Prompt = `${customBlock}You are a progressive investigative journalist doing a DEEP DIVE analysis of potential donor-bill connections that may serve corporate/special interests over public good.

You have been given a list of ${highConfidenceGroups.length} potential groups to investigate (each group contains one bill with all associated donors).

CRITICAL FOCUS: Prioritize connections where corporate/special interest money may be buying harmful legislation that:
- Benefits wealthy donors/corporations at the expense of ordinary citizens
- Weakens protections for workers, consumers, environment, civil rights, or democracy
- Provides special tax breaks, deregulation, or privileges to wealthy interests
- Undermines public services, education, healthcare access, or social programs

PRIORITY DONORS TO SCRUTINIZE:
- Lobbyists and lobbying firms (check occupation field) - especially representing corporate interests
- Corporate PACs and business organizations seeking regulatory advantages
- Major corporate executives, CEOs, presidents (check occupation field) - especially from industries seeking legislative favor
- High-dollar donors ($500+ for individuals, $1000+ for organizations) - focus on those seeking policy benefits
- Industry trade associations and special interest groups
- Donors employed by companies with direct legislative interests that would benefit from the bills

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

      logger.success({
        resultsCount: results.length,
        previewCount: Object.keys(previewUpdates).length,
        sessionsAnalyzed: selectedSessions.length,
      });
    } catch (analysisError: any) {
      console.error('Analysis error:', analysisError);
      logger.failure(analysisError);
      throw analysisError;
    }
  };

  const runSingleCallAnalysis = async () => {
    const logger = startFunctionLog('runSingleCallAnalysis', {
      selectedSessions,
      currentPersonId,
      currentLegislatorIds,
      currentEntityIds,
    });
    const analysisStartTime = nowMs();
    (window as any).__analysisStartTime = analysisStartTime;

    try {
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
      get_bill_texts_array: {
        description: 'Fetch full bill text and summary for multiple bills at once (more efficient than individual calls).',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            bill_ids: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.NUMBER },
              description: 'Array of bill IDs to fetch'
            }
          },
          required: ['bill_ids']
        },
        handler: async (args: any) => {
          const { data, error } = await supabase.rpc('get_bill_texts_array', { p_bill_ids: args.bill_ids });
          if (error) throw error;
          return data || [];
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

    let numericSessions = selectedSessions;
    const sessionMetadata = availableSessions
      .filter(s => numericSessions.includes(s.id));

    const combinedSessionRange = sessionMetadata.reduce<{ start?: string; end?: string }>((acc, session) => {
      if (session.startDate && (!acc.start || session.startDate < acc.start)) acc.start = session.startDate;
      if (session.endDate && (!acc.end || session.endDate > acc.end)) acc.end = session.endDate;
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
      .select('session_id, session_name, first_vote_date, last_vote_date, official_start_date, official_end_date, total_votes, date_range_display')
      .eq('session_id', sessionId)
      .maybeSingle();

      if (error) {
        console.warn('Unable to fetch metadata for session', sessionId, error);
        return null;
      }

      if (!data) return null;

    const start = data.first_vote_date ?? data.official_start_date ?? null;
    const end = data.last_vote_date ?? data.official_end_date ?? null;

    const meta: Session = {
      id: data.session_id,
      name: data.session_name ?? `Session ${data.session_id}`,
      dateRange: data.date_range_display ?? (start && end ? `${start} - ${end}` : ''),
      voteCount: Number(data.total_votes ?? 0),
      startDate: start,
      endDate: end,
    };

      sessionCache.set(sessionId, meta);
      return meta;
    };

    for (let i = 0; i < selectedSessions.length; i++) {
      const selection = selectedSessions[i];
      const isCombined = selectedSessions.length > 1;

      let sessionName: string;
      let startDate: string;
      let endDate: string;
      let sessionIdsForQuery: number[] = [];

      if (isCombined) {
        const combinedSessions = (await Promise.all(selectedSessions.map(fetchSessionMeta))).filter((s): s is Session => !!s);

        if (combinedSessions.length === 0) {
          throw new Error('No sessions selected for analysis');
        }

        sessionName = 'Combined Sessions';
        startDate = combinedSessions.reduce((earliest, s) =>
          s.startDate && (!earliest || s.startDate < earliest) ? s.startDate : earliest, '');
        endDate = combinedSessions.reduce((latest, s) =>
          s.endDate && (!latest || s.endDate > latest) ? s.endDate : latest, '');
        sessionIdsForQuery = Array.from(new Set(combinedSessions.map(s => s.id)));
      } else {
        const session = await fetchSessionMeta(selection);
        if (!session) {
          throw new Error(`Session ${selection} not found`);
        }
        sessionName = session.name;
        startDate = session.startDate || '';
        endDate = session.endDate || '';
        sessionIdsForQuery = [session.id];
      }

      if (isCombined) {
        sessionIdsForQuery = Array.from(new Set(
          await Promise.all(selectedSessions.map(async (id) => {
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
        const transactionDate = donation.donation_date;
        const amountNumber = Number(donation.amount ?? donation.donation_amt ?? 0);
        const daysFromSession = transactionDate && !Number.isNaN(sessionStartDateObj.getTime())
          ? Math.round((new Date(transactionDate).getTime() - sessionStartDateObj.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        // Use entity type name from database lookup, with fallback logic
        let donorType = donation.entity_type_name || 'Unknown';

        // If no entity type name, use fallback logic
        if (!donation.entity_type_name) {
          if (donation.is_pac) {
            donorType = 'PAC';
          } else if (donation.is_corporate) {
            donorType = 'Business/Corporate';
          } else if (donation.donation_type) {
            donorType = donation.donation_type;
          } else {
            donorType = 'Individual';
          }
        }

        return {
          name: donation.donor_name || 'Unknown Donor',
          employer: donation.donor_employer || null,
          occupation: donation.donor_occupation || null,
          type: donorType,
          amount: amountNumber,
          donation_id: donation.id || null,
          transaction_date: transactionDate,
          days_from_session: daysFromSession,
          donation_type: donation.donation_type,
          is_pac: donation.is_pac,
          is_corporate: donation.is_corporate,
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

    const singlePrompt = `${customBlockSingle}Progressive Campaign Finance Investigation\n\n` +
      `You are an investigative journalist analyzing campaign finance from a progressive perspective, investigating links between corporate/special interest donors and legislative activity for ${currentLegislator}.\n` +
      `CRITICAL FOCUS: Prioritize identifying bills that could harm marginalized communities, undermine public interests, or benefit wealthy/corporate donors at the expense of ordinary citizens.\n` +
      `Emphasize connections where donors may be buying influence for legislation that:\n` +
      `- Weakens environmental protections, worker rights, civil rights, voting access, healthcare access, or consumer protections\n` +
      `- Provides tax breaks, deregulation, or special benefits to wealthy donors or corporations\n` +
      `- Restricts reproductive rights, LGBTQ+ rights, or other progressive priorities\n` +
      `- Undermines public education, social services, or democratic institutions\n` +
      `You may call the provided tools (resolve_legislator, get_sessions, get_votes, get_donations, get_sponsorships, get_bill_details, get_bill_texts_array, get_bill_rts).\n` +
      `Always cite evidence directly from bill details and RTS positions when making claims.\n` +
      `Focus on identifying THEMES tying donors to potentially harmful bills, rather than individual donor-bill pairs.\n` +
      `PRIORITIZE themes where corporate/special interest money appears connected to legislation that serves donor interests over public good.\n` +
      `For each theme, list every relevant bill and every related donor exhaustively, emphasizing the most concerning connections first.\n` +
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${singleCallModel}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

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
          parts: [{ text: 'You are a progressive investigative journalist analyzing campaign finance to expose corporate influence and protect public interests. When analyzing bills, prioritize identifying potentially harmful legislation that could undermine public interests, harm marginalized communities, or benefit wealthy/corporate donors at the expense of ordinary citizens. Use the maximum available thinking budget before delivering conclusions.' }]
        },
        tools: toolDeclarations,
        generationConfig: {
          temperature: baseGenerationConfig.temperature,
          maxOutputTokens: getMaxOutputTokens(singleCallModel),
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

      // Save single-call report to database
      let savedReportId: number | undefined;
      try {
        setProgressText('Saving single-pass analysis to database...');
        const isCombined = selectedSessions.length > 1;
        const sessionIdsForQuery = selectedSessions.filter((s): s is number => typeof s === 'number');

        const { data: saveData, error: saveError } = await supabase.rpc('save_phase2_analysis_report', {
          p_person_id: currentPersonId,
          p_session_id: isCombined ? null : sessionIdsForQuery[0],
          p_report_data: report,
          p_bill_ids: [], // Single-call doesn't track specific bill IDs
          p_donation_ids: [], // Single-call doesn't track specific donation IDs
          p_is_combined: isCombined,
          p_custom_instructions: customInstructions ? `SINGLE-CALL ANALYSIS: ${customInstructions}` : 'SINGLE-CALL ANALYSIS',
          p_analysis_duration_ms: Math.round(nowMs() - (window as any).__analysisStartTime || 0),
          p_report_id: null,
          p_phase1_report_id: null, // NULL indicates this is a single-call report
        });

        if (saveError) {
          console.warn('Failed to save single-call report:', saveError);
        } else {
          const savedReportIdRaw = Array.isArray(saveData) ? saveData[0] : saveData;
          if (savedReportIdRaw !== null && savedReportIdRaw !== undefined) {
            savedReportId = Number.parseInt(String(savedReportIdRaw), 10);
            if (!Number.isNaN(savedReportId)) {
              (report as any).reportId = savedReportId;
              console.log('Single-call report saved with ID:', savedReportId);
            }
          }
        }
      } catch (saveErr) {
        console.warn('Error saving single-call report:', saveErr);
        // Continue even if save fails
      }

      setAnalysisResults([{ sessionName: summaryName, report }]);
      setProgressPercent(100);
      setProgressText('Single-pass analysis complete');
      setCurrentStep('results');

      logger.success({ summaryName, hasReport: Boolean(report) });
    } catch (singleError: any) {
      logger.failure(singleError);
      throw singleError;
    }
  };

  const runDonorThemePreparation = async () => {
    const logger = startFunctionLog('runDonorThemePreparation', {
      selectedSessions,
      currentLegislator,
      currentLegislatorIds,
      primaryLegislatorId,
    });

    try {
      const numericSessions = selectedSessions.filter((s): s is number => typeof s === 'number');
      if (!numericSessions.length) {
        throw new Error('Please select a specific session for donor analysis.');
      }

      const sessionId = numericSessions[0];
      const sessionMeta = availableSessions.find((s) => s.id === sessionId);
      if (!sessionMeta) {
        throw new Error('Session metadata unavailable. Please refresh and try again.');
      }

      const sessionSpecificIds = sessionLegislatorMap[sessionId] ?? [];
      const legislatorPool = sessionSpecificIds.length ? sessionSpecificIds : currentLegislatorIds;
      const legislatorId = legislatorPool[0] ?? primaryLegislatorId;
      if (!legislatorId) {
        throw new Error('No legislator ID resolved for this person.');
      }

      setDonorThemeProgress({ text: 'Gathering donor data...', percent: 15 });

      let entityIds = currentEntityIds;
      if (!entityIds.length) {
        try {
          const entityRows = await callSupabaseRpc<{ entity_id: number }[]>('recipient_entity_ids_for_legislator', {
            p_legislator_id: legislatorId,
          });
          entityIds = Array.from(new Set((entityRows || []).map((row) => Number(row.entity_id)).filter((id) => Number.isFinite(id))));
          setCurrentEntityIds(entityIds);
        } catch (err) {
          console.warn('Failed to load legislator recipient entities via Supabase RPC:', err);
          try {
            const proxyRows = await callMcpToolProxy<{ entity_id: number }[]>('recipient_entity_ids_for_legislator', {
              p_legislator_id: legislatorId,
            });
            entityIds = Array.from(new Set((proxyRows || []).map((row) => Number(row.entity_id)).filter((id) => Number.isFinite(id))));
            setCurrentEntityIds(entityIds);
          } catch (proxyError) {
            console.warn('MCP fallback for recipient_entity_ids_for_legislator failed:', proxyError);
            entityIds = [];
          }
        }
      }

      const donorArgs: Record<string, unknown> = {
        p_person_id: currentPersonId,
        // Don't pass p_recipient_entity_ids when p_person_id is provided -
        // the function gets entity IDs automatically from mv_legislators_search
        p_session_id: sessionId,
        p_days_before: 180,  // Expanded search window for comprehensive theme analysis
        p_days_after: 180,
        p_min_amount: 100,  // Only donations over $100
        p_limit: 500,      // Reduce limit
      };

      let donors: DonorRecord[] = [];
      try {
        donors = (await callSupabaseRpc<DonorRecord[]>('search_donor_totals_window', donorArgs)) || [];
      } catch (primaryError) {
        console.warn('search_donor_totals_window RPC failed, attempting MCP fallback:', primaryError);
        try {
          donors = await callMcpToolProxy<DonorRecord[]>('search_donor_totals_window', donorArgs);
        } catch (proxyError) {
          console.error('MCP fallback for search_donor_totals_window failed:', proxyError);
          throw primaryError;
        }
      }

      if (!donors.length) {
        throw new Error('No donors found for the selected legislator and session.');
      }

      const sortedDonors = donors.sort((a, b) => Number(b.total_to_recipient ?? 0) - Number(a.total_to_recipient ?? 0));
      // Limit to top 100 donors for Gemini processing to avoid token limits
      const topDonors = sortedDonors.slice(0, 100);
      const topDonorIds = topDonors.map((donor) => Number(donor.transaction_entity_id)).filter((id) => Number.isFinite(id));

      let donorTransactions: DonorTransaction[] = [];
      const transactionPayload = buildTransactionWindowPayload({
        personId: currentPersonId,
        recipientEntityIds: entityIds,
        sessionId,
        includeTransactionEntityIds: topDonorIds,
      });
      try {
        donorTransactions = await listDonorTransactionsWindow({
          personId: currentPersonId,
          recipientEntityIds: entityIds,
          sessionId,
          includeTransactionEntityIds: topDonorIds,
        });
      } catch (primaryTxError) {
        console.warn('list_donor_transactions_window RPC failed, attempting MCP fallback:', primaryTxError, transactionPayload);
        try {
          donorTransactions = await callMcpToolProxy<DonorTransaction[]>('list_donor_transactions_window', transactionPayload);
        } catch (proxyTxError) {
          console.warn('MCP fallback for list_donor_transactions_window failed:', proxyTxError);
          donorTransactions = [];
        }
      }

      const filteredTransactions = donorTransactions
        .filter((txn) => topDonorIds.includes(Number(txn.transaction_entity_id)))
        .filter((txn) => Number(txn.amount) >= 100); // Only transactions over $100 for Gemini processing

      // Further limit transactions to avoid token limits - take largest transactions per donor
      const transactionsForGemini = filteredTransactions
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 300); // Limit to top 300 transactions

      setDonorThemeProgress({ text: 'Deriving donor themes...', percent: 45 });

      const themePrompt = `You are identifying donor themes for legislator ${currentLegislator || 'Unknown legislator'} during ${sessionMeta.name}.

INPUT:
donor_totals = ${JSON.stringify(topDonors, null, 2)}

donor_transactions = ${JSON.stringify(transactionsForGemini, null, 2)}

TASK:
Produce 5-15 donor themes that account for ALL major donors provided. Sort themes by total dollar amount (highest first). Build themes across multiple lenses and DO NOT collapse distinct sectors into one bucket. Every significant donor should be placed in a theme - do not leave major donors unaccounted for.

Theme discovery lenses (use ALL that apply):
1) Industry/Sector clusters: homebuilders/real estate developers; construction contractors; private prisons & corrections; law enforcement associations; health systems; health insurers; specialty medical PACs; pharmaceutical & PBM; nursing homes & assisted living; dentists & dental PACs; optometry/ophthalmology; utilities/power; gas; telecom/cable/broadband; data centers; mining; water/agriculture/irrigation; banks/finance/insurance; payday/title lending; car dealers & auto services; hospitality/alcohol; funeral services; education (charter/private schools, school mgmt companies); tribal governments & gaming; technology; logistics/rail/trucking; municipalities/zoning/annexation; chambers/trade associations.
2) Corporate & Family networks: same employer family (e.g., Robson Communities); repeated surnames with same address or employer; officers/owners across multiple entities.
3) PAC families/affiliates: e.g., Realtors, hospitals, utilities, telecom, builders, private corrections, insurers, pharma, etc.
4) Geography: out-of-state donors (by state), in-state clusters (Phoenix/Scottsdale/Tucson, etc.).
5) Timing patterns: donation clusters in the 30-60 days before/after key bill votes affecting that sector.
6) Contribution size: max-out amounts, repeated medium contributions across a network.

OUTPUT (STRICT JSON):
{
  "themes": [
    {
      "id": "kebab-case-unique",
      "title": "concise title",
      "description": "3-5 sentences explaining the pattern and why it matters",
      "industry_tags": ["sector","subsector","keywords"],
      "heuristics_used": ["industry_cluster","family_network","pac_family","geography","timing","size_pattern"],
      "donor_ids": [transaction_entity_id,...],
      "donor_names": ["..."],
      "donor_totals": [5000.00, 2500.00, ...],
      "evidence": [
        "Short bullets citing donors and data points (amounts/dates/relationships)."
      ],
      "query_suggestions": ["..."],
      "confidence": 0.0-1.0
    }
  ]
}

Notes:
- Use the individual transactions to justify grouping (e.g., date clusters, repeat donors, same employer).
- Do not include excluded donors (CCEC, 'Multiple Contributors', candidate's own committees).
- CRITICAL: Include donor_totals array with the total donation amount for each donor (must match the order of donor_names)
- Sort themes by total theme value (sum of all donor_totals in theme)
- Account for ALL major donors - every donor over $1000 should appear in a theme
- Generate 5-10 broad query_suggestions per theme (use general policy areas, not specific jargon).
`;

      const themesResponse = await callGeminiJson<{ themes?: DonorTheme[] }>(themePrompt, {
        system: DONOR_THEME_SYSTEM_PROMPT,
        temperature: 0.25,
        model: themeGenerationModel,
      });

      const themes = (themesResponse?.themes || []).map((theme, idx) => ({
        id: (theme.id || `THEME_${idx + 1}`).trim(),
        title: (theme.title || `Theme ${idx + 1}`).trim(),
        description: (theme.description || '').trim(),
        summary: theme.summary?.trim() || '',
        industry_tags: (theme.industry_tags || []).map((tag: string) => tag.trim()).filter(Boolean),
        heuristics_used: (theme.heuristics_used || []).map((h: string) => h.trim()).filter(Boolean),
        evidence: (theme.evidence || []).map((line: string) => line.trim()).filter(Boolean),
        query_suggestions: uniqueStrings(theme.query_suggestions || []),
        donor_ids: Array.from(new Set((theme.donor_ids || []).map((id: number) => Number(id)).filter((id) => Number.isFinite(id)))),
        donor_names: (theme.donor_names || []).map((name: string) => name.trim()).filter(Boolean),
        donor_totals: (theme.donor_totals || []).map((total: number) => Number(total)).filter((total) => Number.isFinite(total)),
        confidence: typeof theme.confidence === 'number' ? Math.max(0, Math.min(1, theme.confidence)) : undefined,
      })).filter((theme) => theme.title);

      if (!themes.length) {
        throw new Error('Gemini did not produce any donor themes.');
      }

      setDonorThemes(themes);
      setDonorThemeContext({
        legislatorName: currentLegislator || '',
        sessionId,
        sessionName: sessionMeta.name,
        sessionIdsForBills: [sessionId],
        entityIds,
        legislatorIds: currentLegislatorIds,
        primaryLegislatorId: legislatorId,
        sessionLegislatorMap,
        donors: topDonors,
        transactions: filteredTransactions,
        daysBefore: 90,
        daysAfter: 45,
        sessionStartDate: sessionMeta.startDate,
        sessionEndDate: sessionMeta.endDate,
      });

      setDonorThemeProgress(null);
      setCurrentStep('donorThemeThemes');

      // Load existing reports for themes after setting the themes
      setTimeout(() => loadExistingReportsForThemes(), 100);

      logger.success({
        themeCount: themes.length,
        donorCount: topDonors.length,
        transactionCount: filteredTransactions.length,
      });
    } catch (err) {
      logger.failure(err);
      throw err;
    }
  };

  const runDonorThemeAnalysis = async (theme: DonorTheme) => {
    if (!donorThemeContext) {
      throw new Error('Donor theme context is missing. Please restart the analysis.');
    }

    if (!currentPersonId) {
      throw new Error('No person ID available for bill search.');
    }

    const logger = startFunctionLog('runDonorThemeAnalysis', {
      themeId: theme.id,
      themeTitle: theme.title,
      sessionId: donorThemeContext.sessionId,
      personId: currentPersonId,
    });

    try {
      setDonorThemeProgress({ text: 'Generating bill search queries...', percent: 15 });

      // Intentionally not used in the expansion prompt to keep it concise.

      let queries = uniqueStrings(theme.query_suggestions || []);

      const needsExpansion = queries.length < 10;
      if (needsExpansion) {
        try {
          const expansionPrompt = `For THEME "${theme.title}" generate 8-10 simple keywords or short phrases (1-3 words) that would likely appear in bill text related to this theme.

Focus on:
- Concrete nouns and terms (like "landlord", "tenant", "property tax")
- Industry-specific terminology
- Common legal/regulatory terms in this area
- Simple descriptive phrases

Examples for "real estate" theme: homeowner association, property tax, landlord, tenant, eviction, affordable housing, building code, short-term rental, impact fee, eminent domain

DO NOT use:
- Complex policy concepts ("land reform", "comprehensive zoning overhaul")
- Legal citations or statute references
- Long descriptive phrases
- Abstract concepts

Theme description: ${theme.description}
Industry tags: ${(theme.industry_tags || []).join(', ') || 'n/a'}

Return JSON {"queries": ["..."]}.`;
          const expansionResponse = await callGeminiJson<{ queries?: string[] }>(expansionPrompt, {
            system: DONOR_THEME_SYSTEM_PROMPT,
            temperature: 0.2,
            model: queryExpansionModel,
          });
          queries = uniqueStrings([...queries, ...(expansionResponse?.queries || [])]);
        } catch (expansionError) {
          console.warn('Query expansion failed, proceeding with base queries.', expansionError);
        }
      }

      if (!queries.length) {
        queries = uniqueStrings([theme.title, theme.description].filter(Boolean));
      }

      if (queries.length > 20) {
        queries = queries.slice(0, 20);
      }

      const MAX_BATCH_SIZE = 5;
      const SCORE_THRESHOLDS = [0.35, 0.25, 0.15, 0.10];
      const MAX_BILLS = 1000;
      const MAX_STAGNATION = 2;
      const MIN_NEW_RESULTS_THRESHOLD = 5;

      const batches = chunkArray(queries, MAX_BATCH_SIZE);
      const billMap = new Map<number, any>();
      const queriesUsedSet = new Set<string>();

      let scoreIndex = 0;
      let stagnationCount = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const rawBatch = batches[batchIndex];
        const batch = rawBatch
          .map((q) => sanitizeSearchQuery(q))
          .filter(Boolean);
        if (!batch.length) continue;

        batch.forEach((q) => queriesUsedSet.add(q));

        setDonorThemeProgress({
          text: `Searching bills (batch ${batchIndex + 1}/${batches.length})...`,
          percent: Math.min(25 + (batchIndex * 5), 60),
        });

        const queryVectors = await Promise.all(batch.map(async (query) => {
          try {
            const embedding = await embeddingService.generateQueryEmbedding(query);
            return {
              query,
              vector: embedding.length ? embeddingService.formatForPgVector(embedding) : null,
            };
          } catch (embeddingError) {
            console.warn('Embedding generation failed for query:', query, embeddingError);
            return { query, vector: null };
          }
        }));

        const batchResults: any[] = [];
        const threshold = SCORE_THRESHOLDS[scoreIndex];

        try {
          const searchTermsArray = batch.length ? batch : null;
          const vectorArray = queryVectors
            .map((item) => item.vector)
            .filter((vec): vec is string => Boolean(vec));

          console.debug('Bill search batch payload', {
            sessionId: donorThemeContext.sessionId,
            personId: currentPersonId,
            threshold,
            searchTerms: searchTermsArray,
            vectorCount: vectorArray.length,
          });

          const results = await searchBillsForLegislatorRpc({
            sessionId: donorThemeContext.sessionId,
            personId: currentPersonId!,
            searchTerms: searchTermsArray,
            queryVectors: vectorArray.length ? vectorArray : null,
            minScore: threshold,
            limit: 80,
            offset: 0,
          });
          batchResults.push(...(results || []));
        } catch (searchError) {
          console.warn('search_bills_for_legislator_optimized batch failed', searchError, {
            sessionId: donorThemeContext.sessionId,
            personId: currentPersonId,
            batch,
            threshold,
          });
        }

        const newBills: any[] = [];
        batchResults.forEach((bill: any) => {
          const id = Number(bill.bill_id ?? bill.id);
          if (!Number.isFinite(id)) return;
          if (!billMap.has(id)) {
            billMap.set(id, bill);
            newBills.push(bill);
          }
        });

        if (newBills.length === 0) {
          stagnationCount += 1;
        } else {
          stagnationCount = 0;
        }

        if (newBills.length < MIN_NEW_RESULTS_THRESHOLD && scoreIndex < SCORE_THRESHOLDS.length - 1) {
          scoreIndex += 1;
        }

        if (stagnationCount >= MAX_STAGNATION || billMap.size >= MAX_BILLS) {
          break;
        }
      }

      const allBills = Array.from(billMap.values());
      if (!allBills.length) {
        throw new Error('No bills were found for the selected theme.');
      }

      setDonorThemeProgress({ text: 'Analyzing bills with AI...', percent: 65 });

      // Phase 1: Get top candidate bills with summaries (no full text yet)
      const candidateBills = allBills
        .sort((a: any, b: any) => Number(b.score ?? 0) - Number(a.score ?? 0))
        .slice(0, 150);

      // Phase 2: Use Gemini to intelligently select relevant bills
      const billSelectionPrompt = `Analyze these ${candidateBills.length} candidate bills and select the most relevant ones for the theme: "${theme.title || theme.description}".

Theme donors: ${theme.donor_names.join(', ')} (Total IDs: ${theme.donor_ids.length})

Consider which bills would most likely be influenced by these types of donors. Return ONLY a JSON array of bill_id numbers (as integers) for the most relevant bills. Limit to maximum 20 bills.

Candidate Bills:
${candidateBills.map((bill: any) =>
  `Bill ${bill.bill_number}: ${bill.summary_title || bill.bill_title || 'No title'} (ID: ${bill.bill_id}, Score: ${bill.score?.toFixed(3) || 'N/A'})`
).join('\n')}

Response format: [12345, 67890, ...]`;

      let selectedBillIds: number[] = [];
      try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent(billSelectionPrompt);
        const responseText = result.response.text();

        // Parse JSON array of bill IDs
        const parsed = JSON.parse(responseText.replace(/```json\n?|\n?```/g, '').trim());
        selectedBillIds = Array.isArray(parsed) ? parsed.filter(id => Number.isInteger(id)) : [];

        console.log(`Gemini selected ${selectedBillIds.length} bills from ${candidateBills.length} candidates:`, selectedBillIds);
      } catch (error) {
        console.warn('Gemini bill selection failed, using top scoring bills:', error);
        // Fallback to top 15 bills by score
        selectedBillIds = candidateBills.slice(0, 15).map((bill: any) => Number(bill.bill_id)).filter(id => Number.isFinite(id));
      }

      if (!selectedBillIds.length) {
        throw new Error('No bills were selected for analysis.');
      }

      setDonorThemeProgress({ text: `Retrieving full text for ${selectedBillIds.length} selected bills...`, percent: 75 });

      // Phase 3: Get full bill texts for selected bills using efficient array function
      const { data: billTextsData, error: billTextsError } = await supabase.rpc('get_bill_texts_array', {
        p_bill_ids: selectedBillIds
      });

      if (billTextsError) {
        console.error('Error fetching bill texts:', billTextsError);
        throw new Error('Failed to retrieve bill texts for analysis.');
      }

      const billTextsMap = new Map();
      (billTextsData || []).forEach((bill: any) => {
        billTextsMap.set(bill.bill_id, bill);
      });

      setDonorThemeProgress({ text: 'Retrieving voting records and stakeholders...', percent: 85 });

      // Get voting records for selected bills
      const votePromises = selectedBillIds.map(billId =>
        supabase.rpc('get_bill_vote_rollup', { p_bill_id: billId })
          .then(result => ({ billId, votes: result.error ? [] : (result.data || []) }))
      );

      const voteResults = await Promise.all(votePromises);
      const votesMap = new Map();
      voteResults.forEach(({ billId, votes }) => {
        votesMap.set(billId, votes);
      });

      const detailedBills: any[] = [];

      for (const billId of selectedBillIds) {
        const billText = billTextsMap.get(billId);
        const votes = votesMap.get(billId) || [];
        const candidateBill = candidateBills.find((b: any) => Number(b.bill_id) === billId);

        detailedBills.push({
          bill_id: billId,
          bill_number: billText?.bill_number || candidateBill?.bill_number || candidateBill?.billno,
          title: billText?.summary_title || candidateBill?.summary_title || candidateBill?.bill_title || '',
          score: candidateBill?.score ?? null,
          vote: candidateBill?.vote ?? candidateBill?.vote_value ?? null,
          vote_date: candidateBill?.vote_date ?? null,
          is_sponsor: candidateBill?.is_sponsor ?? false,
          is_party_outlier: candidateBill?.is_party_outlier ?? false,
          party_breakdown: candidateBill?.party_breakdown ?? null,
          statutes: candidateBill?.statutes ?? [],
          summary_excerpt: candidateBill?.summary_excerpt ?? billText?.bill_summary ?? '',
          full_excerpt: candidateBill?.full_excerpt ?? billText?.bill_text ?? '',
          vote_rollup: votes,
        });
      }

      // detailedBills prepared; proceed to synthesis without storing intermediate theme bill list.

      const queriesUsed = uniqueStrings(Array.from(queriesUsedSet));
      const relevantTransactions = (donorThemeContext.transactions || []).filter((txn) => theme.donor_ids.includes(Number(txn.transaction_entity_id)));
      const relevantDonors = donorThemeContext.donors.filter((donor) => theme.donor_ids.includes(Number(donor.transaction_entity_id)));

      setDonorThemeProgress({ text: 'Synthesizing final report...', percent: 90 });

      const reportPayload = {
        legislator: donorThemeContext.legislatorName,
        session: {
          id: donorThemeContext.sessionId,
          name: donorThemeContext.sessionName,
        },
        theme,
        queries_used: queriesUsed,
        donors: relevantDonors,
        bills: detailedBills,
        donor_transactions: relevantTransactions,
      };

      const reportPrompt = `Assemble the final donor theme report using the provided data.

IMPORTANT:
1. Each bill in the data includes a bill_summary. For deeper analysis of specific bills, you can call get_bill_texts_array([bill_id1, bill_id2, ...]) to retrieve the full bill text for multiple bills at once. Use this when you need to analyze specific statutory provisions, legal language, or detailed bill mechanics.
2. Include employer, occupation, and type for each donor from the provided donor data. Do not leave these fields empty.
3. Write the markdown summary as exhaustively and comprehensively as possible. Include extensive quotes from bill text, detailed statutory analysis, and comprehensive evidence for each connection. List as many relevant bills as possible that fit the theme and relate to the donors mentioned. Prioritize thorough analysis over brevity.

DATA:
${JSON.stringify(reportPayload, null, 2)}

Return STRICT JSON:
{
  "report": {
    "overall_summary": "1500-3000+ word comprehensive analysis with extensive bill quotes and detailed statutory connections covering as many relevant bills as possible",
    "session_info": {"session_id": ${donorThemeContext.sessionId}, "session_name": "${donorThemeContext.sessionName}"},
    "themes": [
      {
        "theme": "${theme.title}",
        "description": "3-5 sentence overview of this theme",
        "summary": "bullet-ready synopsis",
        "confidence": 0.0-1.0,
        "donors": [{"name": "Donor Name", "total": "$X,XXX", "employer": "Company/Organization", "occupation": "Job Title", "type": "Individual/PAC/Business", "notes": "brief justification" }],
        "queries_used": ["..."],
        "bills": [
          {
            "bill_id": 1234,
            "bill_number": "HBXXXX",
            "title": "short title",
            "reason": "why this bill matches the theme",
            "vote": "Y/N/NV",
            "stakeholders": ["group or individual"],
            "takeaways": "1-3 sentence takeaway"
          }
        ]
      }
    ],
    "transactions_cited": [
      { "public_transaction_id": 123456789, "donor": "Donor Name", "date": "YYYY-MM-DD", "amount": 5300.00, "linked_bills": ["HBXXXX", "SBYYYY"] }
    ],
    "markdown_summary": "Comprehensive narrative organized by theme with extensive bill text quotes, detailed statutory analysis, and thorough coverage of all relevant bills and donors (write exhaustively and comprehensively)"
  }
}

Rules:
- Cite individual transactions (public_transaction_id, donor, amount, date) anywhere evidence is used.
- Every bill referenced must include statutes/excerpts and legislator vote context.
- Use takeaways to connect statutes/excerpts to donor interests.
- Do not omit any donors or transactions supplied in the data.`;

      const reportData = await callGeminiJson<{ report?: any }>(reportPrompt, {
        system: DONOR_THEME_SYSTEM_PROMPT,
        temperature: 0.2,
        model: finalReportModel,
      });

      if (!reportData?.report) {
        throw new Error('Failed to generate donor theme report.');
      }

      // Save the analysis result and mark theme as completed
      setAnalysisResults([{
        sessionName: `${donorThemeContext.sessionName} -- ${theme.title}`,
        report: reportData
      }]);
      setCompletedThemes(prev => new Set([...prev, theme.id]));
      setCurrentStep('results');
      setDonorThemeProgress(null);

      // Auto-save the report to database
      await saveReportToDatabase(theme.id, reportData);

      logger.success({
        reportGenerated: Boolean(reportData.report),
        detailedBills: detailedBills.length,
        queriesUsed: queriesUsed.length,
        totalBillsDiscovered: billMap.size,
      });
    } catch (err) {
      logger.failure(err);
      throw err;
    }
  };

  const handleDonorThemeSelection = async (theme: DonorTheme) => {
    const logger = startFunctionLog('handleDonorThemeSelection', {
      themeId: theme.id,
      themeTitle: theme.title,
    });
    try {
      setAnalyzing(true);
      setDonorThemeProgress({ text: 'Analyzing selected theme...', percent: 10 });
      setCurrentStep('donorThemeProgress');
      await runDonorThemeAnalysis(theme);
      logger.success('Theme analysis completed');
    } catch (analysisError: any) {
      console.error('Donor theme analysis failed:', analysisError);
      setError(analysisError.message || 'Failed to analyze the selected theme.');
      setCurrentStep('donorThemeThemes');
      // Reload existing reports when returning to themes after error
      setTimeout(() => loadExistingReportsForThemes(), 100);
      logger.failure(analysisError);
    } finally {
      setDonorThemeProgress(null);
      setAnalyzing(false);
    }
  };

  const startAnalysis = async () => {
    const logger = startFunctionLog('startAnalysis', {
      analysisMode,
      selectedSessionsCount: selectedSessions.length,
      currentPersonId,
    });

    if (selectedSessions.length === 0) {
      logger.failure('No sessions selected');
      alert('Please select at least one session or the combined option');
      return;
    }

    if (!GEMINI_API_KEY) {
      logger.failure('Missing Gemini API key');
      setError('Missing Gemini API key. Please set VITE_GOOGLE_API_KEY or VITE_GEMINI_API_KEY in environment variables.');
      return;
    }

    if (!currentPersonId) {
      logger.failure('No person selected for analysis');
      setError('No person selected for analysis');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setPhase1Previews({});
    setAnalysisResults(null);
    setActivePhaseView('phase2');

    if (analysisMode === 'donorTheme') {
      setAnalysisResults(null);
      setDonorThemes(null);
      setDonorThemeProgress({ text: 'Preparing donor theme workflow...', percent: 5 });
      setCurrentStep('donorThemeProgress');
      try {
        await runDonorThemePreparation();
        logger.success('Donor theme preparation completed');
      } catch (analysisError: any) {
        console.error('Donor theme analysis setup failed:', analysisError);
        setError(analysisError.message || 'Failed to start donor theme analysis.');
        setCurrentStep('sessions');
        logger.failure(analysisError);
      } finally {
        setAnalyzing(false);
      }
      return;
    }

    setCurrentStep('progress');
    setProgressText('Starting analysis...');
    setProgressPercent(5);

    try {
      if (analysisMode === 'singleCall') {
        await runSingleCallAnalysis();
      } else {
        await runTwoPhaseAnalysisInternal();
      }
      logger.success({ mode: analysisMode });
    } catch (analysisError: any) {
      console.error('Analysis error:', analysisError);
      setError(analysisError.message || 'Analysis failed. Please try again.');
      logger.failure(analysisError);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Campaign Finance Report Generator</h1>
      <p style={{ marginBottom: 24, color: '#555' }}>
        Generate detailed analyses of potential conflicts of interest between campaign donations and legislative activity.
        Select a legislator, choose sessions, and let the AI identify donor themes and find relevant bills.
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
              Back to Search
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
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '1.1em', fontWeight: 600, marginBottom: 8 }}>Choose Report Type</h3>
            <p style={{ fontSize: '0.9em', color: '#555', marginBottom: 16, lineHeight: 1.5 }}>
              Select how you want to analyze this legislator's campaign finance and voting record:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 12,
                border: analysisMode === 'donorTheme' ? '2px solid #2563eb' : '1px solid #e5e7eb',
                borderRadius: 8,
                backgroundColor: analysisMode === 'donorTheme' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                <input
                  type="radio"
                  checked={analysisMode === 'donorTheme'}
                  onChange={() => setAnalysisMode('donorTheme')}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Theme-Based Analysis (Recommended)</div>
                  <div style={{ fontSize: '0.85em', color: '#666', lineHeight: 1.5 }}>
                    <strong>How it works:</strong> AI analyzes the legislator's campaign donors and groups them into themes
                    (like "Real Estate Industry", "Healthcare PACs", etc.). You then choose which themes to investigate.
                    For each theme, the system searches all bills using AI-powered semantic matching to find legislation
                    that could benefit those donor groups. You can review and edit the search terms before generating the final report.
                    <br/><br/>
                    <strong>Best for:</strong> Finding potential conflicts of interest, understanding donor influence,
                    exploring specific industries or interest groups.
                  </div>
                </div>
              </label>

              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 12,
                border: analysisMode === 'singleCall' ? '2px solid #2563eb' : '1px solid #e5e7eb',
                borderRadius: 8,
                backgroundColor: analysisMode === 'singleCall' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                <input
                  type="radio"
                  checked={analysisMode === 'singleCall'}
                  onChange={() => setAnalysisMode('singleCall')}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Complete Profile Analysis</div>
                  <div style={{ fontSize: '0.85em', color: '#666', lineHeight: 1.5 }}>
                    <strong>How it works:</strong> AI analyzes all the legislator's votes, sponsored bills, and campaign
                    donations in one comprehensive report. The system automatically identifies patterns, unusual votes,
                    voting trends, and creates a complete financial and legislative profile. No interaction required -
                    just click generate and get a full report.
                    <br/><br/>
                    <strong>Best for:</strong> Getting a complete overview of a legislator, understanding their voting record,
                    seeing all their major donors at once, identifying outlier votes (when they vote against their party).
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Model Selection */}
          {(analysisMode === 'donorTheme' || analysisMode === 'singleCall') && (
            <div style={{
              marginBottom: 16,
              padding: 12,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              backgroundColor: '#f9fafb'
            }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9em', fontWeight: 600 }}>Model Selection</h4>

              {analysisMode === 'donorTheme' && (
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85em', fontWeight: 500, marginBottom: 4 }}>
                      Theme Generation:
                    </label>
                    <select
                      value={themeGenerationModel}
                      onChange={(e) => setThemeGenerationModel(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: '0.85em'
                      }}
                    >
                      <option value="gemini-2.5-flash">2.5 Flash (Fast & Current)</option>
                      <option value="gemini-2.5-pro">2.5 Pro (Best Quality)</option>
                      <option value="gemini-2.0-flash-exp">2.0 Flash Experimental</option>
                      <option value="gemini-2.0-flash-thinking-exp-01-21">2.0 Thinking (Deep Analysis)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85em', fontWeight: 500, marginBottom: 4 }}>
                      Query Expansion:
                    </label>
                    <select
                      value={queryExpansionModel}
                      onChange={(e) => setQueryExpansionModel(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: '0.85em'
                      }}
                    >
                      <option value="gemini-2.5-flash">2.5 Flash (Fast & Current)</option>
                      <option value="gemini-2.5-pro">2.5 Pro (Best Quality)</option>
                      <option value="gemini-2.0-flash-exp">2.0 Flash Experimental</option>
                      <option value="gemini-2.0-flash-thinking-exp-01-21">2.0 Thinking (Deep Analysis)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85em', fontWeight: 500, marginBottom: 4 }}>
                      Final Report:
                    </label>
                    <select
                      value={finalReportModel}
                      onChange={(e) => setFinalReportModel(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: '0.85em'
                      }}
                    >
                      <option value="gemini-2.5-flash">2.5 Flash (Fast & Current)</option>
                      <option value="gemini-2.5-pro">2.5 Pro (Best Quality)</option>
                      <option value="gemini-2.0-flash-exp">2.0 Flash Experimental</option>
                      <option value="gemini-2.0-flash-thinking-exp-01-21">2.0 Thinking (Deep Analysis)</option>
                    </select>
                  </div>
                </div>
              )}

              {analysisMode === 'singleCall' && (
                <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85em', fontWeight: 500, marginBottom: 4 }}>
                      Single-Pass Model:
                    </label>
                    <select
                      value={singleCallModel}
                      onChange={(e) => setSingleCallModel(e.target.value as any)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        fontSize: '0.85em'
                      }}
                    >
                      <option value="gemini-2.5-flash">2.5 Flash (Fast & Current)</option>
                      <option value="gemini-2.5-pro">2.5 Pro (Best Quality)</option>
                      <option value="gemini-2.0-flash-exp">2.0 Flash Experimental</option>
                      <option value="gemini-2.0-flash-thinking-exp-01-21">2.0 Thinking (Deep Analysis)</option>
                    </select>
                  </div>
                </div>
              )}

              <div style={{ fontSize: '0.75em', color: '#6b7280', marginTop: 8 }}>
                💡 2.5 models are current generation. Flash = faster/cheaper, Pro = best quality. 2.0 models are experimental with Thinking = deep reasoning.
                {analysisMode === 'singleCall' && (
                  <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                    Single-Pass uses function calling to gather data and analyze in one comprehensive pass.
                  </div>
                )}
              </div>
            </div>
          )}

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
                  <div style={{ fontSize: '0.9em', color: '#666' }}>{s.dateRange || `${s.startDate || ''} to ${s.endDate || ''}`}</div>
                  {typeof s.voteCount === 'number' && (
                    <div style={{ fontSize: '0.85em', color: '#888' }}>{s.voteCount} votes</div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {availableSessions.length > 1 && (
            <div style={{
              marginTop: 12,
              padding: 8,
              background: '#f8fafc',
              borderRadius: 6,
              border: '1px solid #e2e8f0'
            }}>
              <div style={{ fontSize: '0.9em', color: '#475569', fontWeight: 500 }}>
                📊 Multi-Session Analysis
              </div>
              <div style={{ fontSize: '0.85em', color: '#64748b', marginTop: 4 }}>
                When multiple sessions are selected, the analysis will combine all donation and voting data across the selected time periods to identify comprehensive patterns and relationships.
              </div>
            </div>
          )}

          {/* Existing Theme Lists Section */}
          {existingThemeLists.length > 0 && (
            <div style={{
              marginTop: 16,
              padding: 12,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              backgroundColor: '#f9fafb'
            }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9em', fontWeight: 600, color: '#374151' }}>
                📋 Saved Theme Lists
              </h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.85em', color: '#6b7280' }}>
                Found {existingThemeLists.length} saved theme list{existingThemeLists.length !== 1 ? 's' : ''} - load to continue analysis with different themes.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {existingThemeLists.map((themeList) => (
                  <div key={themeList.id} style={{
                    padding: 8,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.85em', fontWeight: 500 }}>
                        Report #{themeList.id} • {new Date(themeList.created_at).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize: '0.8em', color: '#6b7280', marginTop: 2 }}>
                        {themeList.themes_json?.length || 0} themes • {themeList.total_donors} donors • Model: {themeList.model_used}
                      </div>
                    </div>
                    <button
                      onClick={() => loadExistingThemeList(themeList.id)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#059669',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: '0.8em',
                        fontWeight: 500
                      }}
                    >
                      Load Themes
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Existing Analysis Reports */}
          {existingAnalysisReports.length > 0 && (
            <div style={{ marginTop: 16, marginBottom: 16, padding: 16, backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95em', fontWeight: 600, color: '#374151' }}>
                📄 Completed Reports ({existingAnalysisReports.length})
              </h4>
              <div style={{ display: 'grid', gap: 8 }}>
                {existingAnalysisReports.map((report) => {
                  const reportDate = new Date(report.created_at).toLocaleDateString();
                  const reportTime = new Date(report.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                  const isSingleCall = report.phase1_report_id === null;
                  const analysisType = isSingleCall ? 'Single-Pass' : 'Two-Phase';
                  const duration = report.analysis_duration_ms ? `${Math.round(report.analysis_duration_ms / 1000)}s` : '';

                  return (
                    <div key={report.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      fontSize: '0.9em'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, color: '#374151' }}>
                          {analysisType} Analysis
                        </div>
                        <div style={{ fontSize: '0.85em', color: '#6b7280', marginTop: 2 }}>
                          {reportDate} at {reportTime}
                          {duration && ` • ${duration}`}
                          {report.custom_instructions && report.custom_instructions !== 'SINGLE-CALL ANALYSIS' && (
                            <span> • Custom instructions</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setAnalysisResults([{
                            sessionName: availableSessions.find(s => s.id === report.session_id)?.name || 'Unknown Session',
                            report: report.report_json
                          }]);
                          setCurrentStep('results');
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.85em',
                          backgroundColor: '#2563eb',
                          color: 'white',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer'
                        }}
                      >
                        View Report
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
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

      {currentStep === 'donorThemeProgress' && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Donor Theme Analysis</h3>
          <div style={{ height: 12, backgroundColor: '#e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${donorThemeProgress?.percent ?? 5}%`, height: '100%', backgroundColor: '#2563eb', transition: 'width 0.3s ease' }} />
          </div>
          <div style={{ marginTop: 12, color: '#555' }}>{donorThemeProgress?.text || 'Preparing donor analysis...'}</div>
          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <button
              onClick={() => setCurrentStep('sessions')}
              disabled={analyzing}
              style={{ padding: '8px 16px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              Back to Sessions
            </button>
          </div>
        </div>
      )}

      {currentStep === 'donorThemeThemes' && donorThemes && donorThemeContext && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Select a Donor Theme</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={generateThemeListPDF}
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500
                }}
                title="Download PDF of all themes"
              >
                📄 Export PDF
              </button>
            </div>
          </div>
          <div style={{
            marginBottom: 20,
            padding: 16,
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8
          }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95em', fontWeight: 600, color: '#1e40af' }}>
              📋 How Themes Work
            </h4>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85em', color: '#1e3a8a', lineHeight: 1.6 }}>
              The AI has analyzed all campaign donors for <strong>{donorThemeContext.legislatorName}</strong> during <strong>{donorThemeContext.sessionName}</strong> and
              grouped them into themes based on industry, occupation, and donor patterns. Each theme represents a potential area of influence.
            </p>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.85em', color: '#1e3a8a', lineHeight: 1.6 }}>
              <strong>What are "Suggested Searches"?</strong><br/>
              These are search phrases the AI believes are most relevant to each donor theme. When you generate a report for a theme,
              the system will use <strong>vector search</strong> (AI-powered semantic matching) to find bills that match these phrases.
              Vector search understands meaning, not just keywords - for example, "property tax exemptions" will also find bills about "real estate assessment relief."
            </p>
            <p style={{ margin: 0, fontSize: '0.85em', color: '#dc2626', fontWeight: 500 }}>
              ⚠️ <strong>Important:</strong> Review and edit the suggested searches before generating your report.
              You can add, remove, or modify search terms to focus on what matters most. The quality of your report depends on choosing the right search phrases!
            </p>
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            {donorThemes.map((theme) => {
              const isCompleted = completedThemes.has(theme.id);
              const hasSavedReport = savedReports.has(theme.id);
              return (
              <div
                key={theme.id}
                style={{
                  border: `1px solid ${hasSavedReport ? '#8b5cf6' : isCompleted ? '#10b981' : '#d1d5db'}`,
                  borderRadius: 8,
                  padding: 16,
                  backgroundColor: hasSavedReport ? '#f3e8ff' : isCompleted ? '#ecfdf5' : '#f9fafb',
                  position: 'relative'
                }}
              >
                {hasSavedReport && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    padding: '4px 8px',
                    backgroundColor: '#8b5cf6',
                    color: 'white',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    📄 SAVED
                  </div>
                )}
                {isCompleted && !hasSavedReport && (
                  <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    padding: '4px 8px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600
                  }}>
                    ✓ COMPLETED
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px 0' }}>{theme.title}</h4>
                    {theme.description && (
                      <div style={{ color: '#374151', marginBottom: 8 }}>{theme.description}</div>
                    )}
                    {theme.summary && (
                      <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>
                        <strong>Summary:</strong> {theme.summary}
                      </div>
                    )}
                    {theme.confidence !== undefined && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                        Confidence: {(theme.confidence * 100).toFixed(0)}%
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {hasSavedReport && (
                      <button
                        onClick={() => loadSavedReport(theme.id)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#8b5cf6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontWeight: 500
                        }}
                      >
                        📄 View Report
                      </button>
                    )}
                    <button
                      onClick={() => handleDonorThemeSelection(theme)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: hasSavedReport ? '#6b7280' : '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer'
                      }}
                    >
                      {hasSavedReport ? 'Re-analyze' : 'Investigate Theme'}
                    </button>
                  </div>
                </div>
                {(theme.donor_names && theme.donor_names.length > 0) && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Donors ({theme.donor_names.length}):</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                      {theme.donor_names.map((name, idx) => {
                        const total = theme.donor_totals?.[idx];
                        const displayTotal = total ? `$${total.toLocaleString()}` : 'Unknown';

                        // Try to get donor info from the context for employer/occupation/type
                        const donorInfo = donorThemeContext?.donors?.find(d =>
                          d.entity_name === name
                        );

                        const donorType = donorInfo?.entity_type_name || 'Unknown';
                        const employer = donorInfo?.top_employer || null;
                        const occupation = donorInfo?.top_occupation || null;

                        // Color coding for donor types
                        const getTypeColor = (type: string) => {
                          const typeStr = type.toLowerCase();
                          if (typeStr.includes('pac') || typeStr.includes('committee')) return '#dc2626'; // red
                          if (typeStr.includes('individual') || typeStr.includes('person')) return '#16a34a'; // green
                          if (typeStr.includes('business') || typeStr.includes('corporation')) return '#2563eb'; // blue
                          if (typeStr.includes('organization') || typeStr.includes('nonprofit')) return '#7c3aed'; // purple
                          return '#64748b'; // gray
                        };

                        return (
                          <div key={idx} style={{
                            padding: 8,
                            backgroundColor: '#fefefe',
                            borderRadius: 6,
                            border: '1px solid #e2e8f0',
                            fontSize: 11,
                            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <div style={{ fontWeight: 500, color: '#1e293b', flex: 1 }}>{name}</div>
                              <div style={{
                                fontSize: 9,
                                padding: '2px 4px',
                                backgroundColor: getTypeColor(donorType),
                                color: 'white',
                                borderRadius: 3,
                                fontWeight: 500
                              }}>
                                {donorType.toUpperCase()}
                              </div>
                            </div>
                            <div style={{ color: '#059669', fontWeight: 600, marginBottom: 2 }}>{displayTotal}</div>
                            {(employer || occupation) && (
                              <div style={{ color: '#64748b', fontSize: 10, lineHeight: 1.3 }}>
                                {employer && <div>{employer}</div>}
                                {occupation && <div style={{ fontStyle: 'italic' }}>{occupation}</div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(theme.query_suggestions && theme.query_suggestions.length > 0) && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Suggested Search Phrases:</div>
                      <button
                        onClick={() => startEditingQueries(theme.id, theme.query_suggestions)}
                        style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          backgroundColor: '#e5e7eb',
                          border: '1px solid #d1d5db',
                          borderRadius: 4,
                          cursor: 'pointer'
                        }}
                      >
                        Edit
                      </button>
                    </div>
                    {editingThemeId === theme.id ? (
                      <div style={{ marginBottom: 8 }}>
                        <textarea
                          value={editingQueries}
                          onChange={(e) => setEditingQueries(e.target.value)}
                          placeholder="Enter search phrases, one per line"
                          style={{
                            width: '100%',
                            minHeight: 100,
                            padding: 8,
                            fontSize: 12,
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            fontFamily: 'monospace'
                          }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <button
                            onClick={saveEditedQueries}
                            style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              backgroundColor: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer'
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditingQueries}
                            style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              backgroundColor: '#6b7280',
                              color: 'white',
                              border: 'none',
                              borderRadius: 4,
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 12 }}>
                        {theme.query_suggestions.map((query, idx) => {
                          return <li key={`${theme.id}-query-${idx}`}>{query}</li>;
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
          <div style={{ marginTop: 20 }}>
            <button
              onClick={() => setCurrentStep('sessions')}
              style={{ padding: '8px 16px', backgroundColor: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
            >
              Back to Sessions
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
                    <div style={{ fontWeight: 600 }}>Phase 1 Preview -- {preview.sessionName}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {preview.billIds.length} bills * {preview.donationIds.length} donations
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
                    <strong>Summary:</strong>
                    <span style={{ marginLeft: 6 }}>
                      {`Votes ${preview.summaryStats.total_votes ?? 0}, Sponsors ${preview.summaryStats.total_sponsorships ?? 0}, Donations ${preview.summaryStats.total_donations ?? 0}`}
                    </span>
                    <span style={{ marginLeft: 10 }}>
                      {`Confidence -- High ${preview.summaryStats.high_confidence_pairs ?? 0} * Medium ${preview.summaryStats.medium_confidence_pairs ?? 0} * Low ${preview.summaryStats.low_confidence_pairs ?? 0}`}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Potential Groups</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {preview.groups.map((group: any, groupIdx: number) => (
                        <div key={`${preview.sessionKey}-group-${groupIdx}`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, backgroundColor: '#fff' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {group.bill_number || 'Unknown Bill'} -- {group.bill_title || 'Untitled Bill'}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {group.vote_or_sponsorship || 'vote'} * {group.vote_value || 'N/A'} * {group.vote_date || 'Unknown date'}
                            {group.is_party_outlier ? ' * Party Outlier' : ''}
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
                                    <strong>{donor.name}</strong> -- ${Number(donor.amount ?? 0).toLocaleString()} ({donor.type || 'Unknown'})
                                    {donor.transaction_date && ` * ${donor.transaction_date}`}
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
                  {activePhaseView === 'phase1' ? 'View Phase 2 Results' : 'View Phase 1 Preview'}
                </button>
              )}
              {/* Show Back to Themes button for theme reports */}
              {(analysisResults ?? []).some((r) =>
                Array.isArray(r.report?.themes) || Array.isArray(r.report?.report?.themes)
              ) && (
                <button
                  onClick={() => {
                    setCurrentStep('donorThemeThemes');
                    setTimeout(() => loadExistingReportsForThemes(), 100);
                  }}
                  style={{ padding: '6px 12px', fontSize: '0.9em', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  ← Back to Themes
                </button>
              )}
              <button
                onClick={() => {
                  if (analysisResults && analysisResults.length > 0) {
                    generateFinalReportPDF({ report: analysisResults[0].report });
                  }
                }}
                style={{ padding: '6px 12px', fontSize: '0.9em', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Generate PDF
              </button>
              <button
                onClick={() => setCurrentStep('sessions')}
                style={{ padding: '6px 12px', fontSize: '0.9em', background: '#6b7280', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                New Analysis
              </button>
              <button
                onClick={() => setCurrentStep('search')}
                style={{ padding: '6px 12px', fontSize: '0.9em', background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Change Person
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
                    <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{result.sessionName} -- Phase 1 Preview</h3>
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
                        {phase1.billIds.length} bills * {phase1.donationIds.length} donations
                        {phase1.phase1ReportId ? ` * Saved ID ${phase1.phase1ReportId}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                      Confidence -- High {phase1.summaryStats.high_confidence_pairs ?? 0} * Medium {phase1.summaryStats.medium_confidence_pairs ?? 0} * Low {phase1.summaryStats.low_confidence_pairs ?? 0}
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {phase1.groups.map((group: any, groupIdx: number) => (
                        <div key={`${phase1.sessionKey}-phase1-${groupIdx}`} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, backgroundColor: '#fff' }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>
                            {group.bill_number || 'Unknown Bill'} -- {group.bill_title || 'Untitled Bill'}
                          </div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {group.vote_or_sponsorship || 'vote'} * {group.vote_value || 'N/A'} * {group.vote_date || 'Unknown date'}
                            {group.is_party_outlier ? ' * Party Outlier' : ''}
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
                                    <strong>{donor.name}</strong> -- ${Number(donor.amount ?? 0).toLocaleString()} ({donor.type || 'Unknown'})
                                    {donor.transaction_date && ` * ${donor.transaction_date}`}
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
                Array.isArray(result.report?.themes) || Array.isArray(result.report?.report?.themes) ? (
                  (() => {
                    // Handle both direct themes array and nested report structure
                    const reportData = result.report?.report || result.report;
                    const themes = reportData?.themes || [];

                    return (
                      <>
                        <div style={{ marginBottom: 12, padding: 8, backgroundColor: '#f0f0f0', borderRadius: 6 }}>
                          {reportData.overall_summary && (
                            <div><strong>Overall Summary:</strong> {reportData.overall_summary}</div>
                          )}
                          {reportData.session_info && (
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                              <strong>Session Info:</strong> {JSON.stringify(reportData.session_info)}
                            </div>
                          )}
                        </div>

                        {themes.map((theme: any, themeIdx: number) => (
                      <div key={themeIdx} style={{ marginBottom: 16, padding: 12, border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{theme.theme}</h4>
                        {theme.description && <div style={{ color: '#374151', marginBottom: 6 }}>{theme.description}</div>}
                        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Confidence: {(Number(theme.confidence ?? 0) * 100).toFixed(0)}%</div>

                        <div style={{ marginBottom: 8 }}>
                          <strong>Bills ({theme.bills?.length || 0}):</strong>
                          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                            {(theme.bills || []).map((bill: any, billIdx: number) => {
                              return (
                              <li key={billIdx} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <div><strong>{bill.bill_number}</strong> -- {bill.bill_title || bill.title}</div>
                                  {bill.bill_id && (
                                    <button
                                      onClick={() => toggleBillExpansion(bill.bill_id)}
                                      disabled={loadingBillDetails.has(bill.bill_id)}
                                      style={{
                                        padding: '2px 6px',
                                        fontSize: '10px',
                                        backgroundColor: expandedBills.has(bill.bill_id) ? '#dc2626' : '#2563eb',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 3,
                                        cursor: loadingBillDetails.has(bill.bill_id) ? 'not-allowed' : 'pointer',
                                        opacity: loadingBillDetails.has(bill.bill_id) ? 0.6 : 1
                                      }}
                                    >
                                      {loadingBillDetails.has(bill.bill_id) ? '...' :
                                       expandedBills.has(bill.bill_id) ? 'Hide Details' : 'Show Details'}
                                    </button>
                                  )}
                                </div>
                                {(bill.vote_value || bill.vote) && (
                                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                    Vote: {bill.vote_value || bill.vote}{bill.is_outlier ? ' (OUTLIER)' : ''}
                                  </div>
                                )}
                                {bill.reason && (
                                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                                    <strong>Reason:</strong> {bill.reason}
                                  </div>
                                )}
                                {bill.takeaways && (
                                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4, fontStyle: 'italic' }}>
                                    <strong>Takeaways:</strong> {bill.takeaways}
                                  </div>
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
                                {(bill.analysis || bill.summary) && (
                                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4 }}>
                                    <strong>Analysis:</strong> {bill.analysis || bill.summary}
                                  </div>
                                )}

                                {/* Expanded Bill Details */}
                                {bill.bill_id && expandedBills.has(bill.bill_id) && (
                                  <div style={{ marginTop: 8, padding: 8, backgroundColor: '#f8fafc', borderRadius: 4, borderLeft: '3px solid #2563eb' }}>
                                    {billDetails.has(bill.bill_id) ? (
                                      (() => {
                                        const detailsArray = billDetails.get(bill.bill_id);
                                        const details = Array.isArray(detailsArray) ? detailsArray[0] : detailsArray;
                                        return (
                                          <div style={{ fontSize: 11 }}>
                                            <div style={{ fontWeight: 600, marginBottom: 6, color: '#1e40af' }}>
                                              Full Bill Details
                                            </div>

                                            {details?.description && (
                                              <div style={{ marginBottom: 6 }}>
                                                <strong>Description:</strong>
                                                <div style={{ marginTop: 2, lineHeight: 1.4 }}>{details.description}</div>
                                              </div>
                                            )}

                                            {(() => {
                                              // Check if bill_summary and bill_text are different
                                              const hasDifferentText = details?.bill_text && details?.bill_summary &&
                                                details.bill_text.trim() !== details.bill_summary.trim();

                                              // Show legislative summary only if it's different from description and exists
                                              const showSummary = details?.bill_summary &&
                                                details.bill_summary !== details.description &&
                                                details.bill_summary.trim().length > 0;

                                              return (
                                                <>
                                                  {showSummary && (
                                                    <div style={{ marginBottom: 8 }}>
                                                      <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4, fontSize: '11px' }}>
                                                        Legislative Summary
                                                      </div>
                                                      <div style={{
                                                        padding: 8,
                                                        backgroundColor: '#ffffff',
                                                        border: '1px solid #e5e7eb',
                                                        borderRadius: 4,
                                                        maxHeight: '250px',
                                                        overflow: 'auto',
                                                        lineHeight: 1.4,
                                                        fontSize: '11px',
                                                        fontFamily: 'system-ui, -apple-system, sans-serif'
                                                      }}>
                                                        {(() => {
                                                          // Clean up the legislative summary formatting
                                                          const text = details.bill_summary;
                                                          if (!text) return '';

                                                          return text
                                                            // Remove excessive line breaks
                                                            .replace(/\n\s*\n\s*\n/g, '\n\n')
                                                            // Clean up weird spacing patterns
                                                            .replace(/\n\s+/g, '\n')
                                                            // Remove document footer sections
                                                            .replace(/----------.*?---------[\s\S]*$/g, '')
                                                            // Clean up numbered items spacing
                                                            .replace(/(\d+)\.\s*\n\s*/g, '$1. ')
                                                            // Clean up lettered items spacing
                                                            .replace(/([a-z])\)\s*\n\s*/g, '$1) ')
                                                            // Normalize whitespace
                                                            .replace(/[ \t]+/g, ' ')
                                                            .trim();
                                                        })()}
                                                      </div>
                                                    </div>
                                                  )}

                                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: 6 }}>
                                                    {details?.primary_sponsor && (
                                                      <div>
                                                        <strong>Primary Sponsor:</strong><br/>
                                                        <span style={{ fontSize: '10px' }}>{details.primary_sponsor}</span>
                                                      </div>
                                                    )}

                                                    {details?.date_introduced && (
                                                      <div>
                                                        <strong>Date Introduced:</strong><br/>
                                                        <span style={{ fontSize: '10px' }}>{new Date(details.date_introduced).toLocaleDateString()}</span>
                                                      </div>
                                                    )}

                                                    {details?.final_disposition && (
                                                      <div>
                                                        <strong>Final Disposition:</strong><br/>
                                                        <span style={{ fontSize: '10px' }}>{details.final_disposition}</span>
                                                      </div>
                                                    )}

                                                    {details?.governor_action && (
                                                      <div>
                                                        <strong>Governor Action:</strong><br/>
                                                        <span style={{ fontSize: '10px', color: '#059669', fontWeight: 600 }}>{details.governor_action}</span>
                                                      </div>
                                                    )}
                                                  </div>

                                                  {hasDifferentText && (
                                                    <details style={{ marginTop: 6 }}>
                                                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#374151' }}>
                                                        View Full Bill Text
                                                      </summary>
                                                      <div style={{
                                                        marginTop: 4,
                                                        padding: 8,
                                                        backgroundColor: '#ffffff',
                                                        border: '1px solid #d1d5db',
                                                        borderRadius: 4,
                                                        maxHeight: '300px',
                                                        overflow: 'auto',
                                                        whiteSpace: 'pre-wrap',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                                        fontSize: '10px',
                                                        lineHeight: 1.4
                                                      }}>
                                                        {details.bill_text}
                                                      </div>
                                                    </details>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                                        Loading bill details...
                                      </div>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                            })}
                          </ul>
                        </div>

                        <div>
                          <strong>Donors ({theme.donors?.length || 0}):</strong>
                          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                            {(theme.donors || []).map((donor: any, donorIdx: number) => (
                              <li key={donorIdx}>
                                <div><strong>{donor.name}</strong> -- {(() => {
                                  // Handle both string ($5,000) and number formats
                                  let amount = donor.total_amount ?? donor.amount ?? donor.total ?? 0;
                                  if (typeof amount === 'string') {
                                    amount = Number(amount.replace(/[$,]/g, ''));
                                  }
                                  return `$${Number(amount).toLocaleString()}`;
                                })()}</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>
                                  {donor.type || 'Unknown type'} * {donor.employer || 'Unknown employer'} * {donor.occupation || 'Unknown occupation'}
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

                        {Array.isArray(reportData.data_sources) && reportData.data_sources.length > 0 && (
                          <div style={{ fontSize: 12, color: '#6b7280' }}>
                            <strong>Data Sources:</strong> {reportData.data_sources.join('; ')}
                          </div>
                        )}
                      </>
                    );
                  })()
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
                          WARNING Confirmed Conflicts of Interest ({result.report.confirmedConnections.length})
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
                          CHECK Investigated but Rejected ({result.report.rejectedConnections.length})
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
                        CHECK No conflicts of interest identified for this session.
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

          {/* Chat Interface for Follow-up Questions */}
          {analysisResults && analysisResults.length > 0 && (
            <div style={{ marginTop: 32, borderTop: '2px solid #e5e7eb', paddingTop: 24 }}>
              <div style={{
                backgroundColor: '#f0f9ff',
                border: '2px solid #0ea5e9',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16
              }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#0c4a6e', margin: 0 }}>
                  💬 Ask Follow-up Questions
                </h3>
                <p style={{ fontSize: '0.9em', color: '#0c4a6e', lineHeight: 1.6, margin: '8px 0 0 0' }}>
                  You can ask the AI any questions about this report using the chat below. For example:
                </p>
                <ul style={{ fontSize: '0.85em', color: '#075985', margin: '8px 0 0 0', paddingLeft: 20, lineHeight: 1.6 }}>
                  <li>"Can you find more bills related to this theme not covered in this report?"</li>
                  <li>"Which of these donors gave to other legislators?"</li>
                  <li>"Were any of these bills signed into law?"</li>
                  <li>"What was the total amount donated by this group?"</li>
                  <li>"Show me bills this legislator sponsored related to real estate"</li>
                </ul>
                <p style={{ fontSize: '0.85em', color: '#0c4a6e', fontStyle: 'italic', margin: '8px 0 0 0' }}>
                  The AI has access to all the data in this report and can search the database to answer your questions.
                </p>
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#374151' }}>
                Ask Follow-up Questions About This Report
              </h3>
              <ReportChatView
                reportContent={JSON.stringify(analysisResults, null, 2)}
                reportTitle={`Analysis for ${searchTerm || 'Selected Person'}`}
              />
            </div>
          )}
        </div>
      )}


    </div>
  );
};

export default ReportGeneratorPage;
