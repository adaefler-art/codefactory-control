/**
 * API Route: /api/github/issues/[issueNumber]/assign-copilot
 * 
 * E83.2: Tool `assign_copilot_to_issue` (+ audit)
 * 
 * Goal: Start work with minimal clicks; deterministic assignment.
 * 
 * API: POST /api/github/issues/{issueNumber}/assign-copilot
 * Input: { owner, repo, issueNumber, requestId? }
 * Output: { status: "ASSIGNED"|"NOOP", assignees: string[], requestId, lawbookHash }
 * 
 * Idempotency:
 * - Key: (owner, repo, issueNumber) + desired assignee copilot (or configured)
 * - If already assigned → NOOP
 * 
 * Policy:
 * - Must pass E83.1 registry: allowedActions contains assign_issue or assign_copilot.
 * - Allowed assignee is fixed/configured; no arbitrary usernames.
 * 
 * Audit ledger:
 * - Append-only row: requestId, actor, action, targetIssue, result, timestamp, lawbookHash
 * 
 * Acceptance Criteria:
 * - Works on staging against a real issue
 * - Negative cases:
 *   - prod blocked (409)
 *   - repo not in registry (403/404)
 *   - issue not found (404)
 * - Tests: idempotent NOOP, forbidden repo
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPool } from '../../../../../../src/lib/db';
import { createAuthenticatedClient } from '../../../../../../src/lib/github/auth-wrapper';
import { getRepoActionsRegistryService } from '../../../../../../src/lib/repo-actions-registry-service';
import { getActiveLawbook } from '../../../../../../src/lib/db/lawbook';
import { withApi } from '../../../../../../src/lib/http/withApi';
import { getProdDisabledReason, isProdEnabled } from '../../../../../../src/lib/utils/prod-control';
import { recordAssignTouchpoint } from '../../../../../../src/lib/touchpoints/manual-touchpoints';

// ========================================
// Types
// ========================================

interface AssignCopilotRequest {
  owner: string;
  repo: string;
  issueNumber: number;
  requestId?: string;
}

interface AssignCopilotResponse {
  status: 'ASSIGNED' | 'NOOP';
  assignees: string[];
  requestId: string;
  lawbookHash: string;
}

// ========================================
// Configuration
// ========================================

/**
 * Fixed assignee for Copilot assignments
 * This is configured, not arbitrary from user input
 */
const COPILOT_ASSIGNEE = process.env.GITHUB_COPILOT_USERNAME || 'copilot';

// ========================================
// Helper Functions
// ========================================

/**
 * Detect environment from request or environment variables
 */
function detectEnvironment(request: NextRequest): 'production' | 'staging' | 'development' {
  // Check NODE_ENV first
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    return 'production';
  }
  if (nodeEnv === 'development') {
    return 'development';
  }

  // Check hostname patterns
  const hostname = request.headers.get('host') || '';
  if (hostname.includes('.afu9.cloud') && !hostname.includes('stage')) {
    return 'production';
  }
  if (hostname.includes('stage.afu9.cloud') || hostname.includes('staging')) {
    return 'staging';
  }

  // Default to staging for safety
  return 'staging';
}

/**
 * Log assignment action to audit trail
 */
