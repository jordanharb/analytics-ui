-- Fix session_window function to handle array of session IDs
-- This enables multi-session analysis by creating one large window from earliest start to latest end

-- Drop existing versions
DROP FUNCTION IF EXISTS public.session_window(integer, integer, integer);
DROP FUNCTION IF EXISTS public.session_window(integer[], integer, integer);

-- Create array-based version that handles multiple sessions
-- Calculate dates from actual vote data, not session start/end dates
CREATE OR REPLACE FUNCTION public.session_window(
  p_session_ids integer[],
  p_days_before integer DEFAULT 90,
  p_days_after integer DEFAULT 45
)
RETURNS TABLE (
  from_date date,
  to_date date
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  WITH session_vote_dates AS (
    -- Get the earliest and latest vote dates across all specified sessions
    SELECT
      MIN(v.vote_date) AS earliest_vote_date,
      MAX(v.vote_date) AS latest_vote_date
    FROM public.votes v
    JOIN public.bills b ON v.bill_id = b.bill_id
    WHERE b.session_id = ANY(p_session_ids)
      AND v.vote_date IS NOT NULL
  )
  SELECT
    (earliest_vote_date - make_interval(days => GREATEST(p_days_before, 0)))::date AS from_date,
    (latest_vote_date + make_interval(days => GREATEST(p_days_after, 0)))::date AS to_date
  FROM session_vote_dates
  WHERE earliest_vote_date IS NOT NULL AND latest_vote_date IS NOT NULL;
END;
$$;

-- Create backward-compatible single session version
CREATE OR REPLACE FUNCTION public.session_window(
  p_session_id integer,
  p_days_before integer DEFAULT 90,
  p_days_after integer DEFAULT 45
)
RETURNS TABLE (
  from_date date,
  to_date date
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- Convert single session_id to array and call the main function
  RETURN QUERY
  SELECT * FROM public.session_window(ARRAY[p_session_id], p_days_before, p_days_after);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION session_window(integer[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION session_window(integer[], integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION session_window(integer[], integer, integer) TO service_role;

GRANT EXECUTE ON FUNCTION session_window(integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION session_window(integer, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION session_window(integer, integer, integer) TO service_role;