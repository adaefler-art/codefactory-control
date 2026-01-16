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

export interface RunbookResponse {
  ok: boolean;
  runbook: Runbook;
}

export interface RunbookManifestResponse extends RunbookManifest {
  ok: boolean;
}

export const TAG_COLORS: Record<RunbookTag, string> = {
  'deploy': 'bg-blue-100 text-blue-800',
  'migrations': 'bg-green-100 text-green-800',
  'smoke': 'bg-yellow-100 text-yellow-800',
  'gh': 'bg-purple-100 text-purple-800',
  'ops': 'bg-gray-100 text-gray-800',
  'intent': 'bg-pink-100 text-pink-800',
  'ecs': 'bg-indigo-100 text-indigo-800',
  'db': 'bg-teal-100 text-teal-800',
  'cloudformation': 'bg-orange-100 text-orange-800',
  'low-cost': 'bg-red-100 text-red-800',
  'bulk-ops': 'bg-cyan-100 text-cyan-800',
};
