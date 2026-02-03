/**
 * GitHub Issue Renderer for AFU-9 CR → Issue Flow (I752 / E75.2)
 * 
 * Deterministic markdown template for rendering CR JSON as GitHub issue body.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic rendering (same CR → same markdown)
 * - Include canonical ID marker in body
 * - Include all governance metadata
 * - Evidence refs only (no full content)
 * - Stable section ordering
 */

import type { ChangeRequest } from '../schemas/changeRequest';
import type { SourceRef } from '../schemas/usedSources';
import { generateBodyWithMarker } from './canonical-id-resolver';
import { createHash } from 'crypto';

/**
 * Rendered issue result
 */
export interface RenderedIssue {
  /** Full title with canonical ID marker */
  title: string;
  /** Markdown body with all sections */
  body: string;
  /** Hash of rendered body (for tracking changes) */
  renderedHash: string;
}

/**
 * Options for rendering
 */
export interface RenderOptions {
  /** Include optional sections even if empty */
  includeOptional?: boolean;
}

/**
 * Compute SHA-256 hash of content
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Render a CR as a GitHub issue
 * 
 * Generates deterministic title and body markdown with all required sections.
 * 
 * @param cr - Change Request to render
 * @param options - Rendering options
 * @returns Rendered issue with title and body
 */
export function renderCRAsIssue(cr: ChangeRequest, options?: RenderOptions): RenderedIssue {
  // 1. Generate title with canonical ID marker
  const title = generateTitle(cr);
  
  // 2. Generate body sections (without canonical marker - will be added below)
  const bodySections = [
    renderCRVersionSection(cr),
    renderMotivationSection(cr),
    renderScopeSection(cr),
    renderPlannedChangesSection(cr),
    renderAcceptanceCriteriaSection(cr),
    renderTestsSection(cr),
    renderRisksSection(cr),
    renderRolloutSection(cr),
    renderEvidenceSection(cr),
    renderGovernanceSection(cr),
    renderMetaSection(cr),
  ];
  
  const bodyContent = bodySections.join('\n\n---\n\n');
  
  // 3. Add canonical ID marker at the start of body
  const body = generateBodyWithMarker(cr.canonicalId, bodyContent);
  
  // 4. Compute hash of rendered body (for change detection)
  const renderedHash = computeHash(body);
  
  return {
    title,
    body,
    renderedHash,
  };
}

/**
 * Generate title with canonical ID marker
 * Format: [CID:<canonicalId>] <title>
 */
function generateTitle(cr: ChangeRequest): string {
  return `[CID:${cr.canonicalId}] ${cr.title}`;
}

/**
 * Section 1: CR Version/Hash
 */
function renderCRVersionSection(cr: ChangeRequest): string {
  const lines = [
    `**CR-Version:** ${cr.crVersion}`,
  ];
  
  return lines.join('\n');
}

/**
 * Section 2: Motivation
 */
function renderMotivationSection(cr: ChangeRequest): string {
  return `## Motivation\n\n${cr.motivation}`;
}

/**
 * Section 3: Scope
 */
function renderScopeSection(cr: ChangeRequest): string {
  const lines = [
    '## Scope',
    '',
    `**Summary:** ${cr.scope.summary}`,
    '',
    '**In Scope:**',
    ...cr.scope.inScope.map(item => `- ${item}`),
    '',
    '**Out of Scope:**',
    ...cr.scope.outOfScope.map(item => `- ${item}`),
  ];
  
  return lines.join('\n');
}

/**
 * Section 4: Planned Changes
 */
