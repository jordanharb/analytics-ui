-- Creates storage for Phase 1 report outputs and links them to the main rs_analysis_reports table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rs_analysis_phase1_reports (
  phase1_report_id BIGSERIAL PRIMARY KEY,
  person_id BIGINT NOT NULL REFERENCES public.rs_people(person_id),
  session_id INTEGER REFERENCES public.sessions(session_id),
  session_ids INTEGER[] DEFAULT '{}'::INTEGER[],
  is_combined BOOLEAN DEFAULT FALSE,
  custom_instructions TEXT,
  phase1_data JSONB NOT NULL,
  summary_stats JSONB,
  bill_ids INTEGER[] DEFAULT '{}'::INTEGER[],
  donation_ids TEXT[] DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phase1_reports_person_session ON public.rs_analysis_phase1_reports(person_id, session_id);

ALTER TABLE public.rs_analysis_reports
  ADD COLUMN IF NOT EXISTS phase1_report_id BIGINT;

ALTER TABLE public.rs_analysis_reports
  ADD CONSTRAINT rs_analysis_reports_phase1_report_id_fkey
    FOREIGN KEY (phase1_report_id)
    REFERENCES public.rs_analysis_phase1_reports(phase1_report_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rs_analysis_reports_phase1_unique
  ON public.rs_analysis_reports(phase1_report_id)
  WHERE phase1_report_id IS NOT NULL;

COMMIT;
