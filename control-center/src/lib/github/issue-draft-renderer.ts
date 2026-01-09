/**
 * GitHub Issue Renderer for IssueDraft → GitHub Issue Flow (E82.1)
 * 
 * Deterministic markdown template for rendering IssueDraft JSON as GitHub issue body.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic rendering (same IssueDraft → same markdown)
 * - Include canonical ID marker in body
 * - Include all governance metadata (guards, KPI, verify)
 * - Stable section ordering
 */

import type { IssueDraft } from '../schemas/issueDraft';
import { generateBodyWithMarker } from './canonical-id-resolver';
import { createHash } from 'crypto';

/**
 * Rendered issue result
 */
export interface RenderedIssueDraft {
  /** Full title */
  title: string;
  /** Markdown body with all sections */
  body: string;
  /** Hash of rendered body (for tracking changes) */
  renderedHash: string;
}

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Render an IssueDraft as a GitHub issue
 * 
 * Generates deterministic title and body markdown with all required sections.
 * 
 * @param draft - IssueDraft to render
 * @returns Rendered issue with title and body
 */
export function renderIssueDraftAsIssue(draft: IssueDraft): RenderedIssueDraft {
  // 1. Generate title (no CID marker - already in draft.title or will be in body)
  const title = draft.title;
  
  // 2. Generate body sections
  const bodySections = [
    renderBodySection(draft),
    renderMetadataSection(draft),
    renderAcceptanceCriteriaSection(draft),
    renderVerificationSection(draft),
    renderDependenciesSection(draft),
    renderGuardsSection(draft),
    renderKPISection(draft),
  ].filter(Boolean); // Remove empty sections
  
  const bodyContent = bodySections.join('\n\n---\n\n');
  
  // 3. Add canonical ID marker at the start of body
  const body = generateBodyWithMarker(draft.canonicalId, bodyContent);
  
  // 4. Compute hash of rendered body (for change detection)
  const renderedHash = computeHash(body);
  
  return {
    title,
    body,
    renderedHash,
  };
}

/**
 * Section 1: Main body content
 */
function renderBodySection(draft: IssueDraft): string {
  return draft.body;
}

/**
 * Section 2: Metadata (type, priority, labels)
 */
function renderMetadataSection(draft: IssueDraft): string {
  const lines: string[] = [];
  
  lines.push('## Metadata');
  lines.push('');
  lines.push(`**Type:** ${draft.type}`);
  lines.push(`**Priority:** ${draft.priority}`);
  
  if (draft.labels && draft.labels.length > 0) {
    lines.push(`**Labels:** ${draft.labels.join(', ')}`);
  }
  
  return lines.join('\n');
}

/**
 * Section 3: Acceptance Criteria
 */
function renderAcceptanceCriteriaSection(draft: IssueDraft): string {
  const lines: string[] = [];
  
  lines.push('## Acceptance Criteria');
  lines.push('');
  
  draft.acceptanceCriteria.forEach((criterion, index) => {
    lines.push(`${index + 1}. ${criterion}`);
  });
  
  return lines.join('\n');
}

/**
 * Section 4: Verification
 */
function renderVerificationSection(draft: IssueDraft): string {
  const lines: string[] = [];
  
  lines.push('## Verification');
  lines.push('');
  
  lines.push('**Commands:**');
  draft.verify.commands.forEach(cmd => {
    lines.push(`- \`${cmd}\``);
  });
  
  lines.push('');
  lines.push('**Expected:**');
  draft.verify.expected.forEach(exp => {
    lines.push(`- ${exp}`);
  });
  
  return lines.join('\n');
}

/**
 * Section 5: Dependencies
 */
function renderDependenciesSection(draft: IssueDraft): string | null {
  if (!draft.dependsOn || draft.dependsOn.length === 0) {
    return null;
  }
  
  const lines: string[] = [];
  
  lines.push('## Dependencies');
  lines.push('');
  
  draft.dependsOn.forEach(dep => {
    lines.push(`- ${dep}`);
  });
  
  return lines.join('\n');
}

/**
 * Section 6: Guards (environment restrictions)
 */
function renderGuardsSection(draft: IssueDraft): string {
  const lines: string[] = [];
  
  lines.push('## Guards');
  lines.push('');
  lines.push(`**Environment:** ${draft.guards.env}`);
  lines.push(`**Production Blocked:** ${draft.guards.prodBlocked ? 'Yes' : 'No'}`);
  
  return lines.join('\n');
}

/**
 * Section 7: KPI (optional)
 */
function renderKPISection(draft: IssueDraft): string | null {
  if (!draft.kpi) {
    return null;
  }
  
  const lines: string[] = [];
  
  lines.push('## KPI');
  lines.push('');
  
  if (draft.kpi.dcu !== undefined) {
    lines.push(`**DCU:** ${draft.kpi.dcu}`);
  }
  
  if (draft.kpi.intent) {
    lines.push(`**Intent:** ${draft.kpi.intent}`);
  }
  
  return lines.join('\n');
}

/**
 * Generate labels for a new issue from IssueDraft
 * 
 * Uses the labels array from the draft, ensuring they are deduplicated
 * and sorted (already done by normalizeIssueDraft).
 * 
 * @param draft - IssueDraft
 * @returns Array of label names
 */
export function generateLabelsForIssueDraft(draft: IssueDraft): string[] {
  return [...draft.labels]; // Already normalized (deduped and sorted)
}

/**
 * Merge existing labels with IssueDraft labels for update
 * 
 * Rules:
 * - Keep all labels from IssueDraft
 * - Keep existing labels that are NOT in the managed set
 * - Stable sort (lexicographic)
 * 
 * @param existingLabels - Current labels on the GitHub issue
 * @param draft - IssueDraft with new labels
 * @returns Merged and sorted label array
 */
export function mergeLabelsForIssueDraftUpdate(
  existingLabels: string[],
  draft: IssueDraft
): string[] {
  // Get managed labels from draft (already normalized)
  const draftLabels = new Set(draft.labels);
  
  // Keep existing labels that might have been added manually
  // (e.g., status labels, workflow labels)
  const preservedLabels = existingLabels.filter(label => {
    // Common managed label prefixes
    const managedPrefixes = ['v0.', 'epic:', 'layer:', 'P0', 'P1', 'P2'];
    const isManaged = managedPrefixes.some(prefix => label.startsWith(prefix));
    
    // If it's a managed label and not in draft, remove it
    // If it's not managed, preserve it
    return !isManaged || draftLabels.has(label);
  });
  
  // Merge draft labels with preserved labels
  const allLabels = new Set([...draft.labels, ...preservedLabels]);
  
  // Return as sorted array
  return Array.from(allLabels).sort((a, b) => a.localeCompare(b));
}
