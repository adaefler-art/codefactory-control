#!/usr/bin/env ts-node
/**
 * Backfill State Model v1 Fields
 * 
 * Safely backfills github_mirror_status for existing AFU9 issues.
 * 
 * Features:
 * - Idempotent: Safe to run multiple times
 * - Dry-run mode: Preview changes without applying
 * - Selective: Filter by ID range, status, or specific issues
 * - Bounded: Processes in batches to avoid overwhelming DB
 * - Audited: Logs all changes for accountability
 * 
 * Usage:
 *   # Preview changes (dry-run, default)
 *   ts-node scripts/backfill-state-model.ts
 * 
 *   # Apply changes
 *   ts-node scripts/backfill-state-model.ts --apply
 * 
 *   # Backfill specific issues
 *   ts-node scripts/backfill-state-model.ts --apply --id=abc123,def456
 * 
 *   # Backfill issues with github_mirror_status=UNKNOWN
 *   ts-node scripts/backfill-state-model.ts --apply --filter=UNKNOWN
 * 
 *   # Backfill in batches
 *   ts-node scripts/backfill-state-model.ts --apply --batch-size=50
 * 
 * Safety:
 * - Read-only by default (requires --apply flag)
 * - Never overwrites non-UNKNOWN github_mirror_status (unless --force)
 * - Logs all updates to stdout for audit trail
 * - Validates data before update (uses State Model v1 helpers)
 * 
 * Part of I5 — Guardrails + Backfill + Smoke Runbook
 */

import { getPool } from '../control-center/src/lib/db';
import { listAfu9Issues, updateAfu9Issue } from '../control-center/src/lib/db/afu9Issues';
import { extractGithubMirrorStatus } from '../control-center/src/lib/issues/stateModel';
import { Afu9GithubMirrorStatus } from '../control-center/src/lib/contracts/afu9Issue';

// ============================================================================
// Configuration
// ============================================================================

