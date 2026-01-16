/**
 * used_sources Contract: Types and Schemas
 * 
 * Defines the evidence/provenance contract for INTENT assistant messages.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * NON-NEGOTIABLES:
 * - Evidence-first: every assistant message can include used_sources
 * - Determinism: stable ordering of sources; deduplicate deterministically
 * - No token exposure; server-side only
 * - Compact display: store refs + hashes/snippet hashes, not full content
 */

import { z } from 'zod';

// ========================================
// Repository Reference (shared by multiple source types)
// ========================================
export const RepoRefSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;

// ========================================
// SourceRef Type: file_snippet
// ========================================
export const FileSnippetSourceSchema = z.object({
  kind: z.literal('file_snippet'),
  repo: RepoRefSchema,
  branch: z.string().min(1),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  snippetHash: z.string().min(1), // Short hash of snippet content
  contentSha256: z.string().optional(), // Full file SHA256
});

export type FileSnippetSource = z.infer<typeof FileSnippetSourceSchema>;

// ========================================
// SourceRef Type: github_issue
// ========================================
export const GitHubIssueSourceSchema = z.object({
  kind: z.literal('github_issue'),
  repo: RepoRefSchema,
  number: z.number().int().positive(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  updatedAt: z.string().optional(), // ISO 8601 timestamp
});

export type GitHubIssueSource = z.infer<typeof GitHubIssueSourceSchema>;

// ========================================
// SourceRef Type: github_pr
// ========================================
export const GitHubPRSourceSchema = z.object({
  kind: z.literal('github_pr'),
  repo: RepoRefSchema,
  number: z.number().int().positive(),
  url: z.string().url().optional(),
  title: z.string().optional(),
  updatedAt: z.string().optional(), // ISO 8601 timestamp
});

export type GitHubPRSource = z.infer<typeof GitHubPRSourceSchema>;

// ========================================
// SourceRef Type: afu9_artifact
// ========================================
export const AFU9ArtifactSourceSchema = z.object({
  kind: z.literal('afu9_artifact'),
  artifactType: z.string().min(1),
  artifactId: z.string().min(1),
  sha256: z.string().optional(),
  ref: z.record(z.string(), z.unknown()).optional(), // Flexible object for artifact metadata
});

export type AFU9ArtifactSource = z.infer<typeof AFU9ArtifactSourceSchema>;

// ========================================
// SourceRef Type: upload
// ========================================
export const UploadSourceSchema = z.object({
  kind: z.literal('upload'),
  uploadId: z.string().uuid(),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  contentSha256: z.string().min(1),
  uploadedAt: z.string().optional(), // ISO 8601 timestamp
});

export type UploadSource = z.infer<typeof UploadSourceSchema>;

// ========================================
// Discriminated Union: SourceRef
// ========================================
export const SourceRefSchema = z.discriminatedUnion('kind', [
  FileSnippetSourceSchema,
  GitHubIssueSourceSchema,
  GitHubPRSourceSchema,
  AFU9ArtifactSourceSchema,
  UploadSourceSchema,
]);

export type SourceRef = z.infer<typeof SourceRefSchema>;

// ========================================
// used_sources: Array of SourceRef
// ========================================
export const UsedSourcesSchema = z.array(SourceRefSchema);

export type UsedSources = z.infer<typeof UsedSourcesSchema>;

// ========================================
// Example JSON for documentation
// ========================================
export const EXAMPLE_USED_SOURCES: UsedSources = [
  {
    kind: 'file_snippet',
    repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
    branch: 'main',
    path: 'control-center/src/lib/db/intentSessions.ts',
    startLine: 129,
    endLine: 189,
    snippetHash: 'a3f2b1c',
    contentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    kind: 'github_issue',
    repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
    number: 732,
    url: 'https://github.com/adaefler-art/codefactory-control/issues/732',
    title: 'E73.2: Sources Panel + used_sources Contract',
    updatedAt: '2025-12-31T16:00:00.000Z',
  },
  {
    kind: 'github_pr',
    repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
    number: 123,
    url: 'https://github.com/adaefler-art/codefactory-control/pull/123',
    title: 'Implement INTENT Console UI Shell',
  },
  {
    kind: 'afu9_artifact',
    artifactType: 'verdict',
    artifactId: 'verdict-20251231-001',
    sha256: 'abc123def456',
    ref: { executionId: 'exec-123', workflowId: 'wf-456' },
  },
  {
    kind: 'upload',
    uploadId: '123e4567-e89b-12d3-a456-426614174000',
    filename: 'requirements.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024000,
    contentSha256: 'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
    uploadedAt: '2026-01-16T10:00:00.000Z',
  },
];
