-- Helper functions to persist Phase 1 and Phase 2 analysis outputs.

CREATE OR REPLACE FUNCTION public.save_phase1_analysis_report(
  p_phase1_report_id BIGINT DEFAULT NULL,
  p_person_id BIGINT,
  p_session_id INTEGER DEFAULT NULL,
  p_session_ids INTEGER[] DEFAULT NULL,
  p_is_combined BOOLEAN DEFAULT FALSE,
  p_custom_instructions TEXT DEFAULT NULL,
  p_phase1_data JSONB,
  p_summary_stats JSONB DEFAULT NULL,
  p_bill_ids INTEGER[] DEFAULT NULL,
  p_donation_ids TEXT[] DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $BODY$
DECLARE
  v_phase1_id BIGINT;
BEGIN
  IF p_phase1_report_id IS NULL THEN
    INSERT INTO public.rs_analysis_phase1_reports (
      person_id,
      session_id,
      session_ids,
      is_combined,
      custom_instructions,
      phase1_data,
      summary_stats,
      bill_ids,
      donation_ids,
      created_at,
      updated_at
    ) VALUES (
      p_person_id,
      p_session_id,
      COALESCE(p_session_ids, '{}'::INTEGER[]),
      COALESCE(p_is_combined, FALSE),
      p_custom_instructions,
      p_phase1_data,
      p_summary_stats,
      COALESCE(p_bill_ids, '{}'::INTEGER[]),
      COALESCE(p_donation_ids, '{}'::TEXT[]),
      NOW(),
      NOW()
    )
    RETURNING phase1_report_id INTO v_phase1_id;
  ELSE
    UPDATE public.rs_analysis_phase1_reports
    SET
      person_id = p_person_id,
      session_id = p_session_id,
      session_ids = COALESCE(p_session_ids, '{}'::INTEGER[]),
      is_combined = COALESCE(p_is_combined, FALSE),
      custom_instructions = p_custom_instructions,
      phase1_data = p_phase1_data,
      summary_stats = p_summary_stats,
      bill_ids = COALESCE(p_bill_ids, '{}'::INTEGER[]),
      donation_ids = COALESCE(p_donation_ids, '{}'::TEXT[]),
      updated_at = NOW()
    WHERE phase1_report_id = p_phase1_report_id
    RETURNING phase1_report_id INTO v_phase1_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Phase 1 report % not found', p_phase1_report_id;
    END IF;
  END IF;

  RETURN v_phase1_id;
END;
$BODY$;


CREATE OR REPLACE FUNCTION public.save_phase2_analysis_report(
  p_report_id BIGINT DEFAULT NULL,
  p_phase1_report_id BIGINT DEFAULT NULL,
  p_person_id BIGINT,
  p_session_id INTEGER DEFAULT NULL,
  p_is_combined BOOLEAN DEFAULT FALSE,
  p_custom_instructions TEXT DEFAULT NULL,
  p_report_data JSONB,
  p_bill_ids INTEGER[] DEFAULT NULL,
  p_donation_ids TEXT[] DEFAULT NULL,
  p_analysis_duration_ms INTEGER DEFAULT NULL
) RETURNS BIGINT
LANGUAGE plpgsql
AS $BODY$
DECLARE
  v_report_id BIGINT;
BEGIN
  IF p_report_id IS NULL THEN
    INSERT INTO public.rs_analysis_reports (
      person_id,
      session_id,
      is_combined,
      custom_instructions,
      report_data,
      bill_ids,
      donation_ids,
      analysis_duration_ms,
      phase1_report_id,
      created_at
    ) VALUES (
      p_person_id,
      p_session_id,
      COALESCE(p_is_combined, FALSE),
      p_custom_instructions,
      p_report_data,
      COALESCE(p_bill_ids, '{}'::INTEGER[]),
      COALESCE(p_donation_ids, '{}'::TEXT[]),
      p_analysis_duration_ms,
      p_phase1_report_id,
      NOW()
    )
    RETURNING report_id INTO v_report_id;
  ELSE
    UPDATE public.rs_analysis_reports
    SET
      person_id = p_person_id,
      session_id = p_session_id,
      is_combined = COALESCE(p_is_combined, FALSE),
      custom_instructions = p_custom_instructions,
      report_data = p_report_data,
      bill_ids = COALESCE(p_bill_ids, '{}'::INTEGER[]),
      donation_ids = COALESCE(p_donation_ids, '{}'::TEXT[]),
      analysis_duration_ms = p_analysis_duration_ms,
      phase1_report_id = p_phase1_report_id
    WHERE report_id = p_report_id
    RETURNING report_id INTO v_report_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Analysis report % not found', p_report_id;
    END IF;
  END IF;

  RETURN v_report_id;
END;
$BODY$;
