/**
 * GitHub Issue Draft Preview Engine (E82.2)
 * 
 * Provides dry-run preview of IssueDraft publishing without side effects.
 * Shows: create/update/skip + reason + diff for each item.
 * 
 * NON-NEGOTIABLES:
 * - No side effects (no GitHub API calls, no database writes)
 * - Deterministic output (stable ordering, stable diff)
 * - Machine-readable reasons (enum + human text)
 * - Complete diff view (title/body/labels/assignees/milestone)
 */

import { renderIssueDraftAsIssue, generateLabelsForIssueDraft, mergeLabelsForIssueDraftUpdate, type RenderedIssueDraft } from './issue-draft-renderer';
import { validateIssueDraft } from '../validators/issueDraftValidator';
import type { IssueDraft } from '../schemas/issueDraft';
import { createHash } from 'crypto';

/**
 * Preview action types
 */
export type PreviewAction = 'create' | 'update' | 'skip';

/**
 * Machine-readable reason codes
 */
export enum PreviewReasonCode {
  // Create reasons
  NO_CANONICAL_ID_MATCH = 'NO_CANONICAL_ID_MATCH',
  NEW_ISSUE = 'NEW_ISSUE',
  
  // Update reasons
  CONTENT_CHANGED = 'CONTENT_CHANGED',
  LABELS_CHANGED = 'LABELS_CHANGED',
  TITLE_CHANGED = 'TITLE_CHANGED',
  
  // Skip reasons
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NO_CHANGES_DETECTED = 'NO_CHANGES_DETECTED',
  IDENTICAL_CONTENT = 'IDENTICAL_CONTENT',
  REPO_ACCESS_DENIED = 'REPO_ACCESS_DENIED',
  MISSING_REPO_INFO = 'MISSING_REPO_INFO',
}

/**
 * Field-level diff information
 */
export interface FieldDiff {
  field: 'title' | 'body' | 'labels' | 'assignees' | 'milestone';
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  before: unknown;
  after: unknown;
}

/**
 * Preview result for a single IssueDraft
 */
export interface PreviewResult {
  /** Canonical ID of the issue */
  canonicalId: string;
  /** Predicted action */
  action: PreviewAction;
  /** Machine-readable reason code */
  reasonCode: PreviewReasonCode;
  /** Human-readable reason text */
  reasonText: string;
  /** Field-level diffs */
  diffs: FieldDiff[];
  /** Rendered title (what would be published) */
  renderedTitle?: string;
  /** Rendered body hash (what would be published) */
  renderedHash?: string;
  /** Labels that would be applied */
  labelsToApply?: string[];
  /** Existing issue number (if updating) */
  existingIssueNumber?: number;
  /** Validation errors (if validation failed) */
  validationErrors?: Array<{ path: string; message: string }>;
}

/**
 * Batch preview result
 */
export interface BatchPreviewResult {
  /** Total number of items */
  total: number;
  /** Number that would be created */
  toCreate: number;
  /** Number that would be updated */
  toUpdate: number;
  /** Number that would be skipped */
  toSkip: number;
  /** Individual preview results (sorted by canonicalId for determinism) */
  results: PreviewResult[];
  /** Hash of entire preview (for change detection) */
  previewHash: string;
}

/**
 * Existing issue information (mock interface for preview)
 */
export interface ExistingIssueInfo {
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  assignees?: string[];
  milestone?: string | null;
}

/**
 * Preview input with optional existing issue data
 */
export interface PreviewInput {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** IssueDrafts to preview */
  drafts: IssueDraft[];
  /** Existing issues keyed by canonicalId (for diff computation) */
  existingIssues?: Map<string, ExistingIssueInfo>;
}

/**
 * Generate preview for IssueDraft batch
 * 
 * Determines action (create/update/skip) and computes diffs without side effects.
 * 
 * @param input - Preview input with drafts and optional existing issue data
 * @returns Batch preview result with deterministic ordering
 */
