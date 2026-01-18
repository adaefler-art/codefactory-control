/**
 * INTENT Message Classifier
 * 
 * Classifies user messages to detect explicit action intents.
 * Issue: V09-I02: Tool Gating: Action-Gated Draft Ops (No Auto-Snap)
 * 
 * PURPOSE:
 * - Distinguish between conversational requests and explicit action commands
 * - Enable tool gating: draft-mutating tools only execute on explicit commands
 * - Bounded, deterministic, no LLM heuristics (fail-closed)
 * 
 * EXAMPLES:
 * - "update draft with..." → Action Intent (USER_EXPLICIT)
 * - "commit the draft" → Action Intent (USER_EXPLICIT)
 * - "create draft now" → Action Intent (USER_EXPLICIT)
 * - "publish to github" → Action Intent (USER_EXPLICIT)
 * - "can you help me with..." → NOT Action Intent (AUTO in FREE = blocked)
 * - "what should the issue look like?" → NOT Action Intent
 */

export interface MessageClassification {
  isActionIntent: boolean;
  actionType?: 'slash_draft' | 'slash_patch' | 'slash_commit' | 'slash_publish' | 'draft_create' | 'draft_update' | 'draft_commit' | 'draft_publish' | 'cr_save' | 'cr_publish' | 'issue_set_generate' | 'issue_set_commit' | 'issue_set_publish';
  confidence: 'high' | 'low';
}

/**
 * Explicit action keywords (deterministic pattern matching)
 * 
 * IMPORTANT: Order matters! More specific patterns should come first
 * to avoid false matches (e.g., "issue set" before "issue")
 * 
 * SLASH COMMANDS: Highest priority, unambiguous user intent
 */
const ACTION_PATTERNS = {
  // Slash commands (highest priority, explicit user intent)
  slash_draft: [
    /^\/draft\b/i,
  ],
  slash_patch: [
    /^\/patch\b/i,
  ],
  slash_commit: [
    /^\/commit\b/i,
  ],
  slash_publish: [
    /^\/publish\b/i,
  ],
  
  // Issue Set patterns (must come before draft patterns)
  issue_set_generate: [
    /\bgenerate\s+(the\s+)?issue\s+set\b/i,
    /\bcreate\s+(the\s+)?issue\s+set\b/i,
    /\bmake\s+(the\s+)?issue\s+set\b/i,
  ],
  issue_set_commit: [
    /\bcommit\s+(the\s+)?issue\s+set\b/i,
  ],
  issue_set_publish: [
    /\bpublish\s+(the\s+)?issue\s+set\b/i,
    /\bpublish\s+issues\s+to\s+github\b/i,
    /\bpublish\s+batch\b/i,
  ],
  
  // Draft patterns
  draft_create: [
    /\bcreate\s+(the\s+)?draft\s+(now|immediately)\b/i,
    /\bcreate\s+(a|an|the)\s+(minimal\s+)?draft\b/i,
    /\bmake\s+(a|an|the)\s+draft\s+(now|immediately)\b/i,
    /\bgenerate\s+(the\s+)?draft\s+(now|immediately)\b/i,
  ],
  draft_update: [
    /\bupdate\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bmodify\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bchange\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bpatch\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bedit\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bapply\s+patch(\s+to)?\s+(the\s+)?draft\b/i,  // More specific: "apply patch to draft"
  ],
  draft_commit: [
    /\bcommit\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bsave\s+version\b/i,
    /\bcreate\s+version\b/i,
  ],
  draft_publish: [
    /\bpublish\s+(the\s+)?(issue\s+)?draft\b/i,
    /\bpublish\s+to\s+github\b/i,
    /\bpublish\s+issue\b/i,
  ],
  
  // Change Request patterns
  cr_save: [
    /\bsave\s+(the\s+)?change\s+request\b/i,
    /\bsave\s+(the\s+)?cr\b/i,
    /\bupdate\s+(the\s+)?change\s+request\b/i,
    /\bupdate\s+(the\s+)?cr\b/i,
  ],
  cr_publish: [
    /\bpublish\s+(the\s+)?change\s+request\b/i,
    /\bpublish\s+(the\s+)?cr\b/i,
  ],
} as const;

/**
 * Classify a user message to detect explicit action intents
 * 
 * DETERMINISTIC: Uses pattern matching, no LLM calls
 * BOUNDED: Max 100 patterns checked
 * FAIL-CLOSED: Returns isActionIntent=false if unsure
 * 
 * @param message - User message content
 * @returns Classification result
 */
export function classifyMessage(message: string): MessageClassification {
  // Normalize: trim, lowercase for matching
  const normalized = message.trim().toLowerCase();
  
  // Empty message is not an action intent
  if (normalized.length === 0) {
    return { isActionIntent: false, confidence: 'high' };
  }
  
  // Check all action patterns
  for (const [actionType, patterns] of Object.entries(ACTION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return {
          isActionIntent: true,
          actionType: actionType as MessageClassification['actionType'],
          confidence: 'high',
        };
      }
    }
  }
  
  // No explicit action pattern matched
  return { isActionIntent: false, confidence: 'high' };
}

/**
 * Check if message contains soft indicators that might suggest draft intent
 * (for logging/debugging purposes ONLY, NOT used for gating)
 * 
 * WARNING: This function should NEVER be used to trigger ACT mode.
 * It exists only for telemetry and debugging.
 * 
 * @deprecated Do not use for mode switching - use classifyMessage instead
 */
export function hasSoftDraftIndicators(message: string): boolean {
  // Intentionally returns false to prevent any accidental mode switching
  // based on keyword matching. Use explicit commands only.
  console.warn('[Message Classifier] hasSoftDraftIndicators is deprecated and always returns false');
  return false;
}
