/**
 * INTENT Agent Tool Executor
 * 
 * Executes OpenAI Function Calling tools for INTENT Agent.
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 * 
 * GUARANTEES:
 * - Auth-first: all calls validate userId and session ownership
 * - Fail-safe: returns JSON error objects (no exceptions to LLM)
 * - Audit trail: uses existing DB functions (context packs, CR drafts)
 * - Idempotent: GitHub publishing uses canonical ID resolver
 */

import { getPool } from '@/lib/db';
import { generateContextPack } from '@/lib/db/contextPacks';
import { getCrDraft, saveCrDraft, validateAndSaveCrDraft, getLatestCrDraft } from '@/lib/db/intentCrDrafts';
import { getIssueDraft, saveIssueDraft, validateAndSaveIssueDraft } from '@/lib/db/intentIssueDrafts';
import { commitIssueDraftVersion } from '@/lib/db/intentIssueDraftVersions';
import { getIssueSet, generateIssueSet, commitIssueSet } from '@/lib/db/intentIssueSets';
import { exportIssueSetToAFU9Markdown, generateIssueSetSummary } from '@/lib/utils/issueSetExporter';
import { createOrUpdateFromCR } from '@/lib/github/issue-creator';
import { getToolGateStatus } from './intent-tool-registry';

/**
 * Tool execution context
 */
export interface ToolContext {
  userId: string;
  sessionId: string;
}

/**
 * Execute an INTENT tool call
 * 
 * @param toolName - The tool to execute
 * @param args - Tool arguments (from LLM)
 * @param context - Execution context (userId, sessionId from request)
 * @returns Tool execution result as JSON string
 */