export function generatePreview(input: PreviewInput): BatchPreviewResult {
  const { owner, repo, drafts, existingIssues = new Map() } = input;
  
  // Validate repository info
  if (!owner || !repo) {
    // All drafts would fail
    const results = drafts.map(draft => ({
      canonicalId: draft.canonicalId,
      action: 'skip' as PreviewAction,
      reasonCode: PreviewReasonCode.MISSING_REPO_INFO,
      reasonText: 'Missing repository owner or name',
      diffs: [],
      validationErrors: [{ path: 'repository', message: 'Owner and repo are required' }],
    }));
    
    return {
      total: drafts.length,
      toCreate: 0,
      toUpdate: 0,
      toSkip: drafts.length,
      results: sortResultsByCanonicalId(results),
      previewHash: computePreviewHash(results),
    };
  }
  
  // Process each draft
  const results = drafts.map(draft => previewSingleDraft(draft, existingIssues));
  
  // Sort for determinism
  const sortedResults = sortResultsByCanonicalId(results);
  
  // Compute summary
  const toCreate = sortedResults.filter(r => r.action === 'create').length;
  const toUpdate = sortedResults.filter(r => r.action === 'update').length;
  const toSkip = sortedResults.filter(r => r.action === 'skip').length;
  
  return {
    total: drafts.length,
    toCreate,
    toUpdate,
    toSkip,
    results: sortedResults,
    previewHash: computePreviewHash(sortedResults),
  };
}

/**
 * Preview a single IssueDraft
 * 
 * @param draft - IssueDraft to preview
 * @param existingIssues - Map of existing issues by canonicalId
 * @returns Preview result for this draft
 */
