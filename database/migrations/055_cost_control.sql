-- Cost Control (staging-only) schema
-- Phase 1: desired-state settings + append-only event log

BEGIN;

CREATE TABLE IF NOT EXISTS cost_control_settings (
  env TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL,
  PRIMARY KEY (env, key)
);

CREATE TABLE IF NOT EXISTS cost_control_events (
  request_id TEXT NOT NULL,
  sub TEXT NOT NULL,
  env TEXT NOT NULL,
  action TEXT NOT NULL,
  params_json JSONB NOT NULL,
  params_hash TEXT NOT NULL,
  result_json JSONB NOT NULL,
  result_hash TEXT NOT NULL,
  lawbook_version TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_control_events_env_created_at
  ON cost_control_events(env, created_at DESC);

-- Append-only enforcement (no UPDATE/DELETE)
CREATE OR REPLACE FUNCTION cost_control_events_no_update_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cost_control_events is append-only (UPDATE/DELETE not allowed)';
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cost_control_events_no_update'
  ) THEN
    CREATE TRIGGER trg_cost_control_events_no_update
      BEFORE UPDATE ON cost_control_events
      FOR EACH ROW
      EXECUTE FUNCTION cost_control_events_no_update_delete();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cost_control_events_no_delete'
  ) THEN
    CREATE TRIGGER trg_cost_control_events_no_delete
      BEFORE DELETE ON cost_control_events
      FOR EACH ROW
      EXECUTE FUNCTION cost_control_events_no_update_delete();
  END IF;
END;
$$;

COMMIT;
