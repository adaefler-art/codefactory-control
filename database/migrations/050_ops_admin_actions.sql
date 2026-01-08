-- Migration: ops_admin_actions audit table
-- Purpose: Append-only audit log for administrative database operations
-- Author: AFU-9 Control Center
-- Date: 2026-01-08

CREATE TABLE IF NOT EXISTS ops_admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL,
    sub TEXT NOT NULL,
    action TEXT NOT NULL,
    params_json JSONB NOT NULL,
    result_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_ops_admin_actions_created_at ON ops_admin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_admin_actions_request_id ON ops_admin_actions(request_id);
CREATE INDEX IF NOT EXISTS idx_ops_admin_actions_action ON ops_admin_actions(action);
CREATE INDEX IF NOT EXISTS idx_ops_admin_actions_sub ON ops_admin_actions(sub);

-- Comment
COMMENT ON TABLE ops_admin_actions IS 'Append-only audit log for administrative database operations (E7.0+)';
COMMENT ON COLUMN ops_admin_actions.request_id IS 'Unique request ID for correlation';
COMMENT ON COLUMN ops_admin_actions.sub IS 'Authenticated user sub from x-afu9-sub header';
COMMENT ON COLUMN ops_admin_actions.action IS 'Action identifier (e.g., ISSUES_SET_DONE)';
COMMENT ON COLUMN ops_admin_actions.params_json IS 'Input parameters (bounded, no secrets)';
COMMENT ON COLUMN ops_admin_actions.result_json IS 'Operation result (bounded, no secrets)';
