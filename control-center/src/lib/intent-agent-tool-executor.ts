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
import { publishIssueDraftBatch } from '@/lib/github/issue-draft-publisher';
import type { IssueDraft } from '@/lib/schemas/issueDraft';
import { getToolGateStatus, isDraftMutatingTool } from './intent-tool-registry';
import { logToolExecution, type TriggerType } from '@/lib/db/toolExecutionAudit';
import { checkDevModeActionAllowed, getDevModeActionForTool } from '@/lib/guards/intent-dev-mode';

/**
 * Tool execution context
 * I903: Added DISCUSS/DRAFTING/ACT modes for three-stage steering
 */
export interface ToolContext {
  userId: string;
  sessionId: string;
  triggerType: TriggerType;
  conversationMode: 'DISCUSS' | 'DRAFTING' | 'ACT';
}

/**
 * Execute an INTENT tool call
 * 
 * I903: Implements three-stage tool gating based on conversation mode and trigger type
 * - In DISCUSS mode: draft-mutating tools blocked unless triggerType is USER_EXPLICIT or UI_ACTION
 * - In DRAFTING mode: draft-mutating tools allowed, but validation not enforced
 * - In ACT mode: all tools allowed with full validation (existing behavior)
 * - All executions logged to audit trail
 * 
 * @param toolName - The tool to execute
 * @param args - Tool arguments (from LLM)
 * @param context - Execution context (userId, sessionId, triggerType, conversationMode)
 * @returns Tool execution result as JSON string
 */
export async function executeIntentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const pool = getPool();
  const { userId, sessionId, triggerType, conversationMode } = context;
  const alwaysAllowedDraftTools = new Set([
    'save_issue_draft',
    'apply_issue_draft_patch',
    'validate_issue_draft',
  ]);
  
  console.log(`[Tool Executor] Executing ${toolName}`, {
    sessionId: sessionId.substring(0, 20),
    userId: userId.substring(0, 8),
    triggerType,
    conversationMode,
    args,
  });
  
  try {
    // I903: Tool gating enforcement for three-stage steering
    // 1. Check if tool is draft-mutating
    const isDraftMutating = isDraftMutatingTool(toolName);
    
    // 2. In DISCUSS mode, block draft-mutating tools unless explicitly triggered
    //    OR DEV MODE is active and action is in allowlist
    if (conversationMode === 'DISCUSS' && isDraftMutating && !alwaysAllowedDraftTools.has(toolName)) {
      if (triggerType !== 'USER_EXPLICIT' && triggerType !== 'UI_ACTION') {
        // Check DEV MODE allowlist before blocking
        const devModeAction = getDevModeActionForTool(toolName);
        const devModeCheck = devModeAction
          ? checkDevModeActionAllowed(userId, devModeAction, { sessionId, toolName })
          : { allowed: false, devMode: false };
        
        if (!devModeCheck.allowed) {
          // Log blocked execution
          await logToolExecution(pool, {
            sessionId,
            userId,
            toolName,
            triggerType,
            conversationMode,
            success: false,
            errorCode: 'DRAFT_TOOL_BLOCKED_IN_DISCUSS_MODE',
          });
          
          return JSON.stringify({
            success: false,
            error: 'Draft-mutating tools are not allowed in DISCUSS mode without explicit user command',
            code: 'DRAFT_TOOL_BLOCKED_IN_DISCUSS_MODE',
            tool: toolName,
            suggestion: 'Switch to DRAFTING mode or use explicit commands like "/draft", "create draft now", "update draft", "commit draft"',
            triggerType,
            conversationMode,
            devModeAvailable: devModeCheck.devMode,
          });
        }
        
        // DEV MODE allowed this action - log and continue
        console.log(`[Tool Executor] DEV MODE bypass for ${toolName} in DISCUSS mode`);
      }
    }
    
    // 3. Existing gate check (prod disabled, etc.)
    const gate = getToolGateStatus(toolName, { userId, sessionId });
    if (!gate.enabled) {
      // Log disabled tool execution
      await logToolExecution(pool, {
        sessionId,
        userId,
        toolName,
        triggerType,
        conversationMode,
        success: false,
        errorCode: gate.code || 'TOOL_DISABLED',
      });
      
      return JSON.stringify({
        success: false,
        error: 'Tool is disabled by gate',
        code: 'TOOL_DISABLED',
        tool: toolName,
        gate,
      });
    }

    // Tool execution follows (with audit logging)
    let executionSuccess = true;
    let executionErrorCode: string | undefined;
    let result: string;
    
    try {
      // Execute tool (existing switch statement follows)
      result = await executeToolInternal(toolName, args, { userId, sessionId, triggerType, conversationMode });
      
      // Parse result to check for success (assume failure for non-JSON)
      try {
        const parsed = JSON.parse(result);
        executionSuccess = parsed.success !== false;
        executionErrorCode = parsed.code;
      } catch (parseError) {
        // Non-JSON result is unexpected - log and treat as failure
        console.warn('[Tool Executor] Non-JSON result from tool', {
          toolName,
          sessionId: sessionId.substring(0, 20),
          resultPreview: result.substring(0, 100),
        });
        executionSuccess = false;
        executionErrorCode = 'NON_JSON_RESULT';
      }
    } catch (toolError) {
      executionSuccess = false;
      executionErrorCode = 'TOOL_EXECUTION_ERROR';
      result = JSON.stringify({
        success: false,
        error: toolError instanceof Error ? toolError.message : 'Unknown error',
        code: 'TOOL_EXECUTION_ERROR',
      });
    }
    
    // Log execution to audit trail
    await logToolExecution(pool, {
      sessionId,
      userId,
      toolName,
      triggerType,
      conversationMode,
      success: executionSuccess,
      errorCode: executionErrorCode,
    });
    
    return result;
  } catch (error) {
    console.error(`[Tool Executor] Error executing ${toolName}:`, error);
    
    // Log failed execution
    await logToolExecution(pool, {
      sessionId,
      userId,
      toolName,
      triggerType,
      conversationMode,
      success: false,
      errorCode: 'TOOL_EXECUTION_ERROR',
    });
    
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'TOOL_EXECUTION_ERROR',
    });
  }
}

