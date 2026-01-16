/**
 * INTENT Tool Registry
 *
 * Single source of truth for:
 * - OpenAI function-calling tool definitions
 * - Capability list rendered into the system prompt
 * - Tool gating ("disabled by gate" reasons)
 *
 * IMPORTANT: Tools do NOT take sessionId as parameter!
 * Session ID comes from request context, not from LLM.
 */

import type OpenAI from 'openai';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { isProdEnabled, getProdDisabledReason } from '@/lib/utils/prod-control';

export interface IntentToolContext {
  userId: string;
  sessionId: string;
}

export type ToolGateStatus =
  | { enabled: true }
  | { enabled: false; reason: string; code?: string };

export interface IntentToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  gate?: (context: IntentToolContext) => ToolGateStatus;
  isDraftMutating?: boolean; // V09-I02: Mark tools that mutate draft state
}

function gateProdWriteDisabled(_context: IntentToolContext): ToolGateStatus {
  const env = getDeploymentEnv();
  if (env !== 'production') return { enabled: true };
  if (isProdEnabled()) return { enabled: true };
  return {
    enabled: false,
    code: 'PROD_DISABLED',
    reason: getProdDisabledReason(),
  };
}

export function listIntentToolSpecs(): IntentToolSpec[] {
  return [
    {
      name: 'get_context_pack',
      description:
        'Get the Context Pack for the current INTENT session. Contains messages, used sources, and metadata. Use when user asks to see context or session data.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },

    // E75.x (CR pipeline)
    {
      name: 'get_change_request',
      description:
        'Get the current Change Request draft for this session. Returns CR JSON if it exists, null otherwise. Use when user asks "siehst du den Change Request?" or "zeige CR".',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'save_change_request',
      description:
        'Save or update the Change Request draft for this session. Does NOT validate or publish. Use when user wants to create/modify CR.',
      parameters: {
        type: 'object',
        properties: {
          crJson: {
            type: 'object',
            description: 'The Change Request JSON (ChangeRequestV1-like) to save',
          },
        },
        required: ['crJson'],
      },
      isDraftMutating: true, // V09-I02: Mutates CR draft state
    },
    {
      name: 'validate_change_request',
      description:
        'Validate a Change Request against schema. Returns validation result with errors/warnings. Use before publishing.',
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
      isDraftMutating: true, // V09-I02: Mutates CR draft state (saves validated version)
    },
    {
      name: 'publish_to_github',
      description:
        'Publish the current validated Change Request to GitHub as an issue. Idempotent: creates new issue or updates existing based on canonicalId. ALWAYS validate first.',
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
      gate: gateProdWriteDisabled,
    },

    // E81.x (Issue Draft / Issue Set)
    {
      name: 'get_issue_draft_summary',
      description:
        'Get a compact summary of the current Issue Draft for this session. Returns: exists (boolean), canonicalId, title, updatedAt, validationStatus (VALID|INVALID|UNKNOWN), bodyHash (first 12 chars). Use this for quick draft awareness in conversation. Returns exists:false with reason:"NO_DRAFT" when no draft exists (not an error).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'get_issue_draft',
      description:
        'Get the current Issue Draft for this session (session-bound). Returns full issue JSON + validation status, or null if none exists. Use when you need the complete draft details.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'save_issue_draft',
      description:
        'Save or update the Issue Draft for this session (session-bound). Does NOT validate; stores draft as-is. Use before validate_issue_draft when creating a new draft.',
      parameters: {
        type: 'object',
        properties: {
          issueJson: {
            type: 'object',
            description: 'The Issue Draft JSON to save',
          },
        },
        required: ['issueJson'],
      },
      isDraftMutating: true, // V09-I02: Mutates issue draft state
    },
    {
      name: 'apply_issue_draft_patch',
      description:
        'Apply a partial update (patch) to the existing Issue Draft. Use this for targeted changes instead of replacing the entire draft. IMPORTANT: Do NOT output the full schema after patching - just confirm what changed. For arrays: {op: "append", values: ["..."]} or {op: "remove", values: [...]}} or {op: "replaceAll", values: [...]}. Example: {acceptanceCriteria: {op: "append", values: ["New AC"]}}. Returns minimal diff summary.',
      parameters: {
        type: 'object',
        properties: {
          patch: {
            type: 'object',
            description: 'Partial update object with only fields to change. Supports: title (string), body (string), labels (array or operation), dependsOn (array or operation), priority (P0|P1|P2), acceptanceCriteria (array or operation), kpi (object), guards (object), verify (object). For arrays, use direct replacement or operations: {op: "append", values: [...]} | {op: "remove", values: [...]} | {op: "replaceAll", values: [...]}',
          },
          validateAfterUpdate: {
            type: 'boolean',
            description: 'Whether to validate the draft after applying the patch (default: false)',
            default: false,
          },
        },
        required: ['patch'],
      },
      isDraftMutating: true, // V09-I02: Mutates issue draft state
    },
    {
      name: 'validate_issue_draft',
      description:
        'Validate and save the Issue Draft for this session. Returns validation result with deterministic ordering. Use to fix missing fields until valid.',
      parameters: {
        type: 'object',
        properties: {
          issueJson: {
            type: 'object',
            description: 'The Issue Draft JSON to validate and save',
          },
        },
        required: ['issueJson'],
      },
      isDraftMutating: true, // V09-I02: Mutates issue draft state (saves validated version)
    },
    {
      name: 'commit_issue_draft',
      description:
        'Commit the current Issue Draft as an immutable version. Requires last validation status to be valid (fail-closed).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      isDraftMutating: true, // V09-I02: Mutates issue draft state (creates version)
    },
    {
      name: 'get_issue_set',
      description:
        'Get the latest Issue Set for this session, including items and summary. Returns null if none exists.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'generate_issue_set',
      description:
        'Generate a new Issue Set from briefingText and an array of issueDrafts. Stores set and items; returns summary.',
      parameters: {
        type: 'object',
        properties: {
          briefingText: { type: 'string', description: 'Briefing text input (max ~50k chars recommended)' },
          issueDrafts: {
            type: 'array',
            description: 'Array of IssueDraft items to include (max 20) - each should have canonicalId',
            items: { type: 'object' },
          },
          constraints: {
            type: 'object',
            description: 'Optional constraints (free-form object)',
          },
        },
        required: ['briefingText', 'issueDrafts'],
      },
      isDraftMutating: true, // V09-I02: Mutates issue set state
    },
    {
      name: 'commit_issue_set',
      description:
        'Commit the current Issue Set (make immutable). Only allowed if all items are valid.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      isDraftMutating: true, // V09-I02: Mutates issue set state (makes immutable)
    },
    {
      name: 'export_issue_set_markdown',
      description:
        'Export the current Issue Set to AFU-9 Markdown format. Returns markdown string and summary metadata.',
      parameters: {
        type: 'object',
        properties: {
          includeInvalid: {
            type: 'boolean',
            description: 'Include invalid items in markdown export (default: false)',
            default: false,
          },
        },
        required: [],
      },
    },

    // E89.3 - Evidence Tool: readFile
    {
      name: 'readFile',
      description:
        'Read file content from a GitHub repository with evidence tracking. Supports line ranges, size limits (max 256KB), and returns deterministic SHA-256 hash. Use for reading source code, docs, or config files. Enforces allowlist policy.',
      parameters: {
        type: 'object',
        properties: {
          owner: {
            type: 'string',
            description: 'Repository owner (e.g., "adaefler-art")',
          },
          repo: {
            type: 'string',
            description: 'Repository name (e.g., "codefactory-control")',
          },
          ref: {
            type: 'string',
            description: 'Branch, tag, or commit SHA (default: "main")',
            default: 'main',
          },
          path: {
            type: 'string',
            description: 'File path (e.g., "src/lib/utils.ts")',
          },
          startLine: {
            type: 'number',
            description: 'Start line number (1-indexed, optional)',
          },
          endLine: {
            type: 'number',
            description: 'End line number (1-indexed, optional, must be >= startLine)',
          },
          maxBytes: {
            type: 'number',
            description: 'Maximum bytes to return (default: 256KB, max: 256KB)',
            default: 256 * 1024,
          },
        },
        required: ['owner', 'repo', 'path'],
      },
    },

    // E89.4 - Evidence Tool: searchCode
    {
      name: 'searchCode',
      description:
        'Search code in a GitHub repository with evidence tracking. Enforces query constraints (max 200 chars, no wildcards), bounded results (max 50), deterministic ordering (path, then sha), and returns SHA-256 hash of results. Use for finding code patterns, functions, or specific text. Enforces allowlist policy.',
      parameters: {
        type: 'object',
        properties: {
          owner: {
            type: 'string',
            description: 'Repository owner (e.g., "adaefler-art")',
          },
          repo: {
            type: 'string',
            description: 'Repository name (e.g., "codefactory-control")',
          },
          ref: {
            type: 'string',
            description: 'Branch, tag, or commit SHA (default: "main")',
            default: 'main',
          },
          query: {
            type: 'string',
            description: 'Search query (max 200 chars, no wildcards-only like "*" or "**")',
          },
          path: {
            type: 'string',
            description: 'Optional path prefix filter (e.g., "src/lib")',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum results to return (default: 20, max: 50)',
            default: 20,
          },
        },
        required: ['owner', 'repo', 'query'],
      },
    },
  ];
}

export function getToolGateStatus(toolName: string, context: IntentToolContext): ToolGateStatus {
  const spec = listIntentToolSpecs().find(t => t.name === toolName);
  if (!spec) return { enabled: true };
  if (!spec.gate) return { enabled: true };
  return spec.gate(context);
}

/**
 * Check if a tool is draft-mutating
 * V09-I02: Used for tool gating in FREE mode
 */
export function isDraftMutatingTool(toolName: string): boolean {
  const spec = listIntentToolSpecs().find(t => t.name === toolName);
  return spec?.isDraftMutating === true;
}

export function buildOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
  return listIntentToolSpecs().map(spec => ({
    type: 'function',
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  }));
}

export function renderIntentToolCapabilities(context: IntentToolContext): string {
  const lines: string[] = [];
  for (const spec of listIntentToolSpecs()) {
    const gate = getToolGateStatus(spec.name, context);
    if (gate.enabled) {
      lines.push(`- ${spec.name}: ${spec.description}`);
    } else {
      const code = gate.code ? ` (${gate.code})` : '';
      lines.push(`- ${spec.name}: ${spec.description} [DISABLED${code}: ${gate.reason}]`);
    }
  }
  return lines.join('\n');
}
