/**
 * AFU9 Import Markdown Exporter for Issue Sets
 * 
 * Exports issue set items in AFU9 Import Markdown format.
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 */

import type { IssueDraft } from '../schemas/issueDraft';
import type { IntentIssueSetItem } from '../db/intentIssueSets';

export interface ExportOptions {
  /**
   * If true, includes items with invalid validation status in the export.
   * Default: false (excludes invalid items)
   */
  includeInvalid?: boolean;
}

/**
 * Convert a single issue draft to AFU9 Import Markdown format
 * 
 * @param draft - Issue draft
 * @returns Markdown string
 */
export function issueDraftToAFU9Markdown(draft: IssueDraft): string {
  const lines: string[] = [];
  
  // Header with canonical ID
  lines.push(`# ${draft.title}`);
  lines.push('');
  
  // Metadata section
  lines.push('## Metadata');
  lines.push('```json');
  lines.push(JSON.stringify({
    canonicalId: draft.canonicalId,
    type: draft.type,
    priority: draft.priority,
    labels: draft.labels,
    dependsOn: draft.dependsOn,
    guards: draft.guards,
    kpi: draft.kpi,
  }, null, 2));
  lines.push('```');
  lines.push('');
  
  // Body
  lines.push('## Description');
  lines.push(draft.body);
  lines.push('');
  
  // Acceptance Criteria
  lines.push('## Acceptance Criteria');
  draft.acceptanceCriteria.forEach((ac, i) => {
    lines.push(`${i + 1}. ${ac}`);
  });
  lines.push('');
  
  // Verification
  lines.push('## Verification');
  lines.push('**Commands:**');
  draft.verify.commands.forEach(cmd => {
    lines.push(`- \`${cmd}\``);
  });
  lines.push('');
  lines.push('**Expected:**');
  draft.verify.expected.forEach(exp => {
    lines.push(`- ${exp}`);
  });
  lines.push('');
  
  // Separator
  lines.push('---');
  lines.push('');
  
  return lines.join('\n');
}

/**
 * Export issue set items to AFU9 Import Markdown format
 * 
 * @param items - Issue set items
 * @param options - Export options
 * @returns Markdown string
 */
export function exportIssueSetToAFU9Markdown(
  items: IntentIssueSetItem[],
  options: ExportOptions = {}
): string {
  const { includeInvalid = false } = options;
  
  // Filter out invalid items unless explicitly requested
  const filteredItems = includeInvalid 
    ? items 
    : items.filter(item => item.last_validation_status === 'valid');
  
  // Sort by canonicalId for stable output
  const sortedItems = [...filteredItems].sort((a, b) => 
    a.canonical_id.localeCompare(b.canonical_id)
  );
  
  const lines: string[] = [];
  
  // Header
  lines.push('# AFU9 Issue Import');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total Items: ${sortedItems.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  // Export each item
  for (const item of sortedItems) {
    try {
      const draft = item.issue_json as IssueDraft;
      lines.push(issueDraftToAFU9Markdown(draft));
    } catch (error) {
      // If can't parse, include a placeholder
      lines.push(`# ERROR: Failed to export ${item.canonical_id}`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(item.issue_json, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

/**
 * Generate a summary of issue set validation status
 * 
 * @param items - Issue set items
 * @returns Summary object
 */
export function generateIssueSetSummary(items: IntentIssueSetItem[]) {
  const total = items.length;
  const validCount = items.filter(i => i.last_validation_status === 'valid').length;
  const invalidCount = items.filter(i => i.last_validation_status === 'invalid').length;
  const unknownCount = items.filter(i => i.last_validation_status === 'unknown').length;
  
  return {
    total,
    valid: validCount,
    invalid: invalidCount,
    unknown: unknownCount,
    allValid: total > 0 && validCount === total,
  };
}
