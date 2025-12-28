export interface BuildInfo {
  version: string;
  commitHash: string;
  environment: string;
  timestamp?: string;
}

function normalizeCommitHash(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return 'unknown';
  return trimmed.length > 40 ? trimmed.slice(0, 40) : trimmed;
}

/**
 * Build info derived from build-time env vars.
 *
 * Intended for lightweight display/debug purposes.
 * For the canonical runtime metadata, prefer the `/api/build-metadata` endpoint.
 */
export function getBuildInfo(): BuildInfo {
  return {
    version: (process.env.BUILD_VERSION || process.env.npm_package_version || 'unknown').trim(),
    commitHash: normalizeCommitHash(process.env.BUILD_COMMIT_HASH || process.env.NEXT_BUILD_ID || process.env.GITHUB_SHA),
    environment: (process.env.BUILD_ENV || process.env.DEPLOY_ENV || process.env.NODE_ENV || 'development').trim(),
    timestamp: (process.env.BUILD_TIMESTAMP || '').trim() || undefined,
  };
}

export const buildInfo: BuildInfo = getBuildInfo();

// Back-compat alias (some older code used "buildMetadata")
export const buildMetadata = buildInfo;

export default buildInfo;
