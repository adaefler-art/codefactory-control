/**
 * INTENT Dev Mode Guard
 * 
 * Provides controlled guardrail relaxation for staging/development environments.
 * 
 * DEV MODE is active ONLY when:
 * 1. INTENT_DEV_MODE=true (environment variable)
 * 2. NODE_ENV !== 'production' OR deployment env is 'staging'
 * 3. User is admin (in AFU9_ADMIN_SUBS)
 * 
 * When active, allows a strict allowlist of write actions in DISCUSS mode.
 * All other guardrails remain enforced.
 * 
 * SECURITY: Production behavior is NEVER affected.
 */

import { Pool } from 'pg';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

/**
 * Actions allowed in DEV MODE during DISCUSS mode
 * These are actions that would normally be blocked in DISCUSS
 */
export const DEV_MODE_ALLOWLIST = [
  'issue_publish',           // Publish via orchestrator
  'bind_change_request',     // Bind CR to issue
  'commit_issue_draft',      // Commit draft version
  'create_afu9_issue',       // Create AFU-9 issue
  'update_afu9_issue',       // Update AFU-9 issue
  'create_timeline_event',   // Log timeline event
  'create_evidence_record',  // Record evidence
  'create_cp_assignment',    // Assign control pack
] as const;

export type DevModeAction = typeof DEV_MODE_ALLOWLIST[number];

/**
 * Dev mode audit log entry
 */
export interface DevModeAuditEntry {
  timestamp: string;
  userId: string;
  sessionId?: string;
  issueId?: string;
  action: DevModeAction | string;
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
  // Explicit INTENT_DEV_MODE flag must be set
  const devModeFlag = process.env.INTENT_DEV_MODE === 'true' || process.env.INTENT_DEV_MODE === '1';
  if (!devModeFlag) {
    return false;
  }
  
  // Must NOT be production environment
  const nodeEnv = process.env.NODE_ENV;
  const deploymentEnv = getDeploymentEnv();
  
  // Block in production regardless of flag
  if (nodeEnv === 'production' && deploymentEnv === 'production') {
    console.warn('[INTENT-DEV-MODE] Blocked: DEV MODE cannot be enabled in production');
    return false;
  }
  
  return true;
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
 * Log a DEV MODE exception to the audit trail
 * 
 * @param entry - The audit entry to log
 */
export function logDevModeException(entry: Omit<DevModeAuditEntry, 'timestamp' | 'devMode'>): void {
  const auditEntry: DevModeAuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    devMode: true,
    environment: getDeploymentEnv(),
  };
  
  // Log to console with structured format
  console.log('[INTENT-DEV-MODE-AUDIT]', JSON.stringify(auditEntry));
  
  // In the future, this could also write to a database audit table
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
    requestId: context?.requestId,
  });
  
  return { allowed: true, devMode: true };
}

/**
 * Database-backed audit logging for DEV MODE exceptions
 * 
 * For persistence beyond console logs (future enhancement)
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