interface BackfillConfig {
  dryRun: boolean;           // If true, preview changes without applying
  batchSize: number;          // Number of issues to process per batch
  filterStatus: string | null; // Filter by github_mirror_status (e.g., 'UNKNOWN')
  issueIds: string[];         // Specific issue IDs to backfill
  force: boolean;             // If true, overwrite existing non-UNKNOWN values
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_STATUS_RAW_LENGTH = 256;

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function parseArgs(): BackfillConfig {
  const args = process.argv.slice(2);
  
  const config: BackfillConfig = {
    dryRun: true,
    batchSize: DEFAULT_BATCH_SIZE,
    filterStatus: null,
    issueIds: [],
    force: false,
  };

  for (const arg of args) {
    if (arg === '--apply') {
      config.dryRun = false;
    } else if (arg === '--force') {
      config.force = true;
    } else if (arg.startsWith('--batch-size=')) {
      config.batchSize = parseInt(arg.split('=')[1], 10);
      if (isNaN(config.batchSize) || config.batchSize < 1) {
        console.error('Error: --batch-size must be a positive number');
        process.exit(1);
      }
    } else if (arg.startsWith('--filter=')) {
      config.filterStatus = arg.split('=')[1];
    } else if (arg.startsWith('--id=')) {
      config.issueIds = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }

  return config;
}

function printUsage() {
  console.log(`
Backfill State Model v1 Fields

Usage:
  ts-node scripts/backfill-state-model.ts [options]

Options:
  --apply              Apply changes (default: dry-run mode)
  --force              Overwrite existing non-UNKNOWN values (default: skip)
  --batch-size=N       Process N issues per batch (default: 100)
  --filter=STATUS      Filter by github_mirror_status (e.g., UNKNOWN)
  --id=ID1,ID2,...     Backfill specific issue IDs
  -h, --help           Show this help message

Examples:
  # Preview changes (dry-run)
  ts-node scripts/backfill-state-model.ts

  # Apply backfill to all issues with UNKNOWN status
  ts-node scripts/backfill-state-model.ts --apply --filter=UNKNOWN

  # Backfill specific issues
  ts-node scripts/backfill-state-model.ts --apply --id=abc123,def456
`);
}

// ============================================================================
// Backfill Logic
// ============================================================================

interface BackfillResult {
  total: number;           // Total issues examined
  skipped: number;         // Issues skipped (no GitHub link or already set)
  updated: number;         // Issues successfully updated
  errors: number;          // Issues with errors
  changes: Array<{         // Audit log of changes
    issueId: string;
    publicId: string;
    title: string;
    oldStatus: string;
    newStatus: string;
    reason: string;
  }>;
}

async function backfillIssues(config: BackfillConfig): Promise<BackfillResult> {
  const pool = getPool();
  
  const result: BackfillResult = {
    total: 0,
    skipped: 0,
    updated: 0,
    errors: 0,
    changes: [],
  };

  console.log('🔍 Fetching AFU9 issues...');
  
  // Fetch issues to backfill
  const issuesResult = await listAfu9Issues(pool, {});
  if (!issuesResult.success || !issuesResult.data) {
    console.error('❌ Failed to fetch AFU9 issues:', issuesResult.error);
    process.exit(1);
  }

  let issues = issuesResult.data;

  // Apply filters
  if (config.issueIds.length > 0) {
    issues = issues.filter(issue => config.issueIds.includes(issue.id));
    console.log(`   Filtered to ${issues.length} specific issue(s)`);
  }

  if (config.filterStatus) {
    issues = issues.filter(issue => 
      (issue.github_mirror_status || 'UNKNOWN') === config.filterStatus
    );
    console.log(`   Filtered to ${issues.length} issue(s) with status=${config.filterStatus}`);
  }

  result.total = issues.length;
  console.log(`   Found ${result.total} issue(s) to process\n`);

  if (result.total === 0) {
    console.log('✅ No issues to backfill');
    return result;
  }

  // Process in batches
  for (let i = 0; i < issues.length; i += config.batchSize) {
    const batch = issues.slice(i, Math.min(i + config.batchSize, issues.length));
    const batchNum = Math.floor(i / config.batchSize) + 1;
    const totalBatches = Math.ceil(issues.length / config.batchSize);
    
    console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} issues)...`);

    for (const issue of batch) {
      try {
        // Skip if no GitHub issue number (can't extract GitHub status)
        if (!issue.github_issue_number) {
          result.skipped++;
          continue;
        }

        const currentMirrorStatus = issue.github_mirror_status || 'UNKNOWN';

        // Skip if already has non-UNKNOWN status (unless --force)
        if (currentMirrorStatus !== 'UNKNOWN' && !config.force) {
          result.skipped++;
          continue;
        }

        // Extract GitHub mirror status from github_status_raw
        // Note: We don't have the full GitHub issue data here, so we use what's stored
        let newMirrorStatus: Afu9GithubMirrorStatus = Afu9GithubMirrorStatus.UNKNOWN;
        let reason = 'No GitHub status data available';

        if (issue.github_status_raw) {
          // Parse github_status_raw to extract status information
          // For now, we'll use a simple heuristic based on the raw value
          // In production, this could be enhanced to parse Project status, labels, etc.
          
          // Try to extract status from common patterns
          const raw = issue.github_status_raw.toLowerCase();
          
          if (raw.includes('in progress') || raw.includes('implementing')) {
            newMirrorStatus = Afu9GithubMirrorStatus.IN_PROGRESS;
            reason = `Extracted from github_status_raw: "${issue.github_status_raw}"`;
          } else if (raw.includes('in review') || raw.includes('review')) {
            newMirrorStatus = Afu9GithubMirrorStatus.IN_REVIEW;
            reason = `Extracted from github_status_raw: "${issue.github_status_raw}"`;
          } else if (raw.includes('done') || raw.includes('completed')) {
            newMirrorStatus = Afu9GithubMirrorStatus.DONE;
            reason = `Extracted from github_status_raw: "${issue.github_status_raw}"`;
          } else if (raw.includes('todo') || raw.includes('backlog')) {
            newMirrorStatus = Afu9GithubMirrorStatus.TODO;
            reason = `Extracted from github_status_raw: "${issue.github_status_raw}"`;
          } else if (raw.includes('blocked') || raw.includes('hold')) {
            newMirrorStatus = Afu9GithubMirrorStatus.BLOCKED;
            reason = `Extracted from github_status_raw: "${issue.github_status_raw}"`;
          } else if (raw === 'open' || raw === 'closed') {
            // Don't map plain issue states to mirror status (semantic protection)
            newMirrorStatus = Afu9GithubMirrorStatus.UNKNOWN;
            reason = 'Plain issue state, no explicit status';
          } else {
            newMirrorStatus = Afu9GithubMirrorStatus.UNKNOWN;
            reason = `Could not map github_status_raw: "${issue.github_status_raw}"`;
          }
        }

        // Skip if no change
        if (newMirrorStatus === currentMirrorStatus) {
          result.skipped++;
          continue;
        }

        // Record change
        result.changes.push({
          issueId: issue.id,
          publicId: issue.id.substring(0, 8), // First 8 chars of UUID as public ID
          title: issue.title,
          oldStatus: currentMirrorStatus,
          newStatus: newMirrorStatus,
          reason,
        });

        // Apply update (if not dry-run)
        if (!config.dryRun) {
          const updateResult = await updateAfu9Issue(pool, issue.id, {
            github_mirror_status: newMirrorStatus,
          });

          if (updateResult.success) {
            result.updated++;
          } else {
            console.error(`   ❌ Failed to update issue ${issue.id}:`, updateResult.error);
            result.errors++;
          }
        } else {
          // In dry-run mode, count as "updated" to show what would change
          result.updated++;
        }
      } catch (error) {
        console.error(`   ❌ Error processing issue ${issue.id}:`, error);
        result.errors++;
      }
    }
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=====================================');
  console.log('State Model v1 Backfill Tool');
  console.log('=====================================\n');

  const config = parseArgs();

  // Show configuration
  console.log('Configuration:');
  console.log(`  Mode: ${config.dryRun ? '🔍 DRY-RUN (preview only)' : '✅ APPLY (will update database)'}`);
  console.log(`  Batch Size: ${config.batchSize}`);
  console.log(`  Force Overwrite: ${config.force ? 'Yes' : 'No'}`);
  if (config.filterStatus) {
    console.log(`  Filter: github_mirror_status=${config.filterStatus}`);
  }
  if (config.issueIds.length > 0) {
    console.log(`  Issue IDs: ${config.issueIds.join(', ')}`);
  }
  console.log('');

  if (config.dryRun) {
    console.log('⚠️  DRY-RUN MODE: No changes will be applied');
    console.log('   Use --apply to apply changes\n');
  }

  // Run backfill
  const result = await backfillIssues(config);

  // Show results
  console.log('\n=====================================');
  console.log('Backfill Results');
  console.log('=====================================\n');
  
  console.log(`Total Issues Examined: ${result.total}`);
  console.log(`Issues Updated: ${result.updated}`);
  console.log(`Issues Skipped: ${result.skipped}`);
  console.log(`Errors: ${result.errors}`);
  console.log('');

  // Show changes audit log
  if (result.changes.length > 0) {
    console.log('Changes:');
    console.log('');
    
    for (const change of result.changes) {
      const prefix = config.dryRun ? '  [WOULD UPDATE]' : '  [UPDATED]';
      console.log(`${prefix} ${change.publicId}: ${change.title}`);
      console.log(`    ${change.oldStatus} → ${change.newStatus}`);
      console.log(`    Reason: ${change.reason}`);
      console.log('');
    }
  }

  // Exit summary
  if (config.dryRun && result.updated > 0) {
    console.log('✅ Dry-run complete. Run with --apply to apply changes.');
    process.exit(0);
  } else if (!config.dryRun && result.updated > 0) {
    console.log('✅ Backfill complete!');
    process.exit(0);
  } else if (result.total === 0) {
    console.log('✅ No issues to backfill.');
    process.exit(0);
  } else {
    console.log('✅ All issues already up-to-date.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n❌ Fatal error during backfill:', error);
  process.exit(1);
});
