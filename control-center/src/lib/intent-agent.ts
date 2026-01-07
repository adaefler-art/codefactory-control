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
 * - Bounded inputs/outputs with cost guards
 * - Temperature=0 for deterministic responses
 */

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { INTENT_TOOLS } from './intent-agent-tools';
import { executeIntentTool } from './intent-agent-tool-executor';

// Environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const INTENT_ENABLED = process.env.AFU9_INTENT_ENABLED === "true";

// Bounding constants
const MAX_CONVERSATION_HISTORY = 10; // Max messages in context
const MAX_MESSAGE_LENGTH = 4000; // Max chars per message
const MAX_TOTAL_INPUT_CHARS = 20000; // Max total input chars
const MAX_OUTPUT_TOKENS = 1000; // Max tokens in response (bounded cost)
const API_TIMEOUT_MS = 30000; // 30 second timeout

// Rate limiting (in-memory, per user)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 20; // Max 20 requests per minute per user

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
 * Enhanced guardrail: remove common secret patterns from output and URLs
 */
function sanitizeContent(content: string): string {
  let sanitized = content;
  
  // Pattern: API keys (various formats)
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED_API_KEY]");
  sanitized = sanitized.replace(/[a-z0-9]{32,}/gi, (match) => {
    // Only redact if it looks like a hex key (32+ chars)
    return /^[a-f0-9]{32,}$/i.test(match) ? "[REDACTED_KEY]" : match;
  });
  
  // Pattern: GitHub tokens
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]{36,}/g, "[REDACTED_GITHUB_TOKEN]");
  sanitized = sanitized.replace(/gh[ospru]_[a-zA-Z0-9]{36,}/g, "[REDACTED_GITHUB_TOKEN]");
  
  // Pattern: AWS keys
  sanitized = sanitized.replace(/AKIA[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]");
  
  // Pattern: Bearer/Authorization tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9\-_.]+/gi, "Bearer [REDACTED_TOKEN]");
  sanitized = sanitized.replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]");
  
  // Pattern: Basic auth
  sanitized = sanitized.replace(/Basic\s+[a-zA-Z0-9+/=]+/gi, "Basic [REDACTED_AUTH]");
  
  // Pattern: URLs with query strings (may contain tokens)
  sanitized = sanitized.replace(
    /(https?:\/\/[^\s?]+)\?[^\s]*/gi,
    "$1?[REDACTED_QUERY]"
  );
  
  // Pattern: Common secret keywords followed by values
  sanitized = sanitized.replace(
    /(password|secret|token|key|apikey|api_key)[\s:="']+([^\s"',}]+)/gi,
    "$1=[REDACTED]"
  );
  
  return sanitized;
}

/**
 * Check and enforce rate limit for a user
 * 
 * @param userId - User ID to check
 * @returns true if allowed, false if rate limited
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);
  
  if (!userLimit || now > userLimit.resetAt) {
    // Reset or initialize
    rateLimitMap.set(userId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false; // Rate limited
  }
  
  // Increment count
  userLimit.count++;
  return true;
}

/**
 * Truncate message to max length
 */
function truncateMessage(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + "... [truncated]";
}

/**
 * Bound and sanitize conversation history
 */
function boundConversationHistory(
  history: IntentMessage[],
  maxMessages: number,
  maxCharsPerMessage: number
): IntentMessage[] {
  // Take newest messages first (slice from end)
  const bounded = history.slice(-maxMessages);
  
  // Truncate each message
  return bounded.map(msg => ({
    ...msg,
    content: truncateMessage(msg.content, maxCharsPerMessage),
  }));
}

/**
 * Generate INTENT agent response
 * 
 * @param userMessage - User's message content
 * @param conversationHistory - Previous messages in conversation
 * @param userId - User ID for rate limiting
 * @returns Agent response with metadata
 * @throws Error if INTENT is disabled, rate limited, or LLM call fails
 */
