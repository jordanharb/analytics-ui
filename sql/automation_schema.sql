-- Automation pipeline tables and helpers

-- Ensure UUID generation is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Shared trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Settings table (singleton row)
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  is_enabled boolean NOT NULL DEFAULT false,
  include_instagram boolean NOT NULL DEFAULT false,
  run_interval_hours integer NOT NULL DEFAULT 48,
  last_run_started_at timestamptz,
  last_run_completed_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER automation_settings_set_updated_at
BEFORE UPDATE ON public.automation_settings
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Runs table capturing pipeline executions
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  status text NOT NULL,
  current_step text,
  include_instagram boolean NOT NULL DEFAULT false,
  triggered_by text NOT NULL DEFAULT 'manual',
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  step_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_runs_status_idx
  ON public.automation_runs(status);

CREATE INDEX IF NOT EXISTS automation_runs_created_idx
  ON public.automation_runs(created_at DESC);

CREATE TRIGGER automation_runs_set_updated_at
BEFORE UPDATE ON public.automation_runs
FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Row level security
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (implicit). Allow authenticated clients to read.
CREATE POLICY automation_settings_select
ON public.automation_settings
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY automation_runs_select
ON public.automation_runs
FOR SELECT
TO authenticated
USING (true);

-- Stored procedure to schedule automation runs atomically
CREATE OR REPLACE FUNCTION public.schedule_automation_run()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_record automation_settings;
  new_run automation_runs;
  computed_next_run timestamptz;
BEGIN
  -- Ensure a settings row exists and lock it for update
  SELECT * INTO settings_record
  FROM automation_settings
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF settings_record IS NULL THEN
    INSERT INTO automation_settings(is_enabled, include_instagram, run_interval_hours)
    VALUES (false, false, 48)
    RETURNING * INTO settings_record;
  END IF;

  IF NOT settings_record.is_enabled THEN
    RETURN json_build_object('scheduled', false, 'reason', 'disabled');
  END IF;

  IF EXISTS (
      SELECT 1 FROM automation_runs
      WHERE status IN ('queued', 'running')
    ) THEN
    RETURN json_build_object('scheduled', false, 'reason', 'active_run');
  END IF;

  IF settings_record.next_run_at IS NOT NULL
     AND settings_record.next_run_at > now() THEN
    RETURN json_build_object(
      'scheduled', false,
      'reason', 'not_due',
      'next_run_at', settings_record.next_run_at
    );
  END IF;

  computed_next_run := now() + make_interval(hours => settings_record.run_interval_hours);

  INSERT INTO automation_runs (
    status,
    include_instagram,
    triggered_by,
    scheduled_for,
    config_snapshot
  ) VALUES (
    'queued',
    settings_record.include_instagram,
    'schedule',
    now(),
    json_build_object(
      'include_instagram', settings_record.include_instagram,
      'run_interval_hours', settings_record.run_interval_hours
    )
  ) RETURNING * INTO new_run;

  UPDATE automation_settings
  SET next_run_at = computed_next_run,
      updated_at = now()
  WHERE id = settings_record.id;

  RETURN json_build_object(
    'scheduled', true,
    'run_id', new_run.id,
    'next_run_at', computed_next_run
  );
END;
$$;
