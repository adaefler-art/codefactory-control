/**
 * OpenAI Function Calling Tool Definitions for INTENT Agent
 * 
 * CRITICAL: Tools do NOT take sessionId as parameter!
 * Session ID comes from request context, not from LLM.
 * 
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 */

import type OpenAI from 'openai';

/**
 * OpenAI Function Calling Tool Definitions for INTENT Agent
 * 
 * CRITICAL: Tools do NOT take sessionId as parameter!
 * Session ID comes from request context, not from LLM.
 * 
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 */
export const INTENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_context_pack',
      description: 'Get the Context Pack for the current INTENT session. Contains all messages, used sources, and metadata. Use this when user asks to see context or session data.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_change_request',
      description: 'Get the current Change Request draft for this session. Returns CR JSON if exists, null otherwise. Use when user asks "siehst du den Change Request?" or "zeige CR".',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_change_request',
      description: 'Save or update the Change Request draft for this session. Does NOT validate or publish. Use when user wants to create/modify CR.',
      parameters: {
        type: 'object',
        properties: {
          crJson: {
            type: 'object',
            description: 'The Change Request JSON conforming to ChangeRequestV1 schema',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              type: { type: 'string', enum: ['feature', 'bugfix', 'refactor', 'docs', 'test', 'chore'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              repository: { type: 'string' },
            },
            required: ['title', 'description', 'type', 'repository'],
          },
        },
        required: ['crJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_change_request',
      description: 'Validate a Change Request against the ChangeRequestV1 schema. Returns validation result with errors/warnings. Use before publishing.',
      parameters: {
        type: 'object',
        properties: {
          crJson: {
            type: 'object',
            description: 'The Change Request JSON to validate',
          },
        },
        required: ['crJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_to_github',
      description: 'Publish the Change Request to GitHub as an issue. Idempotent: creates new issue or updates existing based on canonicalId. ALWAYS validate CR first!',
      parameters: {
        type: 'object',
        properties: {
          preferDraft: {
            type: 'boolean',
            description: 'Use draft CR instead of latest committed version (default: false)',
            default: false,
          },
        },
        required: [],
      },
    },
  },
];
