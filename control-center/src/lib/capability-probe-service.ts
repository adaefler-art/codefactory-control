/**
 * Capability Probe Service (E89.8)
 * 
 * Probes MCP endpoints and tool health to populate capability registry.
 * Results stored in append-only audit log (afu9_capability_probes).
 * 
 * Features:
 * - Read-only health checks (no mutations)
 * - Bounded error messages (max 500 chars)
 * - Timeout handling (max 5 seconds per probe)
 * - Audit trail for compliance
 * 
 * Security:
 * - Only reads from MCP endpoints
 * - No secrets in probe results
 * - Staging-only for POST /api/ops/capabilities/probe
 */

import { Pool } from 'pg';
import { getMCPClient } from './mcp-client';
import { listIntentToolSpecs, getToolGateStatus, type IntentToolContext } from './intent-tool-registry';
import { getMCPServersFromCatalog } from './mcp-catalog';
import { FLAGS_CATALOG } from './flags-env-catalog';

/**
 * Probe result for a single capability
 */
export interface ProbeResult {
  capabilityName: string;
  capabilityKind: 'tool' | 'mcp_tool' | 'feature_flag' | 'constraint';
  capabilitySource: 'intent_registry' | 'mcp' | 'flags' | 'lawbook';
  probeStatus: 'ok' | 'error' | 'timeout' | 'unreachable';
  responseTimeMs?: number;
  errorMessage?: string;
  errorCode?: string;
  enabled: boolean;
  requiresApproval: boolean;
  version?: string;
}

/**
 * Probe summary
 */
export interface ProbeSummary {
  totalProbed: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  unreachableCount: number;
  probedAt: string;
}

/**
 * Probe all capabilities and store results
 * 
 * @param pool Database connection pool
 * @param context User context for gate evaluation
 * @returns Probe summary
 */
export async function probeAllCapabilities(
  pool: Pool,
  context: IntentToolContext
): Promise<ProbeSummary> {
  const results: ProbeResult[] = [];
  const probedAt = new Date().toISOString();

  // 1. Probe INTENT tools (logical health - no network calls)
  const intentTools = listIntentToolSpecs();
  for (const tool of intentTools) {
    const startTime = Date.now();
    try {
      const gateStatus = getToolGateStatus(tool.name, context);
      const responseTimeMs = Date.now() - startTime;

      results.push({
        capabilityName: tool.name,
        capabilityKind: 'tool',
        capabilitySource: 'intent_registry',
        probeStatus: 'ok', // Tools are always available (logical entities)
        responseTimeMs,
        enabled: gateStatus.enabled,
        requiresApproval: tool.gate !== undefined,
        version: undefined, // Intent tools don't have explicit versions
      });
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;
      results.push({
        capabilityName: tool.name,
        capabilityKind: 'tool',
        capabilitySource: 'intent_registry',
        probeStatus: 'error',
        responseTimeMs,
        errorMessage: truncateError(error instanceof Error ? error.message : String(error)),
        enabled: false,
        requiresApproval: tool.gate !== undefined,
      });
    }
  }

  // 2. Probe MCP servers (network health checks)
  const mcpClient = getMCPClient();
  const mcpServers = getMCPServersFromCatalog();

  for (const server of mcpServers) {
    for (const tool of server.tools || []) {
      const capabilityName = `${server.name}.${tool.name}`;
      const startTime = Date.now();

      try {
        // Check server health (with timeout)
        const healthCheckPromise = mcpClient.checkHealth(server.name);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Probe timeout')), 5000)
        );

        const health = await Promise.race([healthCheckPromise, timeoutPromise]);
        const responseTimeMs = Date.now() - startTime;

        let probeStatus: ProbeResult['probeStatus'] = 'ok';
        let errorMessage: string | undefined;

        if (health.status === 'error') {
          probeStatus = 'error';
          errorMessage = truncateError(health.error || 'MCP server returned error status');
        } else if (health.status !== 'ok') {
          probeStatus = 'unreachable';
          errorMessage = truncateError(`Unknown health status: ${health.status}`);
        }

        results.push({
          capabilityName,
          capabilityKind: 'mcp_tool',
          capabilitySource: 'mcp',
          probeStatus,
          responseTimeMs,
          errorMessage,
          enabled: probeStatus === 'ok', // Only enabled if server is healthy
          requiresApproval: false, // MCP tools don't have approval gates (yet)
          version: tool.contractVersion,
        });
      } catch (error) {
        const responseTimeMs = Date.now() - startTime;
        const isTimeout = error instanceof Error && error.message.includes('timeout');

        results.push({
          capabilityName,
          capabilityKind: 'mcp_tool',
          capabilitySource: 'mcp',
          probeStatus: isTimeout ? 'timeout' : 'unreachable',
          responseTimeMs,
          errorMessage: truncateError(error instanceof Error ? error.message : String(error)),
          enabled: false,
          requiresApproval: false,
          version: tool.contractVersion,
        });
      }
    }
  }

  // 3. Probe feature flags (logical - always available)
  for (const flag of FLAGS_CATALOG.flags) {
    const startTime = Date.now();
    const responseTimeMs = Date.now() - startTime;

    results.push({
      capabilityName: flag.key,
      capabilityKind: 'feature_flag',
      capabilitySource: 'flags',
      probeStatus: 'ok', // Flags are always available (config values)
      responseTimeMs,
      enabled: flag.defaultValue !== false && flag.defaultValue !== 'false',
      requiresApproval: false,
      version: undefined,
    });
  }

  // 4. Store all results in append-only table
  await storeProbeResults(pool, results);

  // 5. Compute summary
  const summary: ProbeSummary = {
    totalProbed: results.length,
    successCount: results.filter(r => r.probeStatus === 'ok').length,
    errorCount: results.filter(r => r.probeStatus === 'error').length,
    timeoutCount: results.filter(r => r.probeStatus === 'timeout').length,
    unreachableCount: results.filter(r => r.probeStatus === 'unreachable').length,
    probedAt,
  };

  return summary;
}

