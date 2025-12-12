/**
 * Webhook Event Processor
 * 
 * Maps GitHub webhook events to AFU-9 workflows and triggers execution
 */

import { Pool } from 'pg';
import { WebhookEvent, WebhookConfig, WebhookProcessingResult } from './types';
import { markWebhookProcessed } from './persistence';
import { getWorkflowEngine } from '../workflow-engine';
import { WorkflowDefinition, WorkflowContext } from '../types/workflow';

/**
 * Process a webhook event and optionally trigger workflows
 */
export async function processWebhookEvent(
  pool: Pool,
  event: WebhookEvent,
  config: WebhookConfig
): Promise<WebhookProcessingResult> {
  try {
    console.log('[Webhook Processor] Processing event', {
      event_type: event.event_type,
      event_action: event.event_action,
      event_id: event.event_id,
    });

    // Get workflow mapping for this event
    const eventKey = event.event_action
      ? `${event.event_type}.${event.event_action}`
      : event.event_type;

    const mapping = config.workflow_mappings?.[eventKey];

    if (!mapping) {
      console.log('[Webhook Processor] No workflow mapping found for event', { eventKey });
      await markWebhookProcessed(pool, event.event_id);
      return {
        success: true,
        event_id: event.event_id,
      };
    }

    // Check if auto-trigger is enabled
    if (!mapping.auto_trigger) {
      console.log('[Webhook Processor] Auto-trigger disabled for event', { eventKey });
      await markWebhookProcessed(pool, event.event_id);
      return {
        success: true,
        event_id: event.event_id,
      };
    }

    // Trigger workflow if configured
    if (mapping.workflow) {
      const workflowName = mapping.workflow;
      console.log('[Webhook Processor] Triggering workflow', { workflowName, eventKey });

      // Fetch workflow definition from database
      const workflowQuery = `
        SELECT * FROM workflows
        WHERE name = $1 AND enabled = TRUE
      `;
      const workflowResult = await pool.query(workflowQuery, [workflowName]);

      if (workflowResult.rows.length === 0) {
        throw new Error(`Workflow not found or disabled: ${workflowName}`);
      }

      const workflow = workflowResult.rows[0];
      const workflowDefinition: WorkflowDefinition = workflow.definition;

      // Build context from webhook payload
      const context = buildWorkflowContext(event);

      // Execute workflow
      const engine = getWorkflowEngine();
      const result = await engine.execute(workflowDefinition, context);

      // Mark as processed with execution ID
      await markWebhookProcessed(pool, event.event_id, result.executionId);

      console.log('[Webhook Processor] Workflow execution completed', {
        event_id: event.event_id,
        execution_id: result.executionId,
        status: result.status,
      });

      return {
        success: result.status === 'completed',
        event_id: event.event_id,
        workflow_execution_id: result.executionId,
        error: result.error,
      };
    }

    // No workflow to trigger
    await markWebhookProcessed(pool, event.event_id);
    return {
      success: true,
      event_id: event.event_id,
    };
  } catch (error) {
    console.error('[Webhook Processor] Error processing event:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    await markWebhookProcessed(pool, event.event_id, undefined, errorMessage);

    return {
      success: false,
      event_id: event.event_id,
      error: errorMessage,
    };
  }
}

/**
 * Build workflow context from webhook event
 */
function buildWorkflowContext(event: WebhookEvent): WorkflowContext {
  const payload = event.payload;
  
  // Extract repository information
  const repo = payload.repository
    ? {
        owner: payload.repository.owner?.login,
        name: payload.repository.name,
        default_branch: payload.repository.default_branch,
      }
    : undefined;

  // Extract issue information if present
  const issue = payload.issue
    ? {
        number: payload.issue.number,
        title: payload.issue.title,
        body: payload.issue.body,
        state: payload.issue.state,
        labels: payload.issue.labels?.map((l: any) => l.name) || [],
      }
    : undefined;

  // Extract pull request information if present
  const pull_request = payload.pull_request
    ? {
        number: payload.pull_request.number,
        title: payload.pull_request.title,
        body: payload.pull_request.body,
        state: payload.pull_request.state,
        head: payload.pull_request.head?.ref,
        base: payload.pull_request.base?.ref,
      }
    : undefined;

  // Extract check run information if present
  const check_run = payload.check_run
    ? {
        id: payload.check_run.id,
        name: payload.check_run.name,
        status: payload.check_run.status,
        conclusion: payload.check_run.conclusion,
        head_sha: payload.check_run.head_sha,
      }
    : undefined;

  return {
    variables: {},
    input: {
      event_type: event.event_type,
      event_action: event.event_action,
      issue,
      pull_request,
      check_run,
      sender: payload.sender,
    },
    repo,
  };
}
