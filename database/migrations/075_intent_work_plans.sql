-- Migration 075: INTENT Work Plans
-- Issue V09-I04: WorkPlanV1: Freies Plan-Artefakt (ohne Draft)
-- Creates table for storing free-form work plans per INTENT session

-- ========================================
-- INTENT Work Plans
-- ========================================
CREATE TABLE IF NOT EXISTS intent_work_plans (
  session_id UUID PRIMARY KEY REFERENCES intent_sessions(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  content_json JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_work_plan_schema_version CHECK (schema_version IN ('1.0.0'))
);

CREATE INDEX idx_intent_work_plans_updated_at ON intent_work_plans(updated_at DESC);
CREATE INDEX idx_intent_work_plans_hash ON intent_work_plans(content_hash);

COMMENT ON TABLE intent_work_plans IS 'V09-I04: Free-form work plans for INTENT sessions - intermediate planning artifact';
COMMENT ON COLUMN intent_work_plans.session_id IS 'One plan per session, CASCADE delete with session';
COMMENT ON COLUMN intent_work_plans.schema_version IS 'Schema version for content_json structure';
COMMENT ON COLUMN intent_work_plans.content_json IS 'Plan content: goals, context, options, todos (bounded)';
COMMENT ON COLUMN intent_work_plans.content_hash IS 'SHA-256 hash of normalized content for change detection';
COMMENT ON COLUMN intent_work_plans.updated_at IS 'Last update timestamp for optimistic locking';
