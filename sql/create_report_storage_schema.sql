-- Database schema for saving and loading campaign finance analysis reports
-- This allows users to save theme analysis results and continue with different themes later

-- Table for storing donor theme lists (Step 1 results)
CREATE TABLE IF NOT EXISTS public.cf_donor_theme_lists (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Analysis metadata
  person_id BIGINT REFERENCES public.people(id),
  legislator_name TEXT NOT NULL,
  session_id INTEGER REFERENCES public.sessions(session_id),
  session_name TEXT NOT NULL,

  -- Generation settings used
  model_used TEXT NOT NULL, -- e.g., 'gemini-2.5-flash'
  generation_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Theme list data (JSON)
  themes_json JSONB NOT NULL, -- Array of DonorTheme objects
  donor_context_json JSONB NOT NULL, -- Full donorThemeContext data

  -- Summary stats
  theme_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(themes_json)) STORED,
  total_donors INTEGER,
  total_transactions INTEGER,

  -- User notes and status
  notes TEXT,
  status TEXT DEFAULT 'active', -- 'active', 'archived', 'deleted'

  UNIQUE(person_id, session_id, created_at)
);

-- Table for storing final theme analysis reports (Step 2 results)
CREATE TABLE IF NOT EXISTS public.cf_theme_analysis_reports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Links to source theme list
  theme_list_id BIGINT REFERENCES public.cf_donor_theme_lists(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL, -- The specific theme ID from the themes array
  theme_title TEXT NOT NULL,

  -- Analysis metadata
  person_id BIGINT REFERENCES public.people(id),
  legislator_name TEXT NOT NULL,
  session_id INTEGER REFERENCES public.sessions(session_id),
  session_name TEXT NOT NULL,

  -- Generation settings used
  model_used TEXT NOT NULL,
  generation_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Report data (JSON from Gemini output)
  report_json JSONB NOT NULL, -- Full report object from final step

  -- Extracted summary fields for easy querying
  confidence_score DECIMAL(3,2),
  donor_count INTEGER,
  bill_count INTEGER,
  total_donations_analyzed DECIMAL(12,2),

  -- User annotations
  user_rating INTEGER CHECK (user_rating >= 1 AND user_rating <= 5),
  user_notes TEXT,
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,

  -- Status
  status TEXT DEFAULT 'active', -- 'active', 'archived', 'deleted'

  UNIQUE(theme_list_id, theme_id)
);

