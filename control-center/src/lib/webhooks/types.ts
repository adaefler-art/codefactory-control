/**
 * Webhook Types for AFU-9
 */

export interface WebhookEvent {
  id: string;
  event_id: string;
  event_type: string;
  event_action?: string;
  payload: Record<string, any>;
  signature: string;
  delivery_id?: string;
  received_at: Date;
  processed: boolean;
  processed_at?: Date;
  workflow_execution_id?: string;
  error?: string;
}

export interface WebhookConfig {
  id: string;
  name: string;
  description?: string;
  secret_key: string;
  enabled: boolean;
  event_filters?: {
    events: string[];
  };
  workflow_mappings?: Record<string, {
    workflow?: string;
    auto_trigger: boolean;
  }>;
}

export interface WebhookProcessingResult {
  success: boolean;
  event_id: string;
  workflow_execution_id?: string;
  error?: string;
}
