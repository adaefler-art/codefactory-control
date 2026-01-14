/**
 * Capability Manifest Service (E86.2)
 * 
 * Single source of truth for what INTENT can currently do.
 * Derived from:
 * - Tool Registry (intent-tool-registry.ts)
 * - MCP Catalog (docs/mcp/catalog.json)
 * - Feature Flags (flags-env-catalog.ts)
 * - Lawbook Constraints (lawbook/schema.ts)
 * 
 * Guarantees:
 * - Deterministic: Same inputs → Same hash
 * - Stable sorting: Capabilities always in same order
 * - No runtime inference: Only explicit capabilities
 * - Cacheable: Hash changes only when sources change
 */

import * as crypto from 'crypto';
import { listIntentToolSpecs, getToolGateStatus, type IntentToolContext } from './intent-tool-registry';
import { getMCPServersFromCatalog, type MCPCatalogServer } from './mcp-catalog';
import { FLAGS_CATALOG, type FlagConfig } from './flags-env-catalog';
import { getActiveLawbook } from './db/lawbook';

/**
 * Capability kind enum
 */
export type CapabilityKind = 'tool' | 'mcp_tool' | 'feature_flag' | 'constraint';

/**
 * Capability source enum
 */
export type CapabilitySource = 'intent_registry' | 'mcp' | 'flags' | 'lawbook';

/**
 * Capability constraint types
 */
export type CapabilityConstraint = 
  | 'prod_blocked'
  | 'disabled'
  | 'read_only'
  | 'auth_required'
  | 'rate_limited';

/**
 * Single capability entry
 */
export interface CapabilityEntry {
  id: string;
  kind: CapabilityKind;
  source: CapabilitySource;
  description?: string;
  constraints?: CapabilityConstraint[];
  metadata?: Record<string, unknown>;
}

/**
 * Capability manifest response
 */
export interface CapabilityManifest {
  version: string; // ISO date (YYYY-MM-DD)
  hash: string; // sha256 of sorted capabilities
  capabilities: CapabilityEntry[];
  sources: {
    intentTools: number;
    mcpTools: number;
    featureFlags: number;
    lawbookConstraints: number;
  };
}

/**
 * Build capability manifest from all sources
 * 
 * @param context - User context for gate evaluation
 * @returns Deterministic capability manifest
 */
