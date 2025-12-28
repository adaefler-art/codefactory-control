/**
 * API Route: /api/import/backlog-file
 * 
 * Import epics and issues from a backlog file in the GitHub repository.
 * Issue E0.1 — Repo File Import UI + API (MVP)
 * 
 * POST:
 * - Input: { path: string, ref?: string }
 * - Fetches file from GitHub
 * - Parses into epics and issues
 * - Upserts to database with stable IDs
 * - Tracks import run
 * - Returns runId + counts + errors
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { fetchGitHubFile } from '../../../../src/lib/github/fetch-file';
import { parseBacklogFile, validateParseResult } from '../../../../src/lib/parsers/backlog-parser';
import { upsertAfu9Epic } from '../../../../src/lib/db/afu9Epics';
import { createImportRun, updateImportRun } from '../../../../src/lib/db/importRuns';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { Pool } from 'pg';

// Default repository configuration
const DEFAULT_OWNER = process.env.GITHUB_OWNER || 'adaefler-art';
const DEFAULT_REPO = process.env.GITHUB_REPO || 'codefactory-control';

interface ImportRequestBody {
  path: string;
  ref?: string;
  owner?: string;
  repo?: string;
}

/**
 * Upsert an issue with epic reference
 */
async function upsertIssueWithEpic(
  pool: Pool,
  issueData: {
    external_id: string;
    epic_id: string;
    title: string;
    body: string;
    labels: string[];
  }
): Promise<{ created: boolean; updated: boolean; skipped: boolean; error?: string }> {
  try {
    // Check if issue already exists
    const existingResult = await pool.query(
      'SELECT id, title, body, labels, epic_id FROM afu9_issues WHERE external_id = $1',
      [issueData.external_id]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      
      // Check if anything changed
      const titleChanged = existing.title !== issueData.title;
      const bodyChanged = existing.body !== issueData.body;
      const labelsChanged = JSON.stringify(existing.labels) !== JSON.stringify(issueData.labels);
      const epicChanged = existing.epic_id !== issueData.epic_id;
      
      if (!titleChanged && !bodyChanged && !labelsChanged && !epicChanged) {
        return { created: false, updated: false, skipped: true };
      }
      
      // Update the issue
      await pool.query(
        `UPDATE afu9_issues 
         SET title = $1, body = $2, labels = $3, epic_id = $4, updated_at = NOW()
         WHERE external_id = $5`,
        [issueData.title, issueData.body, issueData.labels, issueData.epic_id, issueData.external_id]
      );
      
      return { created: false, updated: true, skipped: false };
    }
    
    // Create new issue
    await pool.query(
      `INSERT INTO afu9_issues (external_id, epic_id, title, body, labels, status, source)
       VALUES ($1, $2, $3, $4, $5, 'CREATED', 'afu9')`,
      [issueData.external_id, issueData.epic_id, issueData.title, issueData.body, issueData.labels]
    );
    
    return { created: true, updated: false, skipped: false };
  } catch (error) {
    console.error('[upsertIssueWithEpic] Error:', error);
    return { 
      created: false, 
      updated: false, 
      skipped: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * POST /api/import/backlog-file
 * Import epics and issues from GitHub repository file
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();
    const body: ImportRequestBody = await request.json();

    // Validate input
    if (!body.path || typeof body.path !== 'string') {
      return errorResponse('Invalid input: path is required and must be a string', {
        status: 400,
        requestId,
      });
    }

    const path = body.path.trim();
    const ref = body.ref?.trim() || 'main';
    const owner = body.owner?.trim() || DEFAULT_OWNER;
    const repo = body.repo?.trim() || DEFAULT_REPO;

    if (!path) {
      return errorResponse('Invalid input: path cannot be empty', {
        status: 400,
        requestId,
      });
    }

    // Create import run
    const importRunResult = await createImportRun(pool, {
      source_type: 'github_file',
      source_path: path,
      source_ref: ref,
    });

    if (!importRunResult.success || !importRunResult.data) {
      return errorResponse('Failed to create import run', {
        status: 500,
        requestId,
        details: importRunResult.error,
      });
    }

    const runId = importRunResult.data.id;

    try {
      // Fetch file from GitHub
      const fileResult = await fetchGitHubFile({
        owner,
        repo,
        path,
        ref,
      });

      if (!fileResult.success || !fileResult.content) {
        // Update import run as failed
        await updateImportRun(pool, runId, {
          status: 'FAILED',
          errors_count: 1,
          errors: [{ message: fileResult.error || 'Failed to fetch file' }],
          completed_at: new Date().toISOString(),
        });

        return errorResponse(fileResult.error || 'Failed to fetch file from GitHub', {
          status: 404,
          requestId,
          details: { runId },
        });
      }

      // Parse backlog file
      const parseResult = parseBacklogFile(fileResult.content);

      // Validate parse result
      const validationErrors = validateParseResult(parseResult);
      if (validationErrors.length > 0) {
        await updateImportRun(pool, runId, {
          status: 'FAILED',
          errors_count: validationErrors.length,
          errors: validationErrors.map(err => ({ message: err })),
          completed_at: new Date().toISOString(),
        });

        return errorResponse('Validation failed', {
          status: 400,
          requestId,
          details: { runId, validationErrors },
        });
      }

      // Import epics
      let epicsCreated = 0;
      let epicsUpdated = 0;
      let epicsSkipped = 0;
      const epicIdMap = new Map<string, string>(); // external_id -> uuid

      for (const epic of parseResult.epics) {
        const result = await upsertAfu9Epic(pool, {
          external_id: epic.externalId,
          title: epic.title,
          description: epic.description,
          labels: epic.labels,
        });

        if (result.success && result.data) {
          epicIdMap.set(epic.externalId, result.data.id);
          
          // Check if it was created or updated
          const wasUpdated = result.data.created_at !== result.data.updated_at;
          if (wasUpdated) {
            epicsUpdated++;
          } else {
            epicsCreated++;
          }
        }
      }

      // Import issues
      let issuesCreated = 0;
      let issuesUpdated = 0;
      let issuesSkipped = 0;
      const issueErrors: Array<{ line?: number; message: string }> = [];

      for (const issue of parseResult.issues) {
        const epicId = epicIdMap.get(issue.epicExternalId);
        if (!epicId) {
          issueErrors.push({
            message: `Epic not found for issue ${issue.externalId}: ${issue.epicExternalId}`,
          });
          continue;
        }

        const result = await upsertIssueWithEpic(pool, {
          external_id: issue.externalId,
          epic_id: epicId,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        });

        if (result.error) {
          issueErrors.push({
            message: `Failed to upsert issue ${issue.externalId}: ${result.error}`,
          });
        } else {
          if (result.created) issuesCreated++;
          if (result.updated) issuesUpdated++;
          if (result.skipped) issuesSkipped++;
        }
      }

      // Calculate final status
      const totalErrors = parseResult.errors.length + issueErrors.length;
      const hasErrors = totalErrors > 0;
      const hasSuccess = epicsCreated > 0 || epicsUpdated > 0 || issuesCreated > 0 || issuesUpdated > 0;
      
      const finalStatus = hasErrors && !hasSuccess ? 'FAILED' : hasErrors ? 'PARTIAL' : 'COMPLETED';

      // Update import run with final results
      await updateImportRun(pool, runId, {
        status: finalStatus,
        epics_created: epicsCreated,
        epics_updated: epicsUpdated,
        epics_skipped: epicsSkipped,
        issues_created: issuesCreated,
        issues_updated: issuesUpdated,
        issues_skipped: issuesSkipped,
        errors_count: totalErrors,
        errors: [...parseResult.errors, ...issueErrors],
        completed_at: new Date().toISOString(),
      });

      // Return response
      const response: any = {
        success: finalStatus !== 'FAILED',
        runId,
        status: finalStatus,
        epics: {
          created: epicsCreated,
          updated: epicsUpdated,
          skipped: epicsSkipped,
          total: parseResult.epics.length,
        },
        issues: {
          created: issuesCreated,
          updated: issuesUpdated,
          skipped: issuesSkipped,
          total: parseResult.issues.length,
        },
      };

      if (totalErrors > 0) {
        response.errors = [...parseResult.errors, ...issueErrors];
      }

      return jsonResponse(response, {
        status: finalStatus === 'FAILED' ? 400 : 200,
        requestId,
      });
    } catch (error) {
      // Update import run as failed
      await updateImportRun(pool, runId, {
        status: 'FAILED',
        errors_count: 1,
        errors: [{ message: error instanceof Error ? error.message : 'Unknown error' }],
        completed_at: new Date().toISOString(),
      });

      throw error;
    }
  } catch (error) {
    console.error('[API /api/import/backlog-file] Error:', error);
    return errorResponse('Failed to import backlog file', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
