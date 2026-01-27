/**
 * OpenAI Function Calling Tool Definitions for INTENT Agent
 * 
 * CRITICAL: Tools do NOT take sessionId as parameter!
 * Session ID comes from request context, not from LLM.
 * 
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 */

import type OpenAI from 'openai';
import { buildOpenAITools } from './intent-tool-registry';

/**
 * OpenAI Function Calling Tool Definitions for INTENT Agent
 * 
 * CRITICAL: Tools do NOT take sessionId as parameter!
 * Session ID comes from request context, not from LLM.
 * 
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 */
export const INTENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = buildOpenAITools();