-- Table for tracking PDF exports
CREATE TABLE IF NOT EXISTS public.cf_report_exports (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- What was exported
  export_type TEXT NOT NULL, -- 'theme_list', 'final_report'
  source_id BIGINT NOT NULL, -- cf_donor_theme_lists.id or cf_theme_analysis_reports.id

  -- Export metadata
  filename TEXT NOT NULL,
  file_size_bytes BIGINT,
  export_format TEXT DEFAULT 'pdf',

  -- User info
  exported_by TEXT, -- could be user ID in future

  INDEX idx_cf_report_exports_source (export_type, source_id),
  INDEX idx_cf_report_exports_date (created_at)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cf_donor_theme_lists_person_session
  ON public.cf_donor_theme_lists(person_id, session_id);

CREATE INDEX IF NOT EXISTS idx_cf_donor_theme_lists_created
  ON public.cf_donor_theme_lists(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cf_theme_analysis_reports_theme_list
  ON public.cf_theme_analysis_reports(theme_list_id);

CREATE INDEX IF NOT EXISTS idx_cf_theme_analysis_reports_person_session
  ON public.cf_theme_analysis_reports(person_id, session_id);

CREATE INDEX IF NOT EXISTS idx_cf_theme_analysis_reports_created
  ON public.cf_theme_analysis_reports(created_at DESC);

-- Functions for managing reports

-- Save donor theme list
CREATE OR REPLACE FUNCTION public.save_donor_theme_list(
  p_person_id BIGINT,
  p_legislator_name TEXT,
  p_session_id INTEGER,
  p_session_name TEXT,
  p_model_used TEXT,
  p_themes_json JSONB,
  p_donor_context_json JSONB,
  p_total_donors INTEGER DEFAULT NULL,
  p_total_transactions INTEGER DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_list_id BIGINT;
BEGIN
  INSERT INTO public.cf_donor_theme_lists (
    person_id,
    legislator_name,
    session_id,
    session_name,
    model_used,
    themes_json,
    donor_context_json,
    total_donors,
    total_transactions,
    notes
  ) VALUES (
    p_person_id,
    p_legislator_name,
    p_session_id,
    p_session_name,
    p_model_used,
    p_themes_json,
    p_donor_context_json,
    p_total_donors,
    p_total_transactions,
    p_notes
  )
  RETURNING id INTO v_list_id;

  RETURN v_list_id;
END;
$$;

-- Save theme analysis report
CREATE OR REPLACE FUNCTION public.save_theme_analysis_report(
  p_theme_list_id BIGINT,
  p_theme_id TEXT,
  p_theme_title TEXT,
  p_person_id BIGINT,
  p_legislator_name TEXT,
  p_session_id INTEGER,
  p_session_name TEXT,
  p_model_used TEXT,
  p_report_json JSONB,
  p_confidence_score DECIMAL DEFAULT NULL,
  p_user_notes TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_report_id BIGINT;
  v_donor_count INTEGER;
  v_bill_count INTEGER;
  v_total_donations DECIMAL(12,2);
BEGIN
  -- Extract summary data from JSON
  v_donor_count := jsonb_array_length(p_report_json->'report'->'themes'->0->'donors');
  v_bill_count := jsonb_array_length(p_report_json->'report'->'themes'->0->'bills');

  -- Calculate total donations (sum from transactions_cited)
  SELECT COALESCE(SUM((item->>'amount')::decimal), 0)
  INTO v_total_donations
  FROM jsonb_array_elements(p_report_json->'report'->'transactions_cited') AS item;

  INSERT INTO public.cf_theme_analysis_reports (
    theme_list_id,
    theme_id,
    theme_title,
    person_id,
    legislator_name,
    session_id,
    session_name,
    model_used,
    report_json,
    confidence_score,
    donor_count,
    bill_count,
    total_donations_analyzed,
    user_notes
  ) VALUES (
    p_theme_list_id,
    p_theme_id,
    p_theme_title,
    p_person_id,
    p_legislator_name,
    p_session_id,
    p_session_name,
    p_model_used,
    p_report_json,
    p_confidence_score,
    v_donor_count,
    v_bill_count,
    v_total_donations,
    p_user_notes
  )
  ON CONFLICT (theme_list_id, theme_id)
  DO UPDATE SET
    report_json = EXCLUDED.report_json,
    confidence_score = EXCLUDED.confidence_score,
    donor_count = EXCLUDED.donor_count,
    bill_count = EXCLUDED.bill_count,
    total_donations_analyzed = EXCLUDED.total_donations_analyzed,
    user_notes = EXCLUDED.user_notes,
    updated_at = NOW()
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- Get saved theme lists for a legislator/session
CREATE OR REPLACE FUNCTION public.get_saved_theme_lists(
  p_person_id BIGINT DEFAULT NULL,
  p_session_id INTEGER DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE,
  legislator_name TEXT,
  session_name TEXT,
  model_used TEXT,
  theme_count INTEGER,
  total_donors INTEGER,
  total_transactions INTEGER,
  has_reports BOOLEAN,
  report_count INTEGER
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    tl.id,
    tl.created_at,
    tl.legislator_name,
    tl.session_name,
    tl.model_used,
    tl.theme_count,
    tl.total_donors,
    tl.total_transactions,
    COUNT(tr.id) > 0 AS has_reports,
    COUNT(tr.id)::integer AS report_count
  FROM public.cf_donor_theme_lists tl
  LEFT JOIN public.cf_theme_analysis_reports tr ON tr.theme_list_id = tl.id AND tr.status = 'active'
  WHERE tl.status = 'active'
    AND (p_person_id IS NULL OR tl.person_id = p_person_id)
    AND (p_session_id IS NULL OR tl.session_id = p_session_id)
  GROUP BY tl.id, tl.created_at, tl.legislator_name, tl.session_name,
           tl.model_used, tl.theme_count, tl.total_donors, tl.total_transactions
  ORDER BY tl.created_at DESC
  LIMIT p_limit;
$$;

-- Get theme analysis reports for a theme list
CREATE OR REPLACE FUNCTION public.get_theme_analysis_reports(
  p_theme_list_id BIGINT
)
RETURNS TABLE (
  id BIGINT,
  created_at TIMESTAMP WITH TIME ZONE,
  theme_id TEXT,
  theme_title TEXT,
  model_used TEXT,
  confidence_score DECIMAL(3,2),
  donor_count INTEGER,
  bill_count INTEGER,
  total_donations_analyzed DECIMAL(12,2),
  user_rating INTEGER,
  is_flagged BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    created_at,
    theme_id,
    theme_title,
    model_used,
    confidence_score,
    donor_count,
    bill_count,
    total_donations_analyzed,
    user_rating,
    is_flagged
  FROM public.cf_theme_analysis_reports
  WHERE theme_list_id = p_theme_list_id
    AND status = 'active'
  ORDER BY created_at DESC;
$$;