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
import { createOrUpdateFromCR } from '@/lib/github/issue-creator';

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
