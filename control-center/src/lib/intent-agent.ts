/**
 * INTENT Agent MVP
 * 
 * Guardrailed LLM-based assistant for INTENT Console.
 * Issue: INTENT Agent MVP + INTENT Console UI auf Control-Center-Standard bringen
 * 
 * NON-NEGOTIABLES:
 * - No secrets/tokens in responses or logs
 * - Deterministic response structure (requestId, timestamps)
 * - Context pack generation on every response
 * - Fail-closed when AFU9_INTENT_ENABLED=false
 * - Auth-first error handling
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";

// Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const INTENT_ENABLED = process.env.AFU9_INTENT_ENABLED === "true";

// Singleton OpenAI client
let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client instance
 */
function getOpenAIClient(): OpenAI {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

/**
 * Message for conversation history
 */
export interface IntentMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Response from INTENT agent
 */
export interface IntentAgentResponse {
  content: string;
  requestId: string;
  timestamp: string;
  model: string;
}

/**
 * Check if INTENT agent is enabled
 */
export function isIntentEnabled(): boolean {
  return INTENT_ENABLED;
}

/**
 * Sanitize content to remove potential secrets
 * 
 * Basic guardrail: remove common secret patterns from output
 */
function sanitizeContent(content: string): string {
  // Remove potential API keys, tokens, passwords
  let sanitized = content;
  
  // Pattern: sk-... (OpenAI-style keys)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]");
  
  // Pattern: ghp_... (GitHub personal access tokens)
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36,}/g, "[REDACTED_GITHUB_TOKEN]");
  
  // Pattern: AWS keys
  sanitized = sanitized.replace(/AKIA[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]");
  
  // Pattern: Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9\-_.]+/gi, "Bearer [REDACTED_TOKEN]");
  
  // Pattern: Basic auth
  sanitized = sanitized.replace(/Basic\s+[a-zA-Z0-9+/=]+/gi, "Basic [REDACTED_AUTH]");
  
  return sanitized;
}

/**
 * Generate INTENT agent response
 * 
 * @param userMessage - User's message content
 * @param conversationHistory - Previous messages in conversation
 * @returns Agent response with metadata
 * @throws Error if INTENT is disabled or LLM call fails
 */
export async function generateIntentResponse(
  userMessage: string,
  conversationHistory: IntentMessage[] = []
): Promise<IntentAgentResponse> {
  // Feature flag check: fail-closed if disabled
  if (!INTENT_ENABLED) {
    throw new Error("INTENT agent is not enabled");
  }

  // Validate input
  if (!userMessage || userMessage.trim() === "") {
    throw new Error("User message cannot be empty");
  }

  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  try {
    const openai = getOpenAIClient();

    // System prompt: define INTENT agent behavior
    const systemPrompt = `You are the INTENT Agent for AFU-9 Control Center.

Your role:
- Help users understand and operate the AFU-9 system (Autonomous Fabrication Unit - Ninefold Architecture)
- Provide guidance on issues, workflows, deployments, and observability
- Assist with Change Request (CR) creation and planning
- Answer questions about the system architecture and capabilities

Guidelines:
- Be concise but helpful
- Use German for responses (user may use English or German)
- Focus on operational and diagnostic assistance
- Do NOT execute actions automatically (no PRs, deployments, or code changes)
- If asked to perform actions, explain what the user should do instead
- Never reveal API keys, tokens, or sensitive credentials
- Provide structured responses when appropriate

Current capabilities:
- View session messages and context
- Help draft Change Requests
- Provide system diagnostics
- Answer questions about AFU-9 architecture

Limitations (current MVP):
- Cannot create GitHub PRs automatically
- Cannot trigger deployments
- Cannot access live repository contents (yet)
- Cannot execute code changes`;

    // Build messages array
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: userMessage },
    ];

    // Call OpenAI API
    console.log("[INTENT Agent] Generating response...", {
      requestId,
      model: OPENAI_MODEL,
      messageCount: messages.length,
    });

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    });

    const rawContent = completion.choices[0]?.message?.content;

    if (!rawContent || rawContent.trim() === "") {
      console.error("[INTENT Agent] LLM returned empty response", { requestId });
      throw new Error("LLM returned an empty response");
    }

    // Sanitize content to remove potential secrets
    const sanitizedContent = sanitizeContent(rawContent);

    console.log("[INTENT Agent] Response generated successfully", {
      requestId,
      timestamp,
      contentLength: sanitizedContent.length,
    });

    return {
      content: sanitizedContent,
      requestId,
      timestamp,
      model: OPENAI_MODEL,
    };
  } catch (error) {
    console.error("[INTENT Agent] Error generating response:", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Re-throw with context but don't leak sensitive info
    if (error instanceof Error && error.message === "OPENAI_API_KEY is not configured") {
      throw new Error("INTENT agent is not properly configured");
    }

    if (error instanceof Error && error.message.includes("API key")) {
      throw new Error("INTENT agent authentication failed");
    }

    if (error instanceof Error && error.message.includes("quota")) {
      throw new Error("INTENT agent quota exceeded");
    }

    throw new Error(`INTENT agent error: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
