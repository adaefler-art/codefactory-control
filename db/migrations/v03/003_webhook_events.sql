-- AFU-9 v0.2 Webhook Events Schema
-- PostgreSQL 15+

-- ========================================
-- Webhook Events
-- ========================================

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_action VARCHAR(100),
  payload JSONB NOT NULL,
  signature VARCHAR(255) NOT NULL,
  delivery_id VARCHAR(255),
  received_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  workflow_execution_id UUID REFERENCES workflow_executions(id) ON DELETE SET NULL,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX idx_webhook_events_event_action ON webhook_events(event_action);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX idx_webhook_events_received_at ON webhook_events(received_at DESC);
CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_webhook_events_workflow_execution ON webhook_events(workflow_execution_id);

-- Add trigger for updated_at
CREATE TRIGGER update_webhook_events_updated_at BEFORE UPDATE ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- Webhook Configurations
-- ========================================

CREATE TABLE webhook_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  secret_key VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  event_filters JSONB,
  workflow_mappings JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_configs_name ON webhook_configs(name);
CREATE INDEX idx_webhook_configs_enabled ON webhook_configs(enabled);

-- Add trigger for updated_at
CREATE TRIGGER update_webhook_configs_updated_at BEFORE UPDATE ON webhook_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default GitHub webhook configuration
INSERT INTO webhook_configs (name, description, secret_key, enabled, event_filters, workflow_mappings) VALUES (
  'github',
  'GitHub webhook handler for issues, pull requests, and check runs',
  'change-me-in-production',
  true,
  '{
    "events": ["issues", "pull_request", "check_run", "check_suite"]
  }'::jsonb,
  '{
    "issues.opened": {"workflow": "issue_to_pr", "auto_trigger": false},
    "pull_request.opened": {"workflow": null, "auto_trigger": false},
    "check_run.completed": {"workflow": null, "auto_trigger": false}
  }'::jsonb
);
