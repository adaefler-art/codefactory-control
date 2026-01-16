-- Migration 064: Repair INTENT Issue Authoring Evidence Events
-- Idempotent remediation for staging drift where intent_issue_authoring_events is missing.
-- Non-destructive: no DROP, safe to re-run.

-- Ensure required extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure table exists (schema-qualified to avoid search_path ambiguity)
CREATE TABLE IF NOT EXISTS public.intent_issue_authoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  session_id UUID REFERENCES public.intent_sessions(id) ON DELETE CASCADE,
  sub TEXT NOT NULL,
  action TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  lawbook_version TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  params_json JSONB,
  result_json JSONB
);

-- Ensure expected columns exist (safe if table was created partially)
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS sub TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS params_hash TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS result_hash TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS lawbook_version TEXT;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS params_json JSONB;
ALTER TABLE public.intent_issue_authoring_events
  ADD COLUMN IF NOT EXISTS result_json JSONB;

-- Ensure action constraint exists (only if table exists)
DO $$
BEGIN
  IF to_regclass('public.intent_issue_authoring_events') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_intent_authoring_action'
      AND conrelid = 'public.intent_issue_authoring_events'::regclass
  ) THEN
    ALTER TABLE public.intent_issue_authoring_events
      ADD CONSTRAINT chk_intent_authoring_action CHECK (
        action IN ('draft_save', 'draft_validate', 'draft_commit', 'issue_set_generate', 'issue_set_export')
      );
  END IF;
END;
$$;

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_request_id
  ON public.intent_issue_authoring_events(request_id);
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_session_id
  ON public.intent_issue_authoring_events(session_id);
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_sub
  ON public.intent_issue_authoring_events(sub);
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_action
  ON public.intent_issue_authoring_events(action);
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_created_at
  ON public.intent_issue_authoring_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intent_authoring_events_session_action
  ON public.intent_issue_authoring_events(session_id, action, created_at DESC);

-- Append-only policy (E81.5 requirement)
CREATE OR REPLACE FUNCTION public.prevent_intent_authoring_events_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'intent_issue_authoring_events is append-only: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.intent_issue_authoring_events') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prevent_update_intent_authoring_events') THEN
    CREATE TRIGGER prevent_update_intent_authoring_events
      BEFORE UPDATE ON public.intent_issue_authoring_events
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_intent_authoring_events_modification();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'prevent_delete_intent_authoring_events') THEN
    CREATE TRIGGER prevent_delete_intent_authoring_events
      BEFORE DELETE ON public.intent_issue_authoring_events
      FOR EACH ROW
      EXECUTE FUNCTION public.prevent_intent_authoring_events_modification();
  END IF;
END;
$$;