export async function generateIntentResponse(
  userMessage: string,
  conversationHistory: IntentMessage[] = [],
  userId?: string
): Promise<IntentAgentResponse> {
  // Feature flag check: fail-closed if disabled
  if (!INTENT_ENABLED) {
    throw new Error("INTENT agent is not enabled");
  }

  // Rate limit check
  if (userId && !checkRateLimit(userId)) {
    throw new Error("Rate limit exceeded. Please try again later.");
  }

  // Validate and bound input
  if (!userMessage || userMessage.trim() === "") {
    throw new Error("User message cannot be empty");
  }
  
  const boundedUserMessage = truncateMessage(userMessage.trim(), MAX_MESSAGE_LENGTH);
  const boundedHistory = boundConversationHistory(
    conversationHistory,
    MAX_CONVERSATION_HISTORY,
    MAX_MESSAGE_LENGTH
  );
  
  // Calculate total input size
  const totalInputChars = 
    boundedUserMessage.length + 
    boundedHistory.reduce((sum, msg) => sum + msg.content.length, 0);
  
  if (totalInputChars > MAX_TOTAL_INPUT_CHARS) {
    throw new Error("Input too large. Please reduce message or history size.");
  }

  const requestId = randomUUID();
  const timestamp = new Date().toISOString();

  try {
    const openai = getOpenAIClient();

    // System prompt: define INTENT agent behavior with tool capabilities
    const systemPrompt = `You are the INTENT Agent for AFU-9 Control Center.

Your role:
- Help users understand and operate the AFU-9 system (Autonomous Fabrication Unit - Ninefold Architecture)
- Provide guidance on issues, workflows, deployments, and observability
- Assist with Change Request (CR) creation and planning
- Execute actions via available tools (NO HALLUCINATION)

AVAILABLE TOOLS:
- get_context_pack: Retrieve session context pack (messages + sources)
- get_change_request: Get current CR draft for this session
- save_change_request: Save/update CR draft (does NOT validate/publish)
- validate_change_request: Validate CR against schema
- publish_to_github: Publish CR to GitHub as issue (idempotent)

CRITICAL RULES:
- When asked "siehst du den Change Request?" or similar, use get_change_request tool
- When asked to publish CR, use validate_change_request first, then publish_to_github
- If tool call fails, return exact error from tool response - never hallucinate tool results
- Use German for responses (user may use English or German)

Guidelines:
- Be concise but helpful
- Focus on operational and diagnostic assistance
- Never reveal API keys, tokens, or sensitive credentials
- Provide structured responses when appropriate

Current session: You are operating within a specific INTENT session.
All tool calls automatically use the correct sessionId.`;

    // Build messages array (using bounded inputs)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...boundedHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      { role: "user", content: boundedUserMessage },
    ];

    // Log request metadata (NOT the actual content to avoid secrets in logs)
    console.log("[INTENT Agent] Generating response...", {
      requestId,
      model: OPENAI_MODEL,
      messageCount: messages.length,
      inputChars: totalInputChars,
      userId: userId ? `user-${userId.substring(0, 8)}***` : 'unknown',
    });

    // Call OpenAI API with strict bounds, deterministic settings, and tool support
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), API_TIMEOUT_MS);
    
    try {
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        temperature: 0, // Deterministic responses
        max_tokens: MAX_OUTPUT_TOKENS, // Bounded output
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        tools: INTENT_TOOLS,
        tool_choice: 'auto', // Let model decide when to use tools
      }, {
        signal: abortController.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseMessage = completion.choices[0]?.message;

      if (!responseMessage) {
        console.error("[INTENT Agent] LLM returned no message", { requestId });
        throw new Error("LLM returned no response message");
      }

      // Handle tool calls if present
      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        console.log("[INTENT Agent] Processing tool calls", {
          requestId,
          toolCount: responseMessage.tool_calls.length,
          tools: responseMessage.tool_calls.map(tc => 
            'function' in tc ? tc.function.name : 'unknown'
          ),
        });

        // Build messages with assistant's tool call message
        const toolMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          ...messages,
          responseMessage,
        ];
        
        // Execute each tool call
        for (const toolCall of responseMessage.tool_calls) {
          // Type guard: only process function tool calls
          if (!('function' in toolCall)) {
            console.warn("[INTENT Agent] Skipping non-function tool call", { requestId });
            continue;
          }
          
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          console.log(`[INTENT Agent] Executing tool: ${functionName}`, {
            requestId,
            args: functionArgs,
          });
          
          // Execute tool
          const toolResult = await executeIntentTool(functionName, functionArgs, userId || 'unknown');
          
          // Add tool result to messages
          toolMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult,
          });
        }
        
        // Call LLM again with tool results
        const finalCompletion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: toolMessages,
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
        }, {
          signal: abortController.signal,
        });
        
        const finalMessage = finalCompletion.choices[0]?.message;
        
        if (!finalMessage?.content) {
          console.error("[INTENT Agent] No final response after tool calls", { requestId });
          throw new Error("No final response from OpenAI after tool calls");
        }

        // Sanitize content to remove potential secrets
        const sanitizedContent = sanitizeContent(finalMessage.content);

        // Log success (NOT the content)
        console.log("[INTENT Agent] Response generated successfully (with tools)", {
          requestId,
          timestamp,
          outputLength: sanitizedContent.length,
          tokensUsed: (completion.usage?.total_tokens || 0) + (finalCompletion.usage?.total_tokens || 0),
        });

        return {
          content: sanitizedContent,
          requestId,
          timestamp,
          model: OPENAI_MODEL,
        };
      }

      // No tool calls - return direct response
      const rawContent = responseMessage.content;

      if (!rawContent || rawContent.trim() === "") {
        console.error("[INTENT Agent] LLM returned empty response", { requestId });
        throw new Error("LLM returned an empty response");
      }

      // Sanitize content to remove potential secrets
      const sanitizedContent = sanitizeContent(rawContent);

      // Log success (NOT the content)
      console.log("[INTENT Agent] Response generated successfully", {
        requestId,
        timestamp,
        outputLength: sanitizedContent.length,
        tokensUsed: completion.usage?.total_tokens || 0,
      });

      return {
        content: sanitizedContent,
        requestId,
        timestamp,
        model: OPENAI_MODEL,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error("INTENT agent request timed out");
      }
      
      throw error;
    }

  } catch (error) {
    // Log error WITHOUT stack trace or sensitive details
    console.error("[INTENT Agent] Error generating response:", {
      requestId,
      errorType: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
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