function renderPlannedChangesSection(cr: ChangeRequest): string {
  const lines = [
    '## Planned Changes',
    '',
    '### Files',
  ];
  
  if (cr.changes.files.length === 0) {
    lines.push('- *No file changes*');
  } else {
    for (const file of cr.changes.files) {
      const rationale = file.rationale ? ` - ${file.rationale}` : '';
      lines.push(`- **${file.changeType}**: \`${file.path}\`${rationale}`);
    }
  }
  
  // API changes (optional)
  if (cr.changes.api && cr.changes.api.length > 0) {
    lines.push('', '### API Changes');
    for (const api of cr.changes.api) {
      const notes = api.notes ? ` - ${api.notes}` : '';
      lines.push(`- **${api.changeType}**: ${api.method} \`${api.route}\`${notes}`);
    }
  }
  
  // DB changes (optional)
  if (cr.changes.db && cr.changes.db.length > 0) {
    lines.push('', '### Database Changes');
    for (const db of cr.changes.db) {
      const migration = db.migration ? ` (\`${db.migration}\`)` : '';
      const notes = db.notes ? ` - ${db.notes}` : '';
      lines.push(`- **${db.changeType}**${migration}${notes}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Section 5: Acceptance Criteria
 */
function renderAcceptanceCriteriaSection(cr: ChangeRequest): string {
  const lines = [
    '## Acceptance Criteria',
    '',
    ...cr.acceptanceCriteria.map((ac, index) => `${index + 1}. ${ac}`),
  ];
  
  return lines.join('\n');
}

/**
 * Section 6: Tests
 */
function renderTestsSection(cr: ChangeRequest): string {
  const lines = [
    '## Tests',
    '',
    '### Required Tests',
    ...cr.tests.required.map(test => `- ${test}`),
  ];
  
  if (cr.tests.addedOrUpdated && cr.tests.addedOrUpdated.length > 0) {
    lines.push('', '### Tests Added/Updated');
    lines.push(...cr.tests.addedOrUpdated.map(test => `- ${test}`));
  }
  
  if (cr.tests.manual && cr.tests.manual.length > 0) {
    lines.push('', '### Manual Tests');
    lines.push(...cr.tests.manual.map(test => `- ${test}`));
  }
  
  return lines.join('\n');
}

/**
 * Section 7: Risks
 */
function renderRisksSection(cr: ChangeRequest): string {
  const lines = [
    '## Risks',
    '',
  ];
  
  if (cr.risks.items.length === 0) {
    lines.push('*No risks identified*');
  } else {
    for (const risk of cr.risks.items) {
      lines.push(`### ${risk.risk}`);
      lines.push(`- **Impact:** ${risk.impact}`);
      lines.push(`- **Mitigation:** ${risk.mitigation}`);
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Section 8: Rollout + Rollback
 */
function renderRolloutSection(cr: ChangeRequest): string {
  const lines = [
    '## Rollout + Rollback',
    '',
    '### Rollout Steps',
    ...cr.rollout.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '### Rollback Plan',
    cr.rollout.rollbackPlan,
  ];
  
  if (cr.rollout.featureFlags && cr.rollout.featureFlags.length > 0) {
    lines.push('', '### Feature Flags');
    lines.push(...cr.rollout.featureFlags.map(flag => `- \`${flag}\``));
  }
  
  return lines.join('\n');
}

/**
 * Section 9: Evidence
 * Compact refs only - no full content
 */
function renderEvidenceSection(cr: ChangeRequest): string {
  const lines = [
    '## Evidence',
    '',
  ];
  
  if (cr.evidence.length === 0) {
    lines.push('*No evidence provided*');
    return lines.join('\n');
  }
  
  // Group evidence by kind for better readability
  const byKind = new Map<string, typeof cr.evidence>();
  
  for (const ev of cr.evidence) {
    const kind = ev.kind;
    if (!byKind.has(kind)) {
      byKind.set(kind, []);
    }
    byKind.get(kind)!.push(ev);
  }
  
  // Render each kind group
  for (const [kind, items] of byKind) {
    lines.push(`### ${formatKindName(kind)}`);
    lines.push('');
    
    for (const ev of items) {
      lines.push(renderEvidenceItem(ev));
    }
    
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Format evidence kind name for display
 */
function formatKindName(kind: string): string {
  const mapping: Record<string, string> = {
    'file_snippet': 'File Snippets',
    'github_issue': 'GitHub Issues',
    'github_pr': 'GitHub Pull Requests',
    'afu9_artifact': 'AFU-9 Artifacts',
  };
  
  return mapping[kind] || kind;
}

/**
 * Render a single evidence item as compact reference
 */
function renderEvidenceItem(ev: SourceRef): string {
  switch (ev.kind) {
    case 'file_snippet':
      return `- **File:** \`${ev.repo.owner}/${ev.repo.repo}\` @ \`${ev.branch}\` - \`${ev.path}\` (lines ${ev.startLine}-${ev.endLine}) ${ev.snippetHash ? `[hash: \`${ev.snippetHash.substring(0, 12)}...\`]` : ''}`;
    
    case 'github_issue':
      return `- **Issue:** [#${ev.number}](https://github.com/${ev.repo.owner}/${ev.repo.repo}/issues/${ev.number}) - ${ev.title || 'Untitled'}`;
    
    case 'github_pr':
      return `- **PR:** [#${ev.number}](https://github.com/${ev.repo.owner}/${ev.repo.repo}/pull/${ev.number}) - ${ev.title || 'Untitled'}`;
    
    case 'afu9_artifact':
      return `- **Artifact:** \`${ev.artifactType}\` - ID: \`${ev.artifactId}\` ${ev.ref?.description ? `- ${ev.ref.description}` : ''}`;
    
    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustiveCheck: never = ev;
      return `- **${(ev as SourceRef).kind}:** ${JSON.stringify(ev)}`;
  }
}

/**
 * Section 10: Governance
 */
function renderGovernanceSection(cr: ChangeRequest): string {
  const lines = [
    '## Governance',
    '',
  ];
  
  if (cr.constraints.lawbookVersion) {
    lines.push(`**Lawbook Version:** ${cr.constraints.lawbookVersion}`);
  } else {
    lines.push('**Lawbook Version:** *Not specified*');
  }
  
  if (cr.constraints.determinismNotes && cr.constraints.determinismNotes.length > 0) {
    lines.push('', '**Determinism Notes:**');
    lines.push(...cr.constraints.determinismNotes.map(note => `- ${note}`));
  }
  
  if (cr.constraints.idempotencyNotes && cr.constraints.idempotencyNotes.length > 0) {
    lines.push('', '**Idempotency Notes:**');
    lines.push(...cr.constraints.idempotencyNotes.map(note => `- ${note}`));
  }
  
  return lines.join('\n');
}

/**
 * Section 11: Meta
 */
function renderMetaSection(cr: ChangeRequest): string {
  const generatedAt = cr.metadata.createdAt || 'unknown';
  const lines = [
    '## Meta',
    '',
    `**Generated At:** ${generatedAt}`,
    `**Generated By:** ${cr.metadata.createdBy.toUpperCase()}`,
    `**CR Version:** ${cr.crVersion}`,
    `**Canonical ID:** ${cr.canonicalId}`,
  ];
  
  if (cr.metadata.tags && cr.metadata.tags.length > 0) {
    lines.push(`**Tags:** ${cr.metadata.tags.join(', ')}`);
  }
  
  if (cr.metadata.kpiTargets && cr.metadata.kpiTargets.length > 0) {
    lines.push(`**KPI Targets:** ${cr.metadata.kpiTargets.join(', ')}`);
  }
  
  return lines.join('\n');
}

/**
 * Required AFU-9 labels for issues
 */
export const REQUIRED_AFU9_LABELS = [
  'afu9',
  'v0.7',
] as const;

/**
 * Initial state label for new issues
 */
export const INITIAL_STATE_LABEL = 'state:CREATED' as const;

/**
 * Generate complete label set for a new issue
 * 
 * @param cr - Change Request
 * @returns Array of label names
 */
export function generateLabelsForNewIssue(cr: ChangeRequest): string[] {
  const labels = new Set<string>();
  
  // Required AFU-9 labels
  labels.add('afu9');
  labels.add('v0.7');
  
  // Initial state
  labels.add(INITIAL_STATE_LABEL);
  
  // KPI labels
  if (cr.metadata.kpiTargets) {
    for (const kpi of cr.metadata.kpiTargets) {
      labels.add(`kpi:${kpi}`);
    }
  }
  
  // Tags as labels (if appropriate)
  if (cr.metadata.tags) {
    for (const tag of cr.metadata.tags) {
      // Only add tags that look like labels (alphanumeric + hyphens)
      if (/^[a-zA-Z0-9-]+$/.test(tag)) {
        labels.add(tag);
      }
    }
  }
  
  return Array.from(labels).sort(); // Deterministic ordering
}

/**
 * Merge labels for existing issue update
 * 
 * Strategy:
 * - Keep all existing non-AFU labels
 * - Ensure required AFU labels are present
 * - Don't change state labels (preserve manual state transitions)
 * - Add KPI labels from CR if not present
 * 
 * @param existingLabels - Current labels on issue
 * @param cr - Change Request
 * @returns Merged label set
 */
export function mergeLabelsForUpdate(existingLabels: string[], cr: ChangeRequest): string[] {
  const labels = new Set<string>(existingLabels);
  
  // Ensure required AFU-9 labels
  labels.add('afu9');
  labels.add('v0.7');
  
  // Add KPI labels from CR (don't remove existing)
  if (cr.metadata.kpiTargets) {
    for (const kpi of cr.metadata.kpiTargets) {
      labels.add(`kpi:${kpi}`);
    }
  }
  
  // Note: We do NOT add tags on update (only on create)
  // Note: We do NOT change state labels (preserve manual transitions)
  
  return Array.from(labels).sort(); // Deterministic ordering
}
