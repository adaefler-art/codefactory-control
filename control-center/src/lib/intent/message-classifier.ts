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
  actionType?: 'draft_create' | 'draft_update' | 'draft_commit' | 'draft_publish' | 'cr_save' | 'cr_publish' | 'issue_set_generate' | 'issue_set_commit' | 'issue_set_publish';
  confidence: 'high' | 'low';
}

/**
 * Explicit action keywords (deterministic pattern matching)
 * 
 * IMPORTANT: Order matters! More specific patterns should come first
 * to avoid false matches (e.g., "issue set" before "issue")
 */
const ACTION_PATTERNS = {
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
 * (for logging/debugging purposes, not used for gating)
 */
export function hasSoftDraftIndicators(message: string): boolean {
  const softPatterns = [
    /\bmake\s+(an?|the)?\s*issue\b/i,
    /\bcreate\s+(an?|the)?\s*issue\b/i,
    /\bgenerate\s+(an?|the)?\s*issue\b/i,
    /\bwrite\s+(an?|the)?\s*issue\b/i,
  ];
  
  const normalized = message.trim().toLowerCase();
  return softPatterns.some(p => p.test(normalized));
}