/**
 * Internal tool execution logic (extracted from original executeIntentTool)
 */
async function executeToolInternal(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const pool = getPool();
  const { userId, sessionId } = context;
  
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
      case 'get_issue_draft_summary': {
        const { createDraftSummary, createEmptyDraftSummary } = await import('@/lib/schemas/issueDraftSummary');
        
        const result = await getIssueDraft(pool, sessionId, userId);

        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error,
            code: 'ISSUE_DRAFT_GET_FAILED',
          });
        }

        if (!result.data) {
          const summary = createEmptyDraftSummary();
          return JSON.stringify({
            success: true,
            summary,
          });
        }

        const summary = createDraftSummary(result.data);
        return JSON.stringify({
          success: true,
          summary,
        });
      }

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

        console.log('[INTENT Agent] save_issue_draft called', {
          sessionId: sessionId.substring(0, 20),
          userId: userId.substring(0, 8),
        });

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

      case 'apply_issue_draft_patch': {
        const { patch, validateAfterUpdate } = args;

        if (!patch) {
          return JSON.stringify({
            success: false,
            error: 'patch is required',
            code: 'MISSING_PATCH',
          });
        }

        // Get current draft
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
            error: 'No Issue Draft exists to patch. Create one first with save_issue_draft.',
            code: 'NO_DRAFT',
          });
        }

        // Import patch application
        const { applyPatchToDraft } = await import('@/lib/drafts/patchApply');
        
        // Apply patch
        const currentDraft = draftResult.data.issue_json as IssueDraft;
        const patchResult = applyPatchToDraft(currentDraft, patch);

        if (!patchResult.success) {
          return JSON.stringify({
            success: false,
            error: patchResult.error,
            code: patchResult.code || 'PATCH_FAILED',
          });
        }

        // Save patched draft (with optional validation)
        let saveResult;
        let validationResult;

        if (validateAfterUpdate) {
          const validateResult = await validateAndSaveIssueDraft(
            pool,
            sessionId,
            userId,
            patchResult.draft!
          );

          if (!validateResult.success) {
            return JSON.stringify({
              success: false,
              error: validateResult.error,
              code: 'ISSUE_DRAFT_SAVE_FAILED',
            });
          }

          saveResult = validateResult.data;
          validationResult = validateResult.validation;
        } else {
          const simpleSaveResult = await saveIssueDraft(
            pool,
            sessionId,
            userId,
            patchResult.draft!
          );

          if (!simpleSaveResult.success) {
            return JSON.stringify({
              success: false,
              error: simpleSaveResult.error,
              code: 'ISSUE_DRAFT_SAVE_FAILED',
            });
          }

          saveResult = simpleSaveResult.data;
        }

        // Return minimal response (no schema dump)
        return JSON.stringify({
          success: true,
          updated: {
            id: saveResult.id,
            issue_hash: saveResult.issue_hash?.substring(0, 12),
            last_validation_status: saveResult.last_validation_status,
            updated_at: saveResult.updated_at,
          },
          diffSummary: patchResult.diffSummary,
          validation: validationResult
            ? {
                isValid: validationResult.isValid,
                errorCount: validationResult.errors?.length || 0,
              }
            : undefined,
          message: `Draft updated: ${patchResult.diffSummary?.changedFields.join(', ')}`,
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
      
      case 'publish_issues_to_github_batch': {
        const { owner, repo, includeInvalid = false } = args;
        
        // Validate required parameters
        if (!owner || typeof owner !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'owner parameter is required and must be a string',
            code: 'MISSING_OWNER',
          });
        }
        
        if (!repo || typeof repo !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'repo parameter is required and must be a string',
            code: 'MISSING_REPO',
          });
        }
        
        // Get the issue set for this session
        const issueSetResult = await getIssueSet(pool, sessionId, userId);
        
        if (!issueSetResult.success) {
          return JSON.stringify({
            success: false,
            error: issueSetResult.error,
            code: 'ISSUE_SET_ERROR',
          });
        }
        
        if (!issueSetResult.data || !issueSetResult.items || issueSetResult.items.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No issue set found for this session',
            code: 'NO_ISSUE_SET',
            suggestion: 'Generate an issue set first using the briefing tool',
          });
        }
        
        // Filter items based on validation status
        const itemsToPublish = includeInvalid 
          ? issueSetResult.items
          : issueSetResult.items.filter(item => item.last_validation_status === 'valid');
        
        if (itemsToPublish.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No valid issues to publish',
            code: 'NO_VALID_ISSUES',
            suggestion: 'Validate the issue set first or set includeInvalid=true',
          });
        }
        
        // Extract IssueDrafts from items
        const drafts: IssueDraft[] = itemsToPublish.map(item => item.issue_json as IssueDraft);
        
        // Publish batch to GitHub
        try {
          const batchResult = await publishIssueDraftBatch(drafts, owner, repo);
          
          return JSON.stringify({
            success: true,
            total: batchResult.total,
            successful: batchResult.successful,
            failed: batchResult.failed,
            results: batchResult.results.map(r => ({
              canonicalId: r.canonicalId,
              success: r.success,
              mode: r.mode,
              issueNumber: r.issueNumber,
              url: r.url,
              error: r.error,
              errorCode: r.errorCode,
            })),
            message: `Batch publish completed: ${batchResult.successful} succeeded, ${batchResult.failed} failed`,
          });
        } catch (publishError) {
          return JSON.stringify({
            success: false,
            error: publishError instanceof Error ? publishError.message : 'Unknown error',
            code: 'BATCH_PUBLISH_FAILED',
          });
        }
      }
      
      // E89.3 - Evidence Tool: readFile
      case 'readFile': {
        const { owner, repo, ref, path, startLine, endLine, maxBytes } = args;
        
        // Validate required parameters
        if (!owner || typeof owner !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'owner parameter is required and must be a string',
            code: 'MISSING_OWNER',
          });
        }
        
        if (!repo || typeof repo !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'repo parameter is required and must be a string',
            code: 'MISSING_REPO',
          });
        }
        
        if (!path || typeof path !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'path parameter is required and must be a string',
            code: 'MISSING_PATH',
          });
        }
        
        // Import and call readFileEvidence
        try {
          const { readFileEvidence } = await import('@/lib/evidence/readFile');
          
          const result = await readFileEvidence({
            owner,
            repo,
            ref: ref as string | undefined,
            path,
            startLine: startLine as number | undefined,
            endLine: endLine as number | undefined,
            maxBytes: maxBytes as number | undefined,
          });
          
          return JSON.stringify(result);
        } catch (readError) {
          return JSON.stringify({
            success: false,
            error: readError instanceof Error ? readError.message : 'Unknown error',
            code: 'READ_FILE_FAILED',
          });
        }
      }
      
      // E89.4 - Evidence Tool: searchCode
      case 'searchCode': {
        const { owner, repo, ref, query, path, maxResults } = args;
        
        // Validate required parameters
        if (!owner || typeof owner !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'owner parameter is required and must be a string',
            code: 'MISSING_OWNER',
          });
        }
        
        if (!repo || typeof repo !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'repo parameter is required and must be a string',
            code: 'MISSING_REPO',
          });
        }
        
        if (!query || typeof query !== 'string') {
          return JSON.stringify({
            success: false,
            error: 'query parameter is required and must be a string',
            code: 'MISSING_QUERY',
          });
        }
        
        // Import and call searchCodeEvidence
        try {
          const { searchCodeEvidence } = await import('@/lib/evidence/searchCode');
          
          const result = await searchCodeEvidence({
            owner,
            repo,
            ref: ref as string | undefined,
            query,
            path: path as string | undefined,
            maxResults: maxResults as number | undefined,
          });
          
          return JSON.stringify(result);
        } catch (searchError) {
          return JSON.stringify({
            success: false,
            error: searchError instanceof Error ? searchError.message : 'Unknown error',
            code: 'SEARCH_CODE_FAILED',
          });
        }
      }
      
      default:
        return JSON.stringify({
          success: false,
          error: `Unknown tool: ${toolName}`,
          code: 'UNKNOWN_TOOL',
        });
  }
}
