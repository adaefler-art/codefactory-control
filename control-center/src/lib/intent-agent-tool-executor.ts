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
import { generateContextPack, getContextPack } from '@/lib/db/contextPacks';
import { getCrDraft, saveCrDraft, validateAndSaveCrDraft, getLatestCrDraft } from '@/lib/db/intentCrDrafts';
import { createOrUpdateFromCR } from '@/lib/github/issue-creator';

/**
 * Execute an INTENT tool call
 * 
 * @param toolName - The tool to execute
 * @param args - Tool arguments (parsed from function.arguments)
 * @param userId - Authenticated user ID for auth checks
 * @returns Tool execution result as JSON string (for OpenAI)
 */
export async function executeIntentTool(
  toolName: string,
  args: Record<string, any>,
  userId: string
): Promise<string> {
  const pool = getPool();
  
  try {
    switch (toolName) {
      case 'get_context_pack': {
        const { sessionId } = args;
        
        // Generate or get latest context pack
        const result = await generateContextPack(pool, sessionId, userId);
        
        if (!result.success) {
          return JSON.stringify({ 
            error: result.error,
            code: result.code || 'CONTEXT_PACK_FAILED',
          });
        }
        
        return JSON.stringify({
          success: true,
          pack: result.data,
        });
      }
      
      case 'get_change_request': {
        const { sessionId } = args;
        
        const result = await getCrDraft(pool, sessionId, userId);
        
        if (!result.success) {
          // If session not found or access denied, return error
          return JSON.stringify({
            error: result.error,
            code: 'CR_ACCESS_DENIED',
          });
        }
        
        if (!result.data) {
          // No CR exists yet - this is not an error
          return JSON.stringify({
            success: true,
            draft: null,
            message: 'No Change Request draft exists yet',
          });
        }
        
        return JSON.stringify({
          success: true,
          draft: result.data,
        });
      }
      
      case 'save_change_request': {
        const { sessionId, crJson } = args;
        
        const result = await saveCrDraft(pool, sessionId, userId, crJson);
        
        if (!result.success) {
          return JSON.stringify({
            error: result.error,
            code: 'CR_SAVE_FAILED',
          });
        }
        
        return JSON.stringify({
          success: true,
          draft: result.data,
          message: 'Change Request draft saved successfully',
        });
      }
      
      case 'validate_change_request': {
        const { sessionId, crJson } = args;
        
        const result = await validateAndSaveCrDraft(pool, sessionId, userId, crJson);
        
        return JSON.stringify({
          success: result.success,
          validation: result.validation,
          draft: result.data || null,
        });
      }
      
      case 'publish_to_github': {
        const { sessionId } = args;
        
        // Get latest CR draft
        const crResult = await getLatestCrDraft(pool, sessionId, userId);
        
        if (!crResult.success) {
          return JSON.stringify({
            error: crResult.error,
            code: 'CR_ACCESS_DENIED',
          });
        }
        
        if (!crResult.data) {
          return JSON.stringify({
            error: 'No Change Request found to publish',
            code: 'CR_NOT_FOUND',
          });
        }
        
        // Publish to GitHub using issue-creator
        try {
          const publishResult = await createOrUpdateFromCR(crResult.data.cr_json);
          
          return JSON.stringify({
            success: true,
            mode: publishResult.mode,
            issueNumber: publishResult.issueNumber,
            url: publishResult.url,
            message: `GitHub issue ${publishResult.mode === 'created' ? 'created' : 'updated'} successfully`,
          });
        } catch (error) {
          return JSON.stringify({
            error: error instanceof Error ? error.message : 'GitHub publishing failed',
            code: 'GITHUB_PUBLISH_FAILED',
          });
        }
      }
      
      default:
        return JSON.stringify({
          error: `Unknown tool: ${toolName}`,
          code: 'UNKNOWN_TOOL',
        });
    }
  } catch (error) {
    console.error(`[Tool Executor] Error executing ${toolName}:`, error);
    return JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'TOOL_EXECUTION_ERROR',
    });
  }
}
