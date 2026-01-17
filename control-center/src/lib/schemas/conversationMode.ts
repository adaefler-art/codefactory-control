/**
 * Conversation Mode Schema v1
 * 
 * V09-I01: Session Conversation Mode (FREE vs DRAFTING) + Persistenz
 * 
 * Defines the deterministic contract for INTENT session conversation modes.
 * Mode controls tool gating and UX behavior.
 */

import { z } from 'zod';

/**
 * Active Conversation Mode Schema Versions
 */
export const ACTIVE_CONVERSATION_MODE_VERSIONS = ['1.0.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedConversationModeVersion = typeof ACTIVE_CONVERSATION_MODE_VERSIONS[number];

/**
 * Conversation Mode Version
 * Current version: 1.0.0
 */
export const CONVERSATION_MODE_VERSION: AllowedConversationModeVersion = '1.0.0';

/**
 * Conversation Mode Values (I903: DISCUSS/DRAFTING/ACT)
 * - DISCUSS: Free planning and discussion, no auto-drafting, draft-mutating tools blocked
 * - DRAFTING: Structured drafting mode, schema-guided but not validated yet
 * - ACT: Validation and write operations, commits, publishes
 * 
 * Note: 'FREE' is accepted for backward compatibility but is not a first-class mode.
 * It will be normalized to 'DISCUSS' by the application layer.
 * 
 * This array is the canonical list used by:
 * - Zod schema (server validation)
 * - DB constraint (chk_intent_session_conversation_mode)
 * - Client typing/validation
 */
export const INTENT_CONVERSATION_MODES = ['DISCUSS', 'DRAFTING', 'ACT', 'FREE'] as const;

/**
 * Zod enum derived from INTENT_CONVERSATION_MODES
 */
export const ConversationModeEnum = z.enum(INTENT_CONVERSATION_MODES);

export type ConversationMode = z.infer<typeof ConversationModeEnum>;

/**
 * Normalize mode values for backward compatibility
 * FREE → DISCUSS
 */
export function normalizeConversationMode(mode: string): ConversationMode {
  if (mode === 'FREE') return 'DISCUSS';
  return mode as ConversationMode;
}

/**
 * Conversation Mode Response Schema V1
 * Deterministic API response format
 */
export const ConversationModeResponseV1Schema = z.object({
  version: z.enum(ACTIVE_CONVERSATION_MODE_VERSIONS as unknown as [string, ...string[]]),
  mode: ConversationModeEnum,
  updatedAt: z.string().datetime(),
});

export type ConversationModeResponseV1 = z.infer<typeof ConversationModeResponseV1Schema>;

/**
 * Conversation Mode Update Request Schema
 * Input validation for PUT requests
 */
export const ConversationModeUpdateRequestSchema = z.object({
  mode: ConversationModeEnum,
});

export type ConversationModeUpdateRequest = z.infer<typeof ConversationModeUpdateRequestSchema>;

/**
 * Default conversation mode for new sessions
 */
export const DEFAULT_CONVERSATION_MODE: ConversationMode = 'DISCUSS';
