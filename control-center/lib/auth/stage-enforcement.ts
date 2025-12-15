/**
 * Stage-based access control enforcement
 * 
 * This module implements environment variable driven group-to-stage mapping
 * and hostname-based stage detection with fail-safe defaults.
 */

// Environment variable driven group mapping
const AFU9_STAGE_GROUP_PROD = process.env.AFU9_STAGE_GROUP_PROD || 'afu9-admin-prod';
const AFU9_STAGE_GROUP_STAGING = process.env.AFU9_STAGE_GROUP_STAGING || 'afu9-engineer-stage,afu9-readonly-stage';
const AFU9_STAGE_GROUP_DEV = process.env.AFU9_STAGE_GROUP_DEV || 'afu9-engineer-stage,afu9-readonly-stage';
const AFU9_DEFAULT_STAGE = process.env.AFU9_DEFAULT_STAGE || 'stage';
const AFU9_GROUPS_CLAIM = process.env.AFU9_GROUPS_CLAIM || 'cognito:groups';

// Parse comma-separated group lists into arrays
const PROD_GROUPS = AFU9_STAGE_GROUP_PROD.split(',').map(g => g.trim()).filter(g => g);
const STAGING_GROUPS = AFU9_STAGE_GROUP_STAGING.split(',').map(g => g.trim()).filter(g => g);
const DEV_GROUPS = AFU9_STAGE_GROUP_DEV.split(',').map(g => g.trim()).filter(g => g);

/**
 * Stage type definition
 */
export type Stage = 'prod' | 'staging' | 'dev';

/**
 * Get the stage from a hostname
 * 
 * Maps hostnames to stages:
 * - stage.afu-9.com → staging
 * - afu-9.com, prod.afu-9.com, www.afu-9.com → prod
 * - localhost, 127.0.0.1 → dev (or AFU9_DEFAULT_STAGE)
 * - unknown hostnames → AFU9_DEFAULT_STAGE
 * 
 * @param hostname - Request hostname
 * @returns Stage name (prod, staging, dev)
 */
export function getStageFromHostname(hostname: string): Stage {
  // Normalize hostname to lowercase for case-insensitive comparison
  const normalizedHost = hostname.toLowerCase();

  // Staging environment
  if (normalizedHost === 'stage.afu-9.com') {
    return 'staging';
  }

  // Production environment
  if (normalizedHost === 'afu-9.com' || 
      normalizedHost === 'prod.afu-9.com' || 
      normalizedHost === 'www.afu-9.com') {
    return 'prod';
  }

  // Local development
  if (normalizedHost === 'localhost' || 
      normalizedHost === '127.0.0.1' ||
      normalizedHost.startsWith('localhost:') ||
      normalizedHost.startsWith('127.0.0.1:')) {
    // Use default stage for local dev (typically 'dev' or 'stage')
    return (AFU9_DEFAULT_STAGE === 'prod' || AFU9_DEFAULT_STAGE === 'staging' || AFU9_DEFAULT_STAGE === 'dev') 
      ? AFU9_DEFAULT_STAGE as Stage 
      : 'dev';
  }

  // Unknown hostname - use default stage
  console.log(`[STAGE-ENFORCEMENT] Unknown hostname "${hostname}", using default stage: ${AFU9_DEFAULT_STAGE}`);
  return (AFU9_DEFAULT_STAGE === 'prod' || AFU9_DEFAULT_STAGE === 'staging' || AFU9_DEFAULT_STAGE === 'dev') 
    ? AFU9_DEFAULT_STAGE as Stage 
    : 'staging';
}

/**
 * Check if user has access to the required stage based on their groups
 * 
 * Implementation notes:
 * - No groups → always returns false (fail-closed)
 * - Empty groups array → always returns false (fail-closed)
 * - Multiple groups → any matching group grants access
 * - Group matching is case-sensitive and exact
 * 
 * Stage to group mapping (configurable via env vars):
 * - prod: Requires groups in AFU9_STAGE_GROUP_PROD
 * - staging: Requires groups in AFU9_STAGE_GROUP_STAGING
 * - dev: Requires groups in AFU9_STAGE_GROUP_DEV
 * 
 * @param groups - User's groups from JWT (e.g., cognito:groups claim)
 * @param requiredStage - Stage being accessed (prod, staging, dev)
 * @returns True if user has access, false otherwise (fail-closed)
 */
export function hasStageAccess(groups: string[] | undefined, requiredStage: Stage): boolean {
  // Fail closed: no groups provided
  if (!groups || groups.length === 0) {
    console.log('[STAGE-ENFORCEMENT] Access denied: no groups provided');
    return false;
  }

  // Determine which groups grant access to the required stage
  let allowedGroups: string[] = [];
  
  switch (requiredStage) {
    case 'prod':
      allowedGroups = PROD_GROUPS;
      break;
    case 'staging':
      allowedGroups = STAGING_GROUPS;
      break;
    case 'dev':
      allowedGroups = DEV_GROUPS;
      break;
    default:
      console.error(`[STAGE-ENFORCEMENT] Unknown stage: ${requiredStage}`);
      return false; // Fail closed for unknown stages
  }

  // Check if user has any of the allowed groups
  const hasAccess = groups.some(userGroup => allowedGroups.includes(userGroup));

  if (hasAccess) {
    console.log(`[STAGE-ENFORCEMENT] Access granted to ${requiredStage} stage for groups:`, groups);
  } else {
    console.log(`[STAGE-ENFORCEMENT] Access denied to ${requiredStage} stage. User groups:`, groups, 'Required groups:', allowedGroups);
  }

  return hasAccess;
}

/**
 * Get the groups claim key from environment variables
 * Default: 'cognito:groups'
 * 
 * @returns Groups claim key
 */
export function getGroupsClaimKey(): string {
  return AFU9_GROUPS_CLAIM;
}