export async function buildCapabilityManifest(
  context: IntentToolContext
): Promise<CapabilityManifest> {
  const capabilities: CapabilityEntry[] = [];

  // 1. Extract capabilities from INTENT tool registry
  const intentTools = listIntentToolSpecs();
  for (const tool of intentTools) {
    const gateStatus = getToolGateStatus(tool.name, context);
    const constraints: CapabilityConstraint[] = [];

    if (!gateStatus.enabled) {
      if ('code' in gateStatus && gateStatus.code === 'PROD_DISABLED') {
        constraints.push('prod_blocked');
      } else {
        constraints.push('disabled');
      }
    }

    // Check if tool has gate (implies constraint even if enabled)
    if (tool.gate && gateStatus.enabled) {
      // Tool has gate but is currently enabled - still mark as potentially constrained
      constraints.push('auth_required');
    }

    capabilities.push({
      id: tool.name,
      kind: 'tool',
      source: 'intent_registry',
      description: tool.description,
      constraints: constraints.length > 0 ? constraints : undefined,
      metadata: {
        hasParameters: Object.keys(tool.parameters).length > 0,
      },
    });
  }

  // 2. Extract capabilities from MCP catalog
  const mcpServers = getMCPServersFromCatalog();
  for (const server of mcpServers) {
    for (const tool of server.tools || []) {
      const constraints: CapabilityConstraint[] = [];

      // Check guardrails from catalog
      const guardrails = (tool as any).guardrails || [];
      for (const guardrail of guardrails) {
        if (guardrail.id === 'READ_ONLY') {
          constraints.push('read_only');
        }
        if (guardrail.id === 'MUTATING') {
          constraints.push('auth_required');
        }
      }

      capabilities.push({
        id: `${server.name}.${tool.name}`,
        kind: 'mcp_tool',
        source: 'mcp',
        description: tool.description,
        constraints: constraints.length > 0 ? constraints : undefined,
        metadata: {
          server: server.name,
          contractVersion: tool.contractVersion,
        },
      });
    }
  }

  // 3. Extract capabilities from feature flags
  for (const flag of FLAGS_CATALOG.flags) {
    const constraints: CapabilityConstraint[] = [];

    // Feature flags are read-only capabilities
    constraints.push('read_only');

    // Check if flag is disabled by default
    if (flag.defaultValue === false || flag.defaultValue === 'false') {
      constraints.push('disabled');
    }

    capabilities.push({
      id: flag.key,
      kind: 'feature_flag',
      source: 'flags',
      description: flag.description,
      constraints: constraints.length > 0 ? constraints : undefined,
      metadata: {
        type: flag.type,
        riskClass: flag.riskClass,
        required: flag.required,
      },
    });
  }

  // 4. Extract constraints from active lawbook (if available)
  try {
    const lawbookResult = await getActiveLawbook();
    if (lawbookResult.success && lawbookResult.data) {
      const lawbook = lawbookResult.data.lawbook_json;

      // Add remediation constraints
      if (lawbook.remediation) {
        capabilities.push({
          id: 'lawbook.remediation',
          kind: 'constraint',
          source: 'lawbook',
          description: `Remediation enabled: ${lawbook.remediation.enabled}`,
          constraints: lawbook.remediation.enabled ? undefined : ['disabled'],
          metadata: {
            allowedPlaybooks: lawbook.remediation.allowedPlaybooks || [],
            allowedActions: lawbook.remediation.allowedActions || [],
            maxRunsPerIncident: lawbook.remediation.maxRunsPerIncident,
          },
        });
      }

      // Add execution constraints
      if (lawbook.execution) {
        capabilities.push({
          id: 'lawbook.execution',
          kind: 'constraint',
          source: 'lawbook',
          description: 'Execution constraints from lawbook',
          metadata: {
            allowAutoAssign: lawbook.execution.allowAutoAssign,
            allowManualDispatch: lawbook.execution.allowManualDispatch,
          },
        });
      }

      // Add quality constraints
      if (lawbook.quality) {
        capabilities.push({
          id: 'lawbook.quality',
          kind: 'constraint',
          source: 'lawbook',
          description: 'Quality constraints from lawbook',
          metadata: {
            allowPartialSuccess: lawbook.quality.allowPartialSuccess,
            requireApproval: lawbook.quality.requireApproval,
          },
        });
      }
    }
  } catch (error) {
    console.warn('[CapabilityManifest] Failed to load lawbook constraints:', error);
    // Continue without lawbook constraints - non-fatal
  }

  // Sort capabilities deterministically by id
  capabilities.sort((a, b) => a.id.localeCompare(b.id));

  // Compute hash over entire sorted capability list
  const hash = computeCapabilityHash(capabilities);

  // Count sources
  const sources = {
    intentTools: capabilities.filter(c => c.source === 'intent_registry').length,
    mcpTools: capabilities.filter(c => c.source === 'mcp').length,
    featureFlags: capabilities.filter(c => c.source === 'flags').length,
    lawbookConstraints: capabilities.filter(c => c.source === 'lawbook').length,
  };

  return {
    version: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    hash,
    capabilities,
    sources,
  };
}

/**
 * Compute deterministic SHA256 hash of capabilities
 * 
 * @param capabilities - Sorted capability entries
 * @returns SHA256 hash (hex)
 */
function computeCapabilityHash(capabilities: CapabilityEntry[]): string {
  // Create deterministic JSON string (sorted keys, no whitespace)
  const normalized = JSON.stringify(capabilities, Object.keys(capabilities).sort());
  
  // Compute SHA256
  const hash = crypto.createHash('sha256');
  hash.update(normalized);
  
  return `sha256:${hash.digest('hex')}`;
}
