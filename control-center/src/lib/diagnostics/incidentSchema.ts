/**
 * Incident Evidence Pack Schema and Types
 * 
 * Versioned schema for INTENT authoring incident evidence collection.
 * This module provides TypeScript types and Zod validation for the Evidence Pack.
 */

import { z } from 'zod';

/**
 * Evidence Pack Schema Version
 */
export const EVIDENCE_PACK_VERSION = '1.0.0';

/**
 * HTTP Methods
 */
export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

/**
 * Log Levels
 */
export const LogLevelSchema = z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Environment Types
 */
export const EnvironmentSchema = z.enum(['development', 'staging', 'production']);
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * INTENT Session Modes
 */
export const SessionModeSchema = z.enum(['DRAFTING', 'DISCUSS']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/**
 * Network Trace Endpoint Pattern
 */
export const EndpointPatternSchema = z.object({
  pattern: z.string().describe('Endpoint pattern (e.g., /api/intent/sessions/:id/issue-draft)'),
  method: HttpMethodSchema,
  statusCounts: z.record(z.string(), z.number().int().min(0)).describe('HTTP status code counts'),
});
export type EndpointPattern = z.infer<typeof EndpointPatternSchema>;

/**
 * Network Trace Summary
 */
export const NetworkTraceSummarySchema = z.object({
  endpointPatterns: z.array(EndpointPatternSchema).optional(),
}).optional();
export type NetworkTraceSummary = z.infer<typeof NetworkTraceSummarySchema>;

/**
 * API Request/Response Snippet
 */
export const ApiSnippetSchema = z.object({
  endpoint: z.string(),
  method: z.string(),
  status: z.number().int(),
  requestSnippet: z.record(z.any()).optional().describe('Sanitized request data'),
  responseSnippet: z.record(z.any()).optional().describe('Sanitized response data'),
  timestamp: z.string().datetime().optional(),
});
export type ApiSnippet = z.infer<typeof ApiSnippetSchema>;

/**
 * Server Log Reference
 */
export const ServerLogRefSchema = z.object({
  requestId: z.string().optional(),
  logLevel: LogLevelSchema.optional(),
  message: z.string().describe('Sanitized log message'),
  timestamp: z.string().datetime().optional(),
});
export type ServerLogRef = z.infer<typeof ServerLogRefSchema>;

/**
 * Incident Evidence Pack
 * 
 * Main evidence collection structure for debugging INTENT authoring incidents.
 */
export const IncidentEvidencePackSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_PACK_VERSION).describe('Evidence pack schema version'),
  incidentId: z.string().regex(/^INC-\d{4}-\d{6}$/).describe('Unique incident identifier'),
  createdAt: z.string().datetime().describe('ISO 8601 timestamp'),
  env: EnvironmentSchema.describe('Environment where incident occurred'),
  deployedVersion: z.string().optional().describe('Deployed version or build SHA'),
  sessionId: z.string().describe('INTENT session identifier'),
  mode: SessionModeSchema.describe('INTENT session mode'),
  requestIds: z.array(z.string()).optional().describe('Request IDs involved'),
  networkTraceSummary: NetworkTraceSummarySchema,
  apiSnippets: z.array(ApiSnippetSchema).max(10).optional().describe('Sanitized API snippets (max 10)'),
  serverLogRefs: z.array(ServerLogRefSchema).optional().describe('Server log references'),
  notes: z.string().max(1000).optional().describe('Operator notes'),
});

export type IncidentEvidencePack = z.infer<typeof IncidentEvidencePackSchema>;

/**
 * Validate an evidence pack
 * 
 * @param data - The data to validate
 * @returns Validated evidence pack
 * @throws ZodError if validation fails
 */
export function validateEvidencePack(data: unknown): IncidentEvidencePack {
  return IncidentEvidencePackSchema.parse(data);
}

/**
 * Safe validate with error handling
 * 
 * @param data - The data to validate
 * @returns Validation result with success flag
 */
export function safeValidateEvidencePack(data: unknown): {
  success: boolean;
  data?: IncidentEvidencePack;
  error?: string;
} {
  const result = IncidentEvidencePackSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { 
      success: false, 
      error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ') 
    };
  }
}

/**
 * Redact sensitive data from evidence pack
 * 
 * Strips authorization headers, cookies, tokens from snippets.
 * 
 * @param pack - Evidence pack to redact
 * @returns Redacted evidence pack
 */
export function redactEvidencePack(pack: IncidentEvidencePack): IncidentEvidencePack {
  const redacted = { ...pack };
  
  if (redacted.apiSnippets) {
    redacted.apiSnippets = redacted.apiSnippets.map(snippet => {
      const redactedSnippet = { ...snippet };
      
      // Redact sensitive fields from request
      if (redactedSnippet.requestSnippet) {
        const req = { ...redactedSnippet.requestSnippet };
        delete req.authorization;
        delete req.Authorization;
        delete req.cookie;
        delete req.Cookie;
        delete req.token;
        delete req.apiKey;
        redactedSnippet.requestSnippet = req;
      }
      
      // Redact sensitive fields from response
      if (redactedSnippet.responseSnippet) {
        const res = { ...redactedSnippet.responseSnippet };
        delete res.token;
        delete res.apiKey;
        delete res.sessionToken;
        redactedSnippet.responseSnippet = res;
      }
      
      return redactedSnippet;
    });
  }
  
  return redacted;
}
