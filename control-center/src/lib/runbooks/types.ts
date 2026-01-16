/**
 * Runbook types for AFU-9 operational documentation
 * I905 - Runbooks UX
 */

export type RunbookTag = 'deploy' | 'migrations' | 'smoke' | 'gh' | 'ops' | 'intent' | 'ecs' | 'db' | 'cloudformation' | 'low-cost' | 'bulk-ops';

export interface RunbookMetadata {
  id: string;
  slug: string;
  title: string;
  filePath: string;
  tags: RunbookTag[];
  lastUpdated?: string;
  purpose?: string;
  canonicalId?: string;
  author?: string;
  version?: string;
}

export interface Runbook extends RunbookMetadata {
  content: string;
}

export interface RunbookManifest {
  runbooks: RunbookMetadata[];
  generatedAt: string;
  totalCount: number;
}
