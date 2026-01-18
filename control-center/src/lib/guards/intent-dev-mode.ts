/**
 * INTENT Dev Mode Guard
 * 
 * Provides controlled guardrail relaxation for staging/development environments.
 * 
 * DEV MODE is active ONLY when:
 * 1. AFU9_INTENT_DEV_MODE=true (environment variable)
 * 2. ENVIRONMENT is 'staging' OR NODE_ENV is 'development'
 * 3. User is admin (in AFU9_ADMIN_SUBS)
 * 
 * When active, allows a strict allowlist of write actions in DISCUSS mode.
 * All other guardrails remain enforced.
 * 
 * SECURITY: Production behavior is NEVER affected.
 */

import { Pool } from 'pg';
import { getDeploymentEnv } from '../utils/deployment-env.js';

/**
 * Actions allowed in DEV MODE during DISCUSS mode
 * These are actions that would normally be blocked in DISCUSS
 */
export const DEV_MODE_ALLOWLIST = [
  // Issue draft tools
  'save_issue_draft',
  'apply_issue_draft_patch',
  'validate_issue_draft',
  'commit_issue_draft',
  // Change request tools
  'save_change_request',
  'validate_change_request',
  'publish_to_github',
  // Additional lifecycle actions
  'issue_publish',
  'bind_change_request',
  'create_afu9_issue',
  'update_afu9_issue',
] as const;

export type DevModeAction = typeof DEV_MODE_ALLOWLIST[number];

/**
 * Tool name to dev mode action mapping
 */
const TOOL_TO_DEV_MODE_ACTION: Record<string, string> = {
  'save_issue_draft': 'save_issue_draft',
  'validate_issue_draft': 'validate_issue_draft',
  'commit_issue_draft': 'commit_issue_draft',
  'save_change_request': 'save_change_request',
  'validate_change_request': 'validate_change_request',
  'publish_to_github': 'publish_to_github',
  'apply_issue_draft_patch': 'save_issue_draft',
};

/**
 * Dev mode audit log entry
 */
export interface DevModeAuditEntry {
  timestamp: string;
  userId: string;
  sessionId?: string;
  issueId?: string;
  action: DevModeAction | string;
  toolName?: string;
  requestId?: string;
  devMode: true;
  environment: string;
}

/**
 * Check if DEV MODE is enabled for environment
 * 
 * @returns true if DEV MODE environment conditions are met
 */
export function isDevModeEnvironment(): boolean {
  // Explicit AFU9_INTENT_DEV_MODE flag must be set
  const devModeFlag = process.env.AFU9_INTENT_DEV_MODE === 'true' || process.env.AFU9_INTENT_DEV_MODE === '1';
  if (!devModeFlag) {
    return false;
  }
  
  // Must NOT be production environment
  const deploymentEnv = getDeploymentEnv();
  
  // Block in production regardless of flag
  if (deploymentEnv === 'production') {
    console.warn('[INTENT-DEV-MODE] Blocked: DEV MODE cannot be enabled in production');
    return false;
  }
  
  // Allowed in staging or development
  return deploymentEnv === 'staging' || deploymentEnv === 'development';
}

/**
 * Check if user is admin (from AFU9_ADMIN_SUBS)
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

/**
 * Check if DEV MODE is active for this request
 * 
 * All conditions must be met:
 * 1. Environment allows DEV MODE
 * 2. User is admin
 * 
 * @param userId - The authenticated user ID
 * @returns true if DEV MODE is active for this user
 */
export function isDevModeActive(userId: string): boolean {
  if (!isDevModeEnvironment()) {
    return false;
  }
  
  if (!isAdminUser(userId)) {
    return false;
  }
  
  return true;
}

/**
 * Check if a specific action is allowed in DEV MODE during DISCUSS mode
 * 
 * @param action - The action to check
 * @returns true if action is in the allowlist
 */
export function isActionAllowedInDevMode(action: string): boolean {
  return DEV_MODE_ALLOWLIST.includes(action as DevModeAction);
}

/**
 * Get the DEV MODE action name for a tool
 * Returns undefined if tool is not in the DEV MODE allowlist
 */
export function getDevModeActionForTool(toolName: string): string | undefined {
  return TOOL_TO_DEV_MODE_ACTION[toolName];
}

/**
 * Log a DEV MODE exception to the audit trail
 * 
 * @param entry - The audit entry to log
 */
export function logDevModeException(entry: Omit<DevModeAuditEntry, 'timestamp' | 'devMode' | 'environment'>): void {
  const auditEntry: DevModeAuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    devMode: true,
    environment: getDeploymentEnv(),
  };
  
  // Log to console with structured format
  console.log('[INTENT-DEV-MODE-AUDIT]', JSON.stringify(auditEntry));
}

/**
 * Check if an action should be allowed for a DISCUSS mode session
 * 
 * Normally, write actions are blocked in DISCUSS mode.
 * With DEV MODE active, allowlisted actions are permitted.
 * 
 * @param userId - The authenticated user ID
 * @param action - The action to check
 * @param context - Additional context for audit logging
 * @returns { allowed: boolean, devMode: boolean }
 */
export function checkDevModeActionAllowed(
  userId: string,
  action: string,
  context?: {
    sessionId?: string;
    issueId?: string;
    toolName?: string;
    requestId?: string;
  }
): { allowed: boolean; devMode: boolean } {
  // Check if DEV MODE is active
  if (!isDevModeActive(userId)) {
    return { allowed: false, devMode: false };
  }
  
  // Check if action is in allowlist
  if (!isActionAllowedInDevMode(action)) {
    return { allowed: false, devMode: true };
  }
  
  // Log the exception
  logDevModeException({
    userId,
    action,
    sessionId: context?.sessionId,
    issueId: context?.issueId,
    toolName: context?.toolName,
    requestId: context?.requestId,
  });
  
  return { allowed: true, devMode: true };
}

/**
 * Database-backed audit logging for DEV MODE exceptions
 * 
 * For persistence beyond console logs
 */
export async function logDevModeExceptionToDb(
  pool: Pool,
  entry: Omit<DevModeAuditEntry, 'timestamp' | 'devMode'>
): Promise<void> {
  const auditEntry: DevModeAuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    devMode: true,
    environment: getDeploymentEnv(),
  };
  
  // Log to console
  console.log('[INTENT-DEV-MODE-AUDIT]', JSON.stringify(auditEntry));
  
  // Log to intent session messages table for audit trail
  try {
    if (entry.sessionId) {
      await pool.query(
        `INSERT INTO intent_session_messages 
         (session_id, role, content, metadata)
         VALUES ($1, 'system', $2, $3)`,
        [
          entry.sessionId,
          `[DEV MODE] Action "${entry.action}" executed with guardrail bypass`,
          JSON.stringify({
            type: 'dev_mode_audit',
            ...auditEntry,
          }),
        ]
      );
    }
  } catch (err) {
    // Non-blocking: audit logging failure should not break the action
    console.error('[INTENT-DEV-MODE-AUDIT] Failed to log to DB:', err);
  }
}