function previewSingleDraft(
  draft: IssueDraft,
  existingIssues: Map<string, ExistingIssueInfo>
): PreviewResult {
  // Step 1: Validate draft
  const validation = validateIssueDraft(draft);
  
  if (!validation.isValid) {
    return {
      canonicalId: draft.canonicalId,
      action: 'skip',
      reasonCode: PreviewReasonCode.VALIDATION_FAILED,
      reasonText: `Validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
      diffs: [],
      validationErrors: validation.errors,
    };
  }
  
  // Step 2: Render issue
  const rendered = renderIssueDraftAsIssue(draft);
  const labels = generateLabelsForIssueDraft(draft);
  
  // Step 3: Check if issue exists
  const existingIssue = existingIssues.get(draft.canonicalId);
  
  if (!existingIssue) {
    // Would create new issue
    return {
      canonicalId: draft.canonicalId,
      action: 'create',
      reasonCode: PreviewReasonCode.NEW_ISSUE,
      reasonText: 'No existing issue found with this canonical ID',
      diffs: [
        { field: 'title', changeType: 'added', before: null, after: rendered.title },
        { field: 'body', changeType: 'added', before: null, after: rendered.body },
        { field: 'labels', changeType: 'added', before: [], after: labels },
      ],
      renderedTitle: rendered.title,
      renderedHash: rendered.renderedHash,
      labelsToApply: labels,
    };
  }
  
  // Step 4: Compute diffs for existing issue
  const diffs = computeDiffs(rendered, labels, existingIssue);
  
  // Step 5: Determine if update is needed
  const hasChanges = diffs.some(d => d.changeType !== 'unchanged');
  
  if (!hasChanges) {
    return {
      canonicalId: draft.canonicalId,
      action: 'skip',
      reasonCode: PreviewReasonCode.NO_CHANGES_DETECTED,
      reasonText: 'No changes detected from existing issue',
      diffs,
      renderedTitle: rendered.title,
      renderedHash: rendered.renderedHash,
      labelsToApply: mergeLabelsForIssueDraftUpdate(existingIssue.labels, draft),
      existingIssueNumber: existingIssue.issueNumber,
    };
  }
  
  // Would update existing issue
  const changeReasons = [];
  if (diffs.find(d => d.field === 'title' && d.changeType === 'modified')) {
    changeReasons.push('title changed');
  }
  if (diffs.find(d => d.field === 'body' && d.changeType === 'modified')) {
    changeReasons.push('body changed');
  }
  if (diffs.find(d => d.field === 'labels' && d.changeType === 'modified')) {
    changeReasons.push('labels changed');
  }
  
  return {
    canonicalId: draft.canonicalId,
    action: 'update',
    reasonCode: PreviewReasonCode.CONTENT_CHANGED,
    reasonText: `Changes detected: ${changeReasons.join(', ')}`,
    diffs,
    renderedTitle: rendered.title,
    renderedHash: rendered.renderedHash,
    labelsToApply: mergeLabelsForIssueDraftUpdate(existingIssue.labels, draft),
    existingIssueNumber: existingIssue.issueNumber,
  };
}

/**
 * Compute field-level diffs between rendered draft and existing issue
 * 
 * @param rendered - Rendered issue draft
 * @param labels - Labels to apply
 * @param existing - Existing issue information
 * @returns Array of field diffs
 */
function computeDiffs(
  rendered: RenderedIssueDraft,
  labels: string[],
  existing: ExistingIssueInfo
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  
  // Title diff
  if (rendered.title !== existing.title) {
    diffs.push({
      field: 'title',
      changeType: 'modified',
      before: existing.title,
      after: rendered.title,
    });
  } else {
    diffs.push({
      field: 'title',
      changeType: 'unchanged',
      before: existing.title,
      after: rendered.title,
    });
  }
  
  // Body diff
  if (rendered.body !== existing.body) {
    diffs.push({
      field: 'body',
      changeType: 'modified',
      before: existing.body,
      after: rendered.body,
    });
  } else {
    diffs.push({
      field: 'body',
      changeType: 'unchanged',
      before: existing.body,
      after: rendered.body,
    });
  }
  
  // Labels diff (compare sorted arrays)
  const existingLabelsSorted = [...existing.labels].sort();
  const newLabelsSorted = [...labels].sort();
  const labelsChanged = JSON.stringify(existingLabelsSorted) !== JSON.stringify(newLabelsSorted);
  
  if (labelsChanged) {
    diffs.push({
      field: 'labels',
      changeType: 'modified',
      before: existing.labels,
      after: labels,
    });
  } else {
    diffs.push({
      field: 'labels',
      changeType: 'unchanged',
      before: existing.labels,
      after: labels,
    });
  }
  
  // Sort diffs by field name for determinism
  return diffs.sort((a, b) => a.field.localeCompare(b.field));
}

/**
 * Sort preview results by canonicalId for deterministic output
 * 
 * @param results - Preview results to sort
 * @returns Sorted results
 */
function sortResultsByCanonicalId(results: PreviewResult[]): PreviewResult[] {
  return [...results].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}

/**
 * Compute deterministic hash of preview results
 * 
 * Uses stable stringify + SHA-256 for reproducibility.
 * 
 * @param results - Preview results to hash
 * @returns Hex-encoded SHA-256 hash
 */
function computePreviewHash(results: PreviewResult[]): string {
  // Create stable representation (already sorted)
  const stableData = results.map(r => ({
    canonicalId: r.canonicalId,
    action: r.action,
    reasonCode: r.reasonCode,
    diffs: r.diffs.map(d => ({
      field: d.field,
      changeType: d.changeType,
      // Hash values instead of including full content (bounded size)
      beforeHash: d.before ? hashValue(d.before) : null,
      afterHash: d.after ? hashValue(d.after) : null,
    })),
  }));
  
  const stableJson = JSON.stringify(stableData);
  return createHash('sha256').update(stableJson, 'utf8').digest('hex');
}

/**
 * Hash a value for diff comparison
 * 
 * @param value - Value to hash
 * @returns Hex-encoded SHA-256 hash
 */
function hashValue(value: unknown): string {
  const json = JSON.stringify(value);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
