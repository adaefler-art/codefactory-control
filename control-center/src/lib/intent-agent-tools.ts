/**
 * OpenAI Function Calling Tool Definitions for INTENT Agent
 * 
 * Issue: Verdrahte INTENT mit AFU-9 (Tools + CR Pipeline)
 * 
 * Provides tool definitions for OpenAI Function Calling to enable INTENT
 * to interact with Context Packs, Change Requests, and GitHub Publishing.
 */

import type OpenAI from 'openai';

/**
 * OpenAI Function Calling Tool Definitions
 * 
 * These tools allow INTENT to:
 * - Retrieve Context Packs for session audit/replay
 * - Get/Save/Validate Change Requests
 * - Publish Change Requests to GitHub as issues
 */
export const INTENT_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_context_pack',
      description: 'Get a Context Pack for the current INTENT session. Contains messages, sources, and metadata.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The INTENT session ID',
          },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_change_request',
      description: 'Get the current Change Request draft for the session. Returns CR JSON if exists, null otherwise.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The INTENT session ID',
          },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_change_request',
      description: 'Save or update the Change Request draft for the session. Does NOT validate or publish.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The INTENT session ID',
          },
          crJson: {
            type: 'object',
            description: 'The Change Request JSON (must conform to ChangeRequestV1 schema)',
          },
        },
        required: ['sessionId', 'crJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_change_request',
      description: 'Validate a Change Request against the schema. Returns validation result with errors/warnings.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The INTENT session ID',
          },
          crJson: {
            type: 'object',
            description: 'The Change Request JSON to validate',
          },
        },
        required: ['sessionId', 'crJson'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publish_to_github',
      description: 'Publish the Change Request to GitHub as an issue. Idempotent: creates new issue or updates existing based on canonicalId.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'The INTENT session ID',
          },
          preferDraft: {
            type: 'boolean',
            description: 'Use draft CR instead of latest committed version (default: false)',
          },
        },
        required: ['sessionId'],
      },
    },
  },
];
