/**
 * Runbook manifest - central index of all runbooks
 * I905 - Runbooks UX
 */

import { getRunbookMetadata } from './loader';
import { RunbookManifest } from './types';

/**
 * Generate a manifest of all available runbooks
 */
export function generateManifest(): RunbookManifest {
  const runbooks = getRunbookMetadata();
  
  return {
    runbooks,
    generatedAt: new Date().toISOString(),
    totalCount: runbooks.length
  };
}