export async function executeIntentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const pool = getPool();
  const { userId, sessionId } = context;
  
  console.log(`[Tool Executor] Executing ${toolName}`, {
    sessionId: sessionId.substring(0, 20),
    userId: userId.substring(0, 8),
    args,
  });
  
  try {
    const gate = getToolGateStatus(toolName, { userId, sessionId });
    if (!gate.enabled) {
      return JSON.stringify({
        success: false,
        error: 'Tool is disabled by gate',
        code: 'TOOL_DISABLED',
        tool: toolName,
        gate,
      });
    }

    switch (toolName) {
      case 'get_context_pack': {
        // Generate or get latest context pack for THIS session
        const result = await generateContextPack(pool, sessionId, userId);
        
        if (!result.success) {
          return JSON.stringify({ 
            success: false,
            error: result.error,
            code: 'CONTEXT_PACK_FAILED',
          });
        }
        
        return JSON.stringify({
          success: true,
          pack: {
            id: result.data.id,
            pack_hash: result.data.pack_hash.substring(0, 12),
            version: result.data.version,
            created_at: result.data.created_at,
            message_count: (result.data.pack_json as { messages?: unknown[] })?.messages?.length || 0,
            sources_count: (result.data.pack_json as { messages?: { used_sources?: unknown[] }[] })?.messages?.reduce((sum: number, m) => 
              sum + (m.used_sources?.length || 0), 0) || 0,
          },
          message: 'Context pack retrieved successfully',
        });
      }
      
      case 'get_change_request': {
        const result = await getCrDraft(pool, sessionId, userId);
        
        if (!result.success) {
          return JSON.stringify({
            success: true,
            draft: null,
            message: 'No Change Request draft exists yet for this session',
          });
        }
        
        if (!result.data) {
          return JSON.stringify({
            success: true,
            draft: null,
            message: 'No Change Request draft exists yet for this session',
          });
        }
        
        return JSON.stringify({
          success: true,
          draft: {
            id: result.data.id,
            cr_json: result.data.cr_json,
            cr_hash: result.data.cr_hash?.substring(0, 12),
            status: result.data.status,
            updated_at: result.data.updated_at,
          },
          message: 'Change Request draft found',
        });
      }
      
      case 'save_change_request': {
        const { crJson } = args;
        
        if (!crJson) {
          return JSON.stringify({
            success: false,
            error: 'crJson is required',
            code: 'MISSING_CR_JSON',
          });
        }
        
        const result = await saveCrDraft(pool, sessionId, userId, crJson);
        
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'CR_SAVE_FAILED',
          });
        }
        
        return JSON.stringify({
          success: true,
          draft: {
            id: result.data.id,
            cr_hash: result.data.cr_hash?.substring(0, 12),
            updated_at: result.data.updated_at,
          },
          message: 'Change Request draft saved successfully',
        });
      }
      
      case 'validate_change_request': {
        const { crJson } = args;
        
        if (!crJson) {
          return JSON.stringify({
            success: false,
            error: 'crJson is required',
            code: 'MISSING_CR_JSON',
          });
        }
        
        const result = await validateAndSaveCrDraft(pool, sessionId, userId, crJson);
        
        if (!result.success && !result.validation) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'VALIDATION_FAILED',
          });
        }
        
        return JSON.stringify({
          success: result.success,
          validation: result.validation,
          draft: result.data ? {
            id: result.data.id,
            status: result.data.status,
          } : null,
          message: result.validation?.ok ? 'CR is valid' : 'CR has validation errors',
        });
      }
      
      case 'publish_to_github': {
        // Get latest CR draft
        const crResult = await getLatestCrDraft(pool, sessionId, userId);
        
        if (!crResult.success || !crResult.data) {
          return JSON.stringify({
            success: false,
            error: 'No Change Request found to publish',
            code: 'CR_NOT_FOUND',
          });
        }
        
        // Check if CR is valid
        if (crResult.data.status !== 'valid') {
          return JSON.stringify({
            success: false,
            error: 'Change Request must be validated before publishing',
            code: 'CR_NOT_VALID',
            suggestion: 'Call validate_change_request first',
          });
        }
        
        // Type assertion: cr_json should be ChangeRequest, validated by saveCrDraft/validateAndSaveCrDraft
        const crJson = crResult.data.cr_json as unknown;
        
        // Publish to GitHub using issue-creator (which validates CR)
        try {
          const publishResult = await createOrUpdateFromCR(crJson);
          
          return JSON.stringify({
            success: true,
            mode: publishResult.mode,
            issueNumber: publishResult.issueNumber,
            url: publishResult.url,
            message: `GitHub issue ${publishResult.mode === 'created' ? 'created' : 'updated'} successfully`,
          });
        } catch (publishError) {
          return JSON.stringify({
            success: false,
            error: publishError instanceof Error ? publishError.message : 'Unknown error',
            code: 'GITHUB_PUBLISH_FAILED',
          });
        }
      }

      // E81.x - Issue Draft tools
      case 'get_issue_draft': {
        const result = await getIssueDraft(pool, sessionId, userId);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_DRAFT_GET_FAILED',
          });
        }

        if (!result.data) {
          return JSON.stringify({
            success: true,
            draft: null,
            message: 'No Issue Draft exists yet for this session',
          });
        }

        return JSON.stringify({
          success: true,
          draft: result.data,
          message: 'Issue Draft found',
        });
      }

      case 'save_issue_draft': {
        const { issueJson } = args;

        if (!issueJson) {
          return JSON.stringify({
            success: false,
            error: 'issueJson is required',
            code: 'MISSING_ISSUE_JSON',
          });
        }

        const result = await saveIssueDraft(pool, sessionId, userId, issueJson);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_DRAFT_SAVE_FAILED',
          });
        }

        return JSON.stringify({
          success: true,
          draft: {
            id: result.data.id,
            issue_hash: result.data.issue_hash?.substring(0, 12),
            last_validation_status: result.data.last_validation_status,
            updated_at: result.data.updated_at,
          },
          message: 'Issue Draft saved successfully',
        });
      }

      case 'validate_issue_draft': {
        const { issueJson } = args;

        if (!issueJson) {
          return JSON.stringify({
            success: false,
            error: 'issueJson is required',
            code: 'MISSING_ISSUE_JSON',
          });
        }

        const result = await validateAndSaveIssueDraft(pool, sessionId, userId, issueJson);

        if (!result.success && !('validation' in result) ) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_DRAFT_VALIDATION_FAILED',
          });
        }

        return JSON.stringify({
          success: result.success,
          validation: 'validation' in result ? result.validation : undefined,
          draft: result.success
            ? {
                id: result.data.id,
                last_validation_status: result.data.last_validation_status,
                last_validation_at: result.data.last_validation_at,
              }
            : null,
          message:
            'validation' in result && result.validation?.isValid
              ? 'Issue Draft is valid'
              : 'Issue Draft has validation errors',
        });
      }

      case 'commit_issue_draft': {
        // Commit current draft (API parity with /issue-draft/commit)
        const draftResult = await getIssueDraft(pool, sessionId, userId);

        if (!draftResult.success) {
          return JSON.stringify({
            success: false,
            error: draftResult.error,
            code: 'ISSUE_DRAFT_GET_FAILED',
          });
        }

        if (!draftResult.data) {
          return JSON.stringify({
            success: false,
            error: 'No Issue Draft exists for this session',
            code: 'ISSUE_DRAFT_NOT_FOUND',
          });
        }

        const commitResult = await commitIssueDraftVersion(
          pool,
          sessionId,
          userId,
          draftResult.data.issue_json
        );

        if (!commitResult.success) {
          return JSON.stringify({
            success: false,
            error: commitResult.error,
            code: 'ISSUE_DRAFT_COMMIT_FAILED',
          });
        }

        return JSON.stringify({
          success: true,
          version: {
            id: commitResult.data.id,
            version_number: commitResult.data.version_number,
            issue_hash: commitResult.data.issue_hash?.substring(0, 12),
            created_at: commitResult.data.created_at,
          },
          isNew: commitResult.isNew,
          message: commitResult.isNew ? 'Issue Draft committed (new version)' : 'Issue Draft commit is idempotent (existing version)',
        });
      }

      // E81.x - Issue Set tools
      case 'get_issue_set': {
        const result = await getIssueSet(pool, sessionId, userId);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_SET_GET_FAILED',
          });
        }

        if (!result.data) {
          return JSON.stringify({
            success: true,
            issueSet: null,
            items: [],
            summary: { total: 0, valid: 0, invalid: 0 },
            message: 'No Issue Set exists yet for this session',
          });
        }

        const items = result.items || [];
        const summary = generateIssueSetSummary(items);

        return JSON.stringify({
          success: true,
          issueSet: result.data,
          items,
          summary,
          message: 'Issue Set found',
        });
      }

      case 'generate_issue_set': {
        const { briefingText, issueDrafts, constraints } = args as any;

        if (typeof briefingText !== 'string' || !briefingText.trim()) {
          return JSON.stringify({
            success: false,
            error: 'briefingText is required',
            code: 'MISSING_BRIEFING_TEXT',
          });
        }

        if (!Array.isArray(issueDrafts)) {
          return JSON.stringify({
            success: false,
            error: 'issueDrafts array is required',
            code: 'MISSING_ISSUE_DRAFTS',
          });
        }

        const result = await generateIssueSet(
          pool,
          sessionId,
          userId,
          briefingText,
          issueDrafts,
          constraints
        );

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_SET_GENERATE_FAILED',
          });
        }

        return JSON.stringify({
          success: true,
          issueSet: result.data,
          items: result.items,
          summary: generateIssueSetSummary(result.items),
          message: 'Issue Set generated successfully',
        });
      }

      case 'commit_issue_set': {
        const result = await commitIssueSet(pool, sessionId, userId);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_SET_COMMIT_FAILED',
          });
        }

        return JSON.stringify({
          success: true,
          issueSet: result.data,
          message: 'Issue Set committed successfully',
        });
      }

      case 'export_issue_set_markdown': {
        const includeInvalid = (args as any)?.includeInvalid === true;
        const result = await getIssueSet(pool, sessionId, userId);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_SET_GET_FAILED',
          });
        }

        if (!result.data) {
          return JSON.stringify({
            success: false,
            error: 'No Issue Set exists for this session',
            code: 'ISSUE_SET_NOT_FOUND',
          });
        }

        const items = result.items || [];
        const markdown = exportIssueSetToAFU9Markdown(items, { includeInvalid });
        const summary = generateIssueSetSummary(items);

        return JSON.stringify({
          success: true,
          markdown,
          summary,
          message: 'Issue Set exported to markdown',
        });
      }
      
      default:
        return JSON.stringify({
          success: false,
          error: `Unknown tool: ${toolName}`,
          code: 'UNKNOWN_TOOL',
        });
    }
  } catch (error) {
    console.error(`[Tool Executor] Error executing ${toolName}:`, error);
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'TOOL_EXECUTION_ERROR',
    });
  }
}