/**
 * Store probe results in database (append-only)
 * 
 * @param pool Database connection pool
 * @param results Probe results to store
 */
async function storeProbeResults(pool: Pool, results: ProbeResult[]): Promise<void> {
  if (results.length === 0) return;

  // Batch insert all results
  const values: unknown[] = [];
  const placeholders: string[] = [];

  results.forEach((result, idx) => {
    const offset = idx * 10;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
    );

    values.push(
      result.capabilityName,
      result.capabilityKind,
      result.capabilitySource,
      result.probeStatus,
      result.responseTimeMs ?? null,
      result.errorMessage ?? null,
      result.errorCode ?? null,
      result.enabled,
      result.requiresApproval,
      result.version ?? null
    );
  });

  const query = `
    INSERT INTO afu9_capability_probes (
      capability_name,
      capability_kind,
      capability_source,
      probe_status,
      response_time_ms,
      error_message,
      error_code,
      enabled,
      requires_approval,
      version
    ) VALUES ${placeholders.join(', ')}
  `;

  await pool.query(query, values);
}

/**
 * Get latest probe results from view
 * 
 * @param pool Database connection pool
 * @returns Latest probe status per capability
 */
export async function getLatestProbeResults(pool: Pool): Promise<LatestProbeResult[]> {
  const query = `
    SELECT
      capability_name,
      capability_kind,
      capability_source,
      last_probe_at,
      last_probe_status,
      last_probe_latency_ms,
      last_probe_error,
      last_probe_error_code,
      enabled,
      requires_approval,
      version
    FROM afu9_capability_manifest_view
    ORDER BY capability_name ASC
  `;

  const result = await pool.query(query);
  return result.rows.map(row => ({
    capabilityName: row.capability_name,
    capabilityKind: row.capability_kind,
    capabilitySource: row.capability_source,
    lastProbeAt: row.last_probe_at,
    lastProbeStatus: row.last_probe_status,
    lastProbeLatencyMs: row.last_probe_latency_ms,
    lastProbeError: row.last_probe_error,
    lastProbeErrorCode: row.last_probe_error_code,
    enabled: row.enabled,
    requiresApproval: row.requires_approval,
    version: row.version,
  }));
}

/**
 * Latest probe result from view
 */
export interface LatestProbeResult {
  capabilityName: string;
  capabilityKind: string;
  capabilitySource: string;
  lastProbeAt: Date;
  lastProbeStatus: string;
  lastProbeLatencyMs: number | null;
  lastProbeError: string | null;
  lastProbeErrorCode: string | null;
  enabled: boolean;
  requiresApproval: boolean;
  version: string | null;
}

/**
 * Truncate error message to max 500 characters
 */
function truncateError(message: string): string {
  const maxLength = 500;
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength - 3) + '...';
}