async function logAssignmentAudit(
  pool: any,
  params: {
    registryId: string;
    registryVersion: string;
    repository: string;
    issueNumber: number;
    status: 'ASSIGNED' | 'NOOP';
    assignees: string[];
    requestId: string;
    lawbookHash: string;
    executedBy: string;
  }
): Promise<void> {
  const {
    registryId,
    registryVersion,
    repository,
    issueNumber,
    status,
    assignees,
    requestId,
    lawbookHash,
    executedBy,
  } = params;

  const validationResult = {
    allowed: true,
    actionType: 'assign_issue',
    preconditionsMet: true,
    missingPreconditions: [],
    approvalRequired: false,
    approvalMet: true,
    errors: [],
    warnings: [],
  };

  await pool.query(
    `INSERT INTO registry_action_audit (
      registry_id,
      registry_version,
      action_type,
      action_status,
      repository,
      resource_type,
      resource_number,
      validation_result,
      executed_by,
      evidence_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      registryId,
      registryVersion,
      'assign_issue',
      status === 'ASSIGNED' ? 'allowed' : 'allowed', // Both are allowed, just NOOP if already assigned
      repository,
      'issue',
      issueNumber,
      JSON.stringify(validationResult),
      executedBy,
      requestId, // Using requestId as evidence_id for tracking
    ]
  );

  console.log('[AssignCopilot] Audit logged', {
    requestId,
    repository,
    issueNumber,
    status,
    lawbookHash,
  });
}

// ========================================
// API Route Handler
// ========================================

/**
 * POST /api/github/issues/[issueNumber]/assign-copilot
 * 
 * Assigns GitHub Copilot (or configured user) to a GitHub issue
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ issueNumber: string }> }
) => {
  const pool = getPool();
  const { issueNumber: issueNumberParam } = await params;

  // Parse and validate request body
  let body: Partial<AssignCopilotRequest>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: 'Request body must be valid JSON',
      },
      { status: 400 }
    );
  }

  // Validate required fields
  const { owner, repo } = body;
  if (!owner || !repo) {
    return NextResponse.json(
      {
        error: 'Missing required fields',
        details: 'owner and repo are required',
      },
      { status: 400 }
    );
  }

  // Parse issue number
  const issueNumber = parseInt(issueNumberParam, 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    return NextResponse.json(
      {
        error: 'Invalid issue number',
        details: 'Issue number must be a positive integer',
      },
      { status: 400 }
    );
  }

  // Generate or use provided requestId
  const requestId = body.requestId || randomUUID();

  // Detect environment
  const environment = detectEnvironment(request);

  // E83.2 Acceptance: prod blocked (409)
  if (environment === 'production' && !isProdEnabled()) {
    return NextResponse.json(
      {
        error: 'Production environment blocked',
        details: getProdDisabledReason(),
        environment,
      },
      { status: 409 }
    );
  }

  try {
    // Get active lawbook for lawbookHash
    const lawbookResult = await getActiveLawbook('AFU9-LAWBOOK', pool);
    if (!lawbookResult.success || !lawbookResult.data) {
      return NextResponse.json(
        {
          error: 'No active lawbook found',
          details: 'System is not configured with an active lawbook',
        },
        { status: 500 }
      );
    }
    const lawbookHash = lawbookResult.data.lawbook_hash;

    // Get repository actions registry service
    const registryService = getRepoActionsRegistryService();
    const repository = `${owner}/${repo}`;

    // Get active registry for the repository
    const registry = await registryService.getActiveRegistry(repository);

    // E83.2 Acceptance: repo not in registry (403/404)
    if (!registry) {
      return NextResponse.json(
        {
          error: 'Repository not found in registry',
          details: `No active registry found for repository ${repository}`,
          repository,
        },
        { status: 404 }
      );
    }

    // Validate action against registry (E83.1 policy)
    // Try both 'assign_copilot' (specific) and 'assign_issue' (generic)
    let validationResult = await registryService.validateAction(
      repository,
      'assign_copilot',
      {
        resourceType: 'issue',
        resourceNumber: issueNumber,
      }
    );

    // Fallback to generic 'assign_issue' if 'assign_copilot' not in registry
    if (!validationResult.allowed && validationResult.errors.some(e => e.includes('not found in registry'))) {
      validationResult = await registryService.validateAction(
        repository,
        'assign_issue',
        {
          resourceType: 'issue',
          resourceNumber: issueNumber,
        }
      );
    }

    if (!validationResult.allowed) {
      return NextResponse.json(
        {
          error: 'Action not allowed by registry',
          details: validationResult.errors.join('; '),
          repository,
          actionType: validationResult.actionType,
          validationErrors: validationResult.errors,
        },
        { status: 403 }
      );
    }

    // Create authenticated GitHub client
    let octokit;
    try {
      octokit = await createAuthenticatedClient({ owner, repo });
    } catch (error) {
      return NextResponse.json(
        {
          error: 'Failed to authenticate with GitHub',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }

    // Fetch current issue state
    let issue;
    try {
      const { data } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      issue = data;
    } catch (error: any) {
      // E83.2 Acceptance: issue not found (404)
      if (error.status === 404) {
        return NextResponse.json(
          {
            error: 'Issue not found',
            details: `Issue #${issueNumber} not found in ${repository}`,
            repository,
            issueNumber,
          },
          { status: 404 }
        );
      }
      throw error;
    }

    // Check if copilot is already assigned (idempotency)
    const currentAssignees = issue.assignees?.map((a: any) => a.login) || [];
    const isAlreadyAssigned = currentAssignees.includes(COPILOT_ASSIGNEE);

    let status: 'ASSIGNED' | 'NOOP';
    let assignees: string[];

    if (isAlreadyAssigned) {
      // E83.2 Idempotency: If already assigned → NOOP
      status = 'NOOP';
      assignees = currentAssignees;
      console.log('[AssignCopilot] Already assigned (NOOP)', {
        requestId,
        repository,
        issueNumber,
        assignee: COPILOT_ASSIGNEE,
      });
    } else {
      // Assign copilot to the issue
      try {
        const { data: updatedIssue } = await octokit.rest.issues.addAssignees({
          owner,
          repo,
          issue_number: issueNumber,
          assignees: [COPILOT_ASSIGNEE],
        });
        status = 'ASSIGNED';
        assignees = updatedIssue.assignees?.map((a: any) => a.login) || [];
        console.log('[AssignCopilot] Assigned successfully', {
          requestId,
          repository,
          issueNumber,
          assignee: COPILOT_ASSIGNEE,
        });
      } catch (error: any) {
        return NextResponse.json(
          {
            error: 'Failed to assign copilot',
            details: error instanceof Error ? error.message : String(error),
            repository,
            issueNumber,
            assignee: COPILOT_ASSIGNEE,
          },
          { status: 500 }
        );
      }
    }

    // E83.2 Audit ledger: Log the action
    await logAssignmentAudit(pool, {
      registryId: registry.registryId,
      registryVersion: registry.version,
      repository,
      issueNumber,
      status,
      assignees,
      requestId,
      lawbookHash,
      executedBy: 'api', // Could be extracted from auth if available
    });

    // E88.1: Record manual touchpoint (ASSIGN)
    // Only record if actually assigned (not NOOP)
    if (status === 'ASSIGNED') {
      await recordAssignTouchpoint(pool, {
        ghIssueNumber: issueNumber,
        actor: 'api', // Could be extracted from auth if available
        requestId,
        source: 'API',
        metadata: {
          repository,
          assignee: COPILOT_ASSIGNEE,
        },
      });
    }

    // Return success response
    const response: AssignCopilotResponse = {
      status,
      assignees,
      requestId,
      lawbookHash,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[AssignCopilot] Unexpected error', {
      error: error instanceof Error ? error.message : String(error),
      owner,
      repo,
      issueNumber,
      requestId,
    });
    throw error; // Let withApi handle it
  }
});
