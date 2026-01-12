/**
 * Repo/Issue Actions Registry Types (E83.1)
 * 
 * Defines machine-readable specifications for what is automatable
 * in a repository, including allowed actions, rules, and preconditions.
 * 
 * Epic E83: GH Workflow Orchestrator
 */

import { z } from 'zod';

// ========================================
// Registry Schema Version
// ========================================

export const REPO_ACTIONS_REGISTRY_VERSION = '1.0.0';

// ========================================
// Action Types
// ========================================

/**
 * All possible automatable actions in the workflow
 */
export const ActionTypeSchema = z.enum([
  // Issue actions
  'assign_issue',
  'assign_copilot', // E83.2: Specific action for assigning GitHub Copilot
  'unassign_issue',
  'add_label',
  'remove_label',
  'close_issue',
  'reopen_issue',
  'add_comment',
  
  // PR actions
  'create_pr',
  'update_pr',
  'assign_pr',
  'request_review',
  'approve_pr',
  'merge_pr',
  'close_pr',
  'reopen_pr',
  
  // Check actions
  'rerun_checks',
  'rerun_failed_jobs',
  'wait_for_checks',
  
  // Branch actions
  'cleanup_branch',
  'create_branch',
  'delete_branch',
  
  // Other
  'dispatch_workflow',
  'collect_artifacts',
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

// ========================================
// Precondition Types
// ========================================

/**
 * Precondition that must be met before an action can be executed
 */
export const PreconditionSchema = z.object({
  type: z.enum([
    'checks_passed',
    'checks_status',
    'review_approved',
    'review_count',
    'label_present',
    'label_absent',
    'assignee_set',
    'branch_protection',
    'pr_mergeable',
    'pr_not_draft',
    'environment_approved',
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
}).strict();

export type Precondition = z.infer<typeof PreconditionSchema>;

// ========================================
// Approval Rules
// ========================================

/**
 * Approval requirement for an action
 */
export const ApprovalRuleSchema = z.object({
  required: z.boolean(),
  minApprovers: z.number().int().min(0).default(1),
  approverRoles: z.array(z.string()).optional(), // e.g., ['admin', 'maintainer']
  approverTeams: z.array(z.string()).optional(), // e.g., ['@org/team-name']
  approverUsers: z.array(z.string()).optional(), // e.g., ['username']
  requireCodeOwners: z.boolean().default(false),
  dismissStaleReviews: z.boolean().default(false),
}).strict();

export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

// ========================================
// Check Requirements
// ========================================

/**
 * Required check/status that must pass
 */
export const RequiredCheckSchema = z.object({
  name: z.string(), // Check suite name or status context
  required: z.boolean().default(true),
  allowedStatuses: z.array(z.enum(['success', 'pending', 'failure', 'error', 'neutral', 'skipped'])).default(['success']),
  description: z.string().optional(),
}).strict();

export type RequiredCheck = z.infer<typeof RequiredCheckSchema>;

// ========================================
// Merge Policy
// ========================================

/**
 * Merge strategy and rules
 */
export const MergePolicySchema = z.object({
  allowedMethods: z.array(z.enum(['merge', 'squash', 'rebase'])).default(['squash']),
  defaultMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
  requireLinearHistory: z.boolean().default(false),
  requireUpToDateBranch: z.boolean().default(true),
  autoMergeEnabled: z.boolean().default(false),
  deleteBranchOnMerge: z.boolean().default(true),
}).strict();

export type MergePolicy = z.infer<typeof MergePolicySchema>;

// ========================================
// Action Configuration
// ========================================

/**
 * Configuration for a specific action
 */
export const ActionConfigSchema = z.object({
  actionType: ActionTypeSchema,
  enabled: z.boolean().default(true),
  preconditions: z.array(PreconditionSchema).default([]),
  approvalRule: ApprovalRuleSchema.optional(),
  maxRetries: z.number().int().min(0).default(0),
  cooldownMinutes: z.number().int().min(0).default(0),
  requireEvidence: z.boolean().default(true),
  description: z.string().optional(),
}).strict();

export type ActionConfig = z.infer<typeof ActionConfigSchema>;

// ========================================
// GitHub Object Mappings
// ========================================

/**
 * Label mapping configuration
 */
export const LabelMappingSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
  description: z.string().optional(),
  semantic: z.string().optional(), // e.g., 'status:in-progress', 'priority:high'
}).strict();

export type LabelMapping = z.infer<typeof LabelMappingSchema>;

/**
 * Reviewer mapping configuration
 */
export const ReviewerMappingSchema = z.object({
  type: z.enum(['user', 'team']),
  identifier: z.string(), // username or team slug
  role: z.string().optional(), // e.g., 'code-owner', 'security-reviewer'
}).strict();

export type ReviewerMapping = z.infer<typeof ReviewerMappingSchema>;

/**
 * Environment configuration
 */
export const EnvironmentConfigSchema = z.object({
  name: z.string(),
  requireApproval: z.boolean().default(false),
  approvers: z.array(z.string()).default([]),
  protectionRules: z.array(z.string()).default([]),
}).strict();

export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;

// ========================================
// Complete Registry Schema
// ========================================

/**
 * Repository Actions Registry v1.0.0
 * 
 * Canonical source of truth for what actions are automatable
 * and under what conditions they can be executed.
 */
export const RepoActionsRegistrySchema = z.object({
  version: z.string().default(REPO_ACTIONS_REGISTRY_VERSION),
  registryId: z.string().min(1), // Unique identifier for this registry
  repository: z.string(), // Format: "owner/repo"
  
  // Core configuration
  allowedActions: z.array(ActionConfigSchema),
  requiredChecks: z.array(RequiredCheckSchema).default([]),
  approvalRules: ApprovalRuleSchema.optional(),
  mergePolicy: MergePolicySchema.optional(),
  
  // GitHub object mappings
  labelMappings: z.array(LabelMappingSchema).default([]),
  reviewerMappings: z.array(ReviewerMappingSchema).default([]),
  environments: z.array(EnvironmentConfigSchema).default([]),
  
  // Metadata
  createdAt: z.string().datetime(), // ISO 8601
  createdBy: z.string(),
  updatedAt: z.string().datetime().optional(),
  updatedBy: z.string().optional(),
  notes: z.string().optional(),
  
  // Fail-closed behavior
  failClosed: z.boolean().default(true), // If true, unknown actions are blocked
}).strict();

export type RepoActionsRegistry = z.infer<typeof RepoActionsRegistrySchema>;

// ========================================
// Registry Validation Result
// ========================================

/**
 * Result of validating an action against the registry
 */
export interface ActionValidationResult {
  allowed: boolean;
  actionType: ActionType;
  actionConfig?: ActionConfig;
  preconditionsMet: boolean;
  missingPreconditions: Precondition[];
  approvalRequired: boolean;
  approvalMet: boolean;
  errors: string[];
  warnings: string[];
}

// ========================================
// Database Types
// ========================================

/**
 * Registry record from database
 */
export interface RepoActionsRegistryRecord {
  id: string;
  registryId: string;
  repository: string;
  version: string;
  content: RepoActionsRegistry;
  active: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt?: Date;
  updatedBy?: string;
}

/**
 * Registry audit log entry
 */
export interface RegistryAuditLog {
  id: number;
  registryId: string;
  actionType: ActionType;
  actionStatus: 'allowed' | 'blocked' | 'pending_approval';
  repository: string;
  resourceType: 'issue' | 'pull_request';
  resourceNumber: number;
  validationResult: ActionValidationResult;
  executedAt?: Date;
  executedBy?: string;
  createdAt: Date;
}
