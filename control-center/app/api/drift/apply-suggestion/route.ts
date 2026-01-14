/**
 * API Route: Apply Drift Repair Suggestion
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * POST /api/drift/apply-suggestion
 * 
 * Applies a drift repair suggestion with explicit user confirmation.
 * 
 * Guards:
 * - ❌ No Auto-Repair
 * - ✅ Explicit user confirmation required
 * - ✅ All actions audited
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { Octokit } from 'octokit';
import {
  getDriftDetectionById,
  recordDriftResolution,
} from '@/lib/db/driftDetection';
import { updateAfu9Issue } from '@/lib/db/afu9Issues';
import { RepairDirection, RepairAction } from '@/lib/contracts/drift';
import { getPool } from '@/lib/db';
import { getOctokit } from '@/lib/github';

export const dynamic = 'force-dynamic';

/**
 * POST /api/drift/apply-suggestion
 * 
 * Apply a drift repair suggestion
 * 
 * Body:
 * {
 *   drift_detection_id: string,
 *   suggestion_id: string,
 *   applied_by: string,
 *   confirmation: boolean  // MUST be true
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const {
      drift_detection_id,
      suggestion_id,
      applied_by,
      confirmation,
    } = body;

    // Validate required fields
    if (!drift_detection_id || !suggestion_id || !applied_by) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: drift_detection_id, suggestion_id, applied_by',
        },
        { status: 400 }
      );
    }

    // Validate explicit confirmation
    if (confirmation !== true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Explicit user confirmation required (confirmation: true)',
        },
        { status: 400 }
      );
    }

    const pool = getPool();
    const octokit = getOctokit();

    // Get drift detection
    const detectionResult = await getDriftDetectionById(pool, drift_detection_id);
    if (!detectionResult.success || !detectionResult.data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Drift detection not found',
        },
        { status: 404 }
      );
    }

    const detection = detectionResult.data;

    // Find the suggestion
    const suggestions = Array.isArray(detection.suggestions) 
      ? detection.suggestions 
      : [];
    
    const suggestion = suggestions.find((s: any) => s.id === suggestion_id);
    if (!suggestion) {
      return NextResponse.json(
        {
          success: false,
          error: 'Suggestion not found in drift detection',
        },
        { status: 404 }
      );
    }

    // Apply actions based on suggestion direction
    const appliedActions: RepairAction[] = [];
    const auditTrail: Record<string, unknown> = {
      detection_id: drift_detection_id,
      suggestion_id,
      suggestion_description: suggestion.description,
      applied_by,
      applied_at: new Date().toISOString(),
      before_state: {},
      after_state: {},
    };

    let success = true;
    let message = '';

    try {
      for (const action of suggestion.actions) {
        switch (action.type) {
          case 'UPDATE_AFU9_STATUS':
            // Update AFU-9 issue status
            const updateResult = await updateAfu9Issue(pool, detection.issue_id, {
              status: action.new_value,
            });

            if (updateResult.success) {
              appliedActions.push(action);
              (auditTrail.before_state as any).afu9_status = action.current_value;
              (auditTrail.after_state as any).afu9_status = action.new_value;
            } else {
              throw new Error(`Failed to update AFU-9 status: ${updateResult.error}`);
            }
            break;

          case 'UPDATE_GITHUB_LABELS':
            // Update GitHub labels
            const labels = action.new_value?.split(', ') || [];
            
            await octokit.rest.issues.setLabels({
              owner: detection.github_owner,
              repo: detection.github_repo,
              issue_number: detection.github_issue_number,
              labels,
            });

            appliedActions.push(action);
            (auditTrail.before_state as any).github_labels = action.current_value;
            (auditTrail.after_state as any).github_labels = action.new_value;
            break;

          case 'UPDATE_GITHUB_STATE':
            // Update GitHub issue state (close/reopen)
            if (action.new_value === 'closed') {
              await octokit.rest.issues.update({
                owner: detection.github_owner,
                repo: detection.github_repo,
                issue_number: detection.github_issue_number,
                state: 'closed',
              });
            } else if (action.new_value === 'open') {
              await octokit.rest.issues.update({
                owner: detection.github_owner,
                repo: detection.github_repo,
                issue_number: detection.github_issue_number,
                state: 'open',
              });
            }

            appliedActions.push(action);
            (auditTrail.before_state as any).github_state = action.current_value;
            (auditTrail.after_state as any).github_state = action.new_value;
            break;

          case 'ADD_COMMENT':
            // Add comment to GitHub issue
            await octokit.rest.issues.createComment({
              owner: detection.github_owner,
              repo: detection.github_repo,
              issue_number: detection.github_issue_number,
              body: action.new_value || 'Drift repair applied by AFU-9',
            });

            appliedActions.push(action);
            break;

          case 'MANUAL_INTERVENTION':
            // Manual intervention - no action to apply
            message = 'Manual intervention required - no automatic action taken';
            break;

          default:
            console.warn(`Unknown action type: ${action.type}`);
        }
      }

      message = message || `Successfully applied ${appliedActions.length} actions`;
    } catch (error) {
      success = false;
      message = error instanceof Error ? error.message : 'Failed to apply suggestion';
      console.error('[drift/apply-suggestion] Error applying actions:', error);
    }

    // Record resolution in audit trail
    const resolutionResult = await recordDriftResolution(
      pool,
      {
        drift_detection_id,
        suggestion_id,
        applied_by,
        confirmation: true,
      },
      {
        success,
        message,
        actions_applied: appliedActions,
        audit_trail: auditTrail,
      }
    );

    if (!resolutionResult.success) {
      console.error('[drift/apply-suggestion] Failed to record resolution:', resolutionResult.error);
    }

    return NextResponse.json({
      success,
      data: {
        resolution_id: resolutionResult.data,
        actions_applied: appliedActions,
        message,
        audit_trail: auditTrail,
      },
    });
  } catch (error) {
    console.error('[drift/apply-suggestion] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
