/**
 * API Route: Self-Propel Issue
 * 
 * POST /api/issues/[issueNumber]/self-propel
 * 
 * Triggers the self-propelling workflow for an issue, automatically
 * transitioning it through all states from CREATED to DONE.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowEngine } from '../../../../../src/lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from '../../../../../src/lib/types/workflow';
import * as fs from 'fs';
import * as path from 'path';

const SELF_PROPELLING_WORKFLOW_PATH = path.join(
  process.cwd(),
  'runtime',
  'workflows',
  'self_propelling_issue.json'
);

export async function POST(
  request: NextRequest,
  { params }: { params: { issueNumber: string } }
) {
  try {
    const selfPropellingEnabled = process.env.AFU9_ENABLE_SELF_PROPELLING === 'true';
    if (!selfPropellingEnabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { issueNumber } = params;
    const body = await request.json();
    const { owner, repo, baseBranch = 'main' } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing required fields: owner, repo' },
        { status: 400 }
      );
    }

    const issueNum = parseInt(issueNumber, 10);
    if (isNaN(issueNum)) {
      return NextResponse.json(
        { error: 'Invalid issue number' },
        { status: 400 }
      );
    }

    console.log('[API] Starting self-propelling workflow', {
      owner,
      repo,
      issueNumber: issueNum,
      baseBranch,
    });

    // Load workflow definition from explicit runtime artifact path
    if (!fs.existsSync(SELF_PROPELLING_WORKFLOW_PATH)) {
      return NextResponse.json(
        {
          error: 'Self-propelling workflow artifact missing at runtime',
          path: SELF_PROPELLING_WORKFLOW_PATH,
        },
        { status: 500 }
      );
    }

    const workflowContent = fs.readFileSync(SELF_PROPELLING_WORKFLOW_PATH, 'utf-8');
    const selfPropellingWorkflow = JSON.parse(workflowContent) as WorkflowDefinition;

    // Create workflow context
    const context: WorkflowContext = {
      variables: {},
      input: {
        owner,
        repo,
        issue_number: issueNum,
        base_branch: baseBranch,
      },
      repo: {
        owner,
        name: repo,
        default_branch: baseBranch,
      },
      issue: {
        number: issueNum,
      },
    };

    // Execute the self-propelling workflow
    const engine = getWorkflowEngine();
    const result = await engine.execute(
      selfPropellingWorkflow as WorkflowDefinition,
      context
    );

    console.log('[API] Self-propelling workflow completed', {
      executionId: result.executionId,
      status: result.status,
      durationMs: result.metadata.durationMs,
      stepsCompleted: result.metadata.stepsCompleted,
      stepsTotal: result.metadata.stepsTotal,
    });

    return NextResponse.json({
      success: true,
      executionId: result.executionId,
      status: result.status,
      issueNumber: issueNum,
      stepsCompleted: result.metadata.stepsCompleted,
      stepsTotal: result.metadata.stepsTotal,
      durationMs: result.metadata.durationMs,
      message: 'Self-propelling workflow executed successfully',
    });
  } catch (error) {
    console.error('[API] Error in self-propelling workflow:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to execute self-propelling workflow',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
