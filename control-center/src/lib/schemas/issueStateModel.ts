/**
 * AFU9 Issue State Model v1 - TypeScript/Zod Contract
 * 
 * This module defines the canonical Zod schemas and TypeScript types for the AFU9 Issue State Model v1.
 * 
 * Canonical Documentation: docs/state/STATE_MODEL_V1.md
 * 
 * @module issueStateModel
 */

import { z } from 'zod';

/**
 * LocalStatus - AFU9 Workflow State
 * 
 * Represents the issue's position in the AFU9 autonomous workflow.
 * This is the canonical AFU9 workflow state.
 */
export const LocalStatusSchema = z.enum([
  'CREATED',
  'SPEC_READY',
  'IMPLEMENTING',
  'VERIFIED',
  'MERGE_READY',
  'DONE',
  'HOLD',
  'KILLED',
]);

export type LocalStatus = z.infer<typeof LocalStatusSchema>;

/**
 * GithubMirrorStatus - GitHub Status Mirror
 * 
 * Status mirrored from GitHub Projects, labels, or issue state.
 * UNKNOWN indicates no GitHub status available or unmapped.
 */
export const GithubMirrorStatusSchema = z.enum([
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
  'UNKNOWN',
]);

export type GithubMirrorStatus = z.infer<typeof GithubMirrorStatusSchema>;

/**
 * ExecutionState - Playbook/Automation Execution State
 * 
 * Reflects the current execution state of any running playbooks or automation.
 */
export const ExecutionStateSchema = z.enum([
  'IDLE',
  'RUNNING',
  'FAILED',
  'SUCCEEDED',
]);

export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

/**
 * HandoffState - AFU9↔GitHub Sync State
 * 
 * Tracks synchronization state between AFU9 and GitHub.
 */
export const HandoffStateSchema = z.enum([
  'UNSYNCED',
  'SYNCED',
]);

export type HandoffState = z.infer<typeof HandoffStateSchema>;

/**
 * Complete Issue State Model
 * 
 * Combines all state dimensions for a complete issue state representation.
 * EffectiveStatus is derived and not stored.
 */
export const IssueStateModelSchema = z.object({
  localStatus: LocalStatusSchema,
  githubMirrorStatus: GithubMirrorStatusSchema,
  executionState: ExecutionStateSchema,
  handoffState: HandoffStateSchema,
});

export type IssueStateModel = z.infer<typeof IssueStateModelSchema>;

/**
 * Partial Issue State Model for updates
 * 
 * Allows updating individual state dimensions independently.
 */
export const PartialIssueStateModelSchema = IssueStateModelSchema.partial();

export type PartialIssueStateModel = z.infer<typeof PartialIssueStateModelSchema>;

/**
 * Constants for all valid LocalStatus values
 */
export const LOCAL_STATUS_VALUES = LocalStatusSchema.options;

/**
 * Constants for all valid GithubMirrorStatus values
 */
export const GITHUB_MIRROR_STATUS_VALUES = GithubMirrorStatusSchema.options;

/**
 * Constants for all valid ExecutionState values
 */
export const EXECUTION_STATE_VALUES = ExecutionStateSchema.options;

/**
 * Constants for all valid HandoffState values
 */
export const HANDOFF_STATE_VALUES = HandoffStateSchema.options;

/**
 * Validation helper: Check if a value is a valid LocalStatus
 */
export function isLocalStatus(value: unknown): value is LocalStatus {
  return LocalStatusSchema.safeParse(value).success;
}

/**
 * Validation helper: Check if a value is a valid GithubMirrorStatus
 */
export function isGithubMirrorStatus(value: unknown): value is GithubMirrorStatus {
  return GithubMirrorStatusSchema.safeParse(value).success;
}

/**
 * Validation helper: Check if a value is a valid ExecutionState
 */
export function isExecutionState(value: unknown): value is ExecutionState {
  return ExecutionStateSchema.safeParse(value).success;
}

/**
 * Validation helper: Check if a value is a valid HandoffState
 */
export function isHandoffState(value: unknown): value is HandoffState {
  return HandoffStateSchema.safeParse(value).success;
}

/**
 * Validation helper: Validate complete issue state model
 * 
 * @throws {z.ZodError} if validation fails
 */
export function validateIssueStateModel(data: unknown): IssueStateModel {
  return IssueStateModelSchema.parse(data);
}

/**
 * Validation helper: Safely validate issue state model
 * 
 * @returns Validation result with success boolean and data/error
 */
export function safeValidateIssueStateModel(
  data: unknown
): ReturnType<typeof IssueStateModelSchema.safeParse> {
  return IssueStateModelSchema.safeParse(data);
}

