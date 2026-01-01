/**
 * Context Pack Schema v1
 * 
 * Defines the auditable JSON snapshot structure for INTENT sessions.
 * Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
 * Issue E73.4: Context Pack Storage/Retrieval (versioning, immutable snapshots)
 * 
 * NON-NEGOTIABLES:
 * - Deterministic output: same DB state → identical JSON
 * - Evidence-friendly: include used_sources hashes and references
 * - No secrets/tokens in output
 * - Context packs are immutable snapshots
 * - Versioning: contextPackVersion stored and queryable
 */

import { z } from 'zod';
import { UsedSourcesSchema } from './usedSources';

/**
 * Active Context Pack Schema Versions
 * 
 * Registry of allowed schema versions for governance-grade immutability.
 * Only these versions are accepted when generating or validating context packs.
 * 
 * Issue E73.4: Versioning rules enforcement
 */
export const ACTIVE_CONTEXT_PACK_VERSIONS = ['0.7.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedVersion = typeof ACTIVE_CONTEXT_PACK_VERSIONS[number];

/**
 * Context Pack Version
 * Current version: 0.7.0
 */
export const CONTEXT_PACK_VERSION: AllowedVersion = '0.7.0';

/**
 * Session metadata in context pack
 */
export const ContextPackSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string().datetime(), // ISO 8601
  updatedAt: z.string().datetime(), // ISO 8601
});

export type ContextPackSession = z.infer<typeof ContextPackSessionSchema>;

/**
 * Message in context pack
 */
export const ContextPackMessageSchema = z.object({
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.string().datetime(), // ISO 8601
  used_sources: UsedSourcesSchema.nullable().optional(),
  used_sources_hash: z.string().nullable().optional(),
});

export type ContextPackMessage = z.infer<typeof ContextPackMessageSchema>;

/**
 * Derived metadata computed from the pack
 */
export const ContextPackDerivedSchema = z.object({
  sessionHash: z.string(), // SHA256 of canonical pack (excluding generatedAt)
  messageCount: z.number().int().nonnegative(),
  sourcesCount: z.number().int().nonnegative(),
});

export type ContextPackDerived = z.infer<typeof ContextPackDerivedSchema>;

/**
 * Complete Context Pack schema
 * 
 * Issue E73.4: Enforces version validation via Zod enum
 */
export const ContextPackSchema = z.object({
  contextPackVersion: z.enum(ACTIVE_CONTEXT_PACK_VERSIONS as unknown as [string, ...string[]]),
  generatedAt: z.string().datetime(), // ISO 8601
  session: ContextPackSessionSchema,
  messages: z.array(ContextPackMessageSchema),
  derived: ContextPackDerivedSchema,
  warnings: z.array(z.string()).optional(),
});

export type ContextPack = z.infer<typeof ContextPackSchema>;

/**
 * Database record for context packs
 */
export interface ContextPackRecord {
  id: string;
  session_id: string;
  created_at: string;
  pack_json: ContextPack;
  pack_hash: string;
  version: string;
}

/**
 * Context Pack Metadata (without full pack_json)
 * 
 * Used for list responses to avoid sending large pack_json payloads.
 * Issue E73.4: Retrieval UX - metadata-only responses
 */
export interface ContextPackMetadata {
  id: string;
  session_id: string;
  created_at: string;
  pack_hash: string;
  version: string;
  message_count?: number;
  sources_count?: number;
}

/**
 * Example Context Pack for documentation
 */
export const EXAMPLE_CONTEXT_PACK: ContextPack = {
  contextPackVersion: CONTEXT_PACK_VERSION,
  generatedAt: '2026-01-01T12:00:00.000Z',
  session: {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Example Session',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T11:30:00.000Z',
  },
  messages: [
    {
      seq: 1,
      role: 'user',
      content: 'Hello, how can you help me?',
      createdAt: '2026-01-01T10:00:01.000Z',
    },
    {
      seq: 2,
      role: 'assistant',
      content: 'I can help you with INTENT console operations.',
      createdAt: '2026-01-01T10:00:02.000Z',
      used_sources: [
        {
          kind: 'file_snippet',
          repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
          branch: 'main',
          path: 'control-center/app/intent/page.tsx',
          startLine: 1,
          endLine: 50,
          snippetHash: 'abc123',
        },
      ],
      used_sources_hash: 'a1b2c3d4e5f6...',
    },
  ],
  derived: {
    sessionHash: '1234567890abcdef...',
    messageCount: 2,
    sourcesCount: 1,
  },
  warnings: [],
};
