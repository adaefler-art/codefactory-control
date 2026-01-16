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
 * Conversation Mode Values
 * - FREE: Default mode, unrestricted conversation
 * - DRAFTING: Focused mode for issue/CR drafting with tool restrictions
 */
export const ConversationModeEnum = z.enum(['FREE', 'DRAFTING']);

export type ConversationMode = z.infer<typeof ConversationModeEnum>;

/**
 * Conversation Mode Response Schema V1
 * Deterministic API response format
 */
export const ConversationModeResponseV1Schema = z.object({
  version: z.literal(CONVERSATION_MODE_VERSION),
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
export const DEFAULT_CONVERSATION_MODE: ConversationMode = 'FREE';
