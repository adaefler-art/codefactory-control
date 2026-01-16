/**
 * Runbook loader - scans and parses runbooks from docs/runbooks
 * I905 - Runbooks UX
 */

import fs from 'fs';
import path from 'path';
import { Runbook, RunbookMetadata, RunbookTag } from './types';

const RUNBOOKS_DIR = path.join(process.cwd(), '..', 'docs', 'runbooks');

/**
 * Extract metadata from markdown frontmatter and content
 */
function extractMetadata(content: string, filename: string): Omit<RunbookMetadata, 'id' | 'slug' | 'filePath'> {
  const lines = content.split('\n');
  
  // Extract title (first # heading)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : filename.replace('.md', '');
  
  // Extract metadata fields
  const metadata: {
    lastUpdated?: string;
    purpose?: string;
    canonicalId?: string;
    author?: string;
    version?: string;
  } = {};
  
  // Look for common metadata patterns
  const lastUpdatedMatch = content.match(/\*\*Last Updated\*\*:\s*(.+)/i);
  if (lastUpdatedMatch) metadata.lastUpdated = lastUpdatedMatch[1].trim();
  
  const purposeMatch = content.match(/\*\*Purpose\*\*:\s*(.+)/i);
  if (purposeMatch) metadata.purpose = purposeMatch[1].trim();
  
  const canonicalMatch = content.match(/\*\*Canonical ID\*\*:\s*(.+)/i);
  if (canonicalMatch) metadata.canonicalId = canonicalMatch[1].trim();
  
  const authorMatch = content.match(/\*\*Author\*\*:\s*(.+)/i);
  if (authorMatch) metadata.author = authorMatch[1].trim();
  
  const versionMatch = content.match(/\*\*Version\*\*:\s*(.+)/i);
  if (versionMatch) metadata.version = versionMatch[1].trim();
  
  // Infer tags from filename and content
  const tags = inferTags(filename, content);
  
  return {
    title,
    tags,
    ...metadata
  };
}

/**
 * Infer tags from filename and content
 */
function inferTags(filename: string, content: string): RunbookTag[] {
  const tags: RunbookTag[] = [];
  const lowerName = filename.toLowerCase();
  const lowerContent = content.toLowerCase();
  
  // Tag mapping
  const tagPatterns: Record<RunbookTag, string[]> = {
    'deploy': ['deploy', 'deployment', 'ecs', 'cdk'],
    'migrations': ['migration', 'parity', 'schema'],
    'smoke': ['smoke', 'test'],
    'gh': ['github', 'actions', 'workflow', 'checks'],
    'ops': ['ops', 'operational', 'runbook'],
    'intent': ['intent'],
    'ecs': ['ecs', 'fargate', 'circuit breaker'],
    'db': ['database', 'postgres', 'sql', 'db'],
    'cloudformation': ['cloudformation', 'cfn', 'rollback'],
    'low-cost': ['low-cost', 'pause', 'cost'],
    'bulk-ops': ['bulk', 'batch']
  };
  
  for (const [tag, patterns] of Object.entries(tagPatterns)) {
    if (patterns.some(p => lowerName.includes(p) || lowerContent.includes(p))) {
      tags.push(tag as RunbookTag);
    }
  }
  
  // Default to 'ops' if no tags found
  if (tags.length === 0) {
    tags.push('ops');
  }
  
  // Remove duplicates
  return [...new Set(tags)];
}

/**
 * Generate a slug from filename
 */
function generateSlug(filename: string): string {
  return filename
    .replace('.md', '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Load all runbooks from the docs/runbooks directory
 * Returns runbooks in deterministic lexicographic order
 */
export function loadAllRunbooks(): Runbook[] {
  if (!fs.existsSync(RUNBOOKS_DIR)) {
    console.warn(`Runbooks directory not found: ${RUNBOOKS_DIR}`);
    return [];
  }
  
  const files = fs.readdirSync(RUNBOOKS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort(); // Deterministic ordering
  
  const runbooks: Runbook[] = [];
  
  for (const file of files) {
    const filePath = path.join(RUNBOOKS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const metadata = extractMetadata(content, file);
    const slug = generateSlug(file);
    
    runbooks.push({
      id: slug,
      slug,
      filePath: file,
      content,
      ...metadata
    });
  }
  
  return runbooks;
}

/**
 * Load a specific runbook by slug
 */
export function loadRunbookBySlug(slug: string): Runbook | null {
  const runbooks = loadAllRunbooks();
  return runbooks.find(r => r.slug === slug) || null;
}

/**
 * Get runbook metadata only (without content)
 */
export function getRunbookMetadata(): RunbookMetadata[] {
  const runbooks = loadAllRunbooks();
  return runbooks.map(({ content, ...metadata }) => metadata);
}
