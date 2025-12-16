/**
 * KPI Version Validator
 * 
 * Ensures KPI definitions are consistent across the system and that
 * version compatibility is maintained.
 * 
 * Part of: Canonical KPI Definition governance
 */

import { CANONICAL_KPIS, KpiDefinition } from './types/kpi';

/**
 * Current canonical KPI version
 * Must match version in docs/KPI_DEFINITIONS.md
 * 
 * NOTE: This version should be kept in sync with KPI_DEFINITIONS.md manually.
 * Any mismatch will be caught by the CI/CD validation script (validate-kpi-definitions.js).
 * 
 * To update:
 * 1. Update version in docs/KPI_DEFINITIONS.md
 * 2. Update this constant
 * 3. Update all KPI versions in CANONICAL_KPIS (types/kpi.ts)
 * 4. Add entry to docs/KPI_CHANGELOG.md
 * 5. Run: node scripts/validate-kpi-definitions.js
 */
export const CANONICAL_KPI_VERSION = '1.0.0';

/**
 * Version comparison result
 */
export interface VersionCompatibility {
  isCompatible: boolean;
  currentVersion: string;
  expectedVersion: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

/**
 * Validate a KPI version against the canonical version
 */
export function validateKpiVersion(
  kpiName: string,
  version: string
): VersionCompatibility {
  const canonical = CANONICAL_KPIS[kpiName];
  
  if (!canonical) {
    return {
      isCompatible: false,
      currentVersion: version,
      expectedVersion: CANONICAL_KPI_VERSION,
      severity: 'error',
      message: `KPI "${kpiName}" not found in canonical definitions`,
    };
  }

  if (canonical.version !== version) {
    const current = parseVersion(version);
    const expected = parseVersion(canonical.version);

    // Major version mismatch is critical
    if (current.major !== expected.major) {
      return {
        isCompatible: false,
        currentVersion: version,
        expectedVersion: canonical.version,
        severity: 'error',
        message: `Major version mismatch for KPI "${kpiName}": using ${version}, expected ${canonical.version}`,
      };
    }

    // Minor version behind is a warning
    if (current.minor < expected.minor) {
      return {
        isCompatible: true,
        currentVersion: version,
        expectedVersion: canonical.version,
        severity: 'warning',
        message: `KPI "${kpiName}" using outdated version ${version}, latest is ${canonical.version}`,
      };
    }

    // Future minor version is informational
    if (current.minor > expected.minor) {
      return {
        isCompatible: true,
        currentVersion: version,
        expectedVersion: canonical.version,
        severity: 'info',
        message: `KPI "${kpiName}" version ${version} is ahead of canonical ${canonical.version}`,
      };
    }
  }

  return {
    isCompatible: true,
    currentVersion: version,
    expectedVersion: canonical.version,
    severity: 'info',
    message: `KPI "${kpiName}" version is up to date`,
  };
}

/**
 * Validate all KPIs in a snapshot against canonical definitions
 */
export function validateKpiSnapshot(snapshot: {
  kpiName: string;
  kpiVersion: string;
}[]): {
  isValid: boolean;
  errors: VersionCompatibility[];
  warnings: VersionCompatibility[];
} {
  const results = snapshot.map((s) =>
    validateKpiVersion(s.kpiName, s.kpiVersion)
  );

  const errors = results.filter((r) => r.severity === 'error');
  const warnings = results.filter((r) => r.severity === 'warning');

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse semantic version string
 */
function parseVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
} {
  const parts = version.split('.').map(Number);
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
}

/**
 * Check if a version is compatible with the canonical version
 */
export function isVersionCompatible(
  version: string,
  canonicalVersion: string = CANONICAL_KPI_VERSION
): boolean {
  const v = parseVersion(version);
  const c = parseVersion(canonicalVersion);

  // Major version must match
  if (v.major !== c.major) {
    return false;
  }

  // Minor version can be equal or higher (backward compatible)
  return v.minor >= c.minor;
}

/**
 * Get all KPI definitions with their current versions
 */
export function getKpiVersions(): Record<
  string,
  { name: string; version: string; category: string }
> {
  return Object.entries(CANONICAL_KPIS).reduce(
    (acc, [key, kpi]) => {
      acc[key] = {
        name: kpi.name,
        version: kpi.version,
        category: kpi.category,
      };
      return acc;
    },
    {} as Record<string, { name: string; version: string; category: string }>
  );
}

/**
 * Validate that a KPI definition matches the canonical schema
 */
export function validateKpiDefinition(kpi: Partial<KpiDefinition>): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!kpi.name) errors.push('Missing required field: name');
  if (!kpi.version) errors.push('Missing required field: version');
  if (!kpi.category) errors.push('Missing required field: category');
  if (!kpi.level || kpi.level.length === 0)
    errors.push('Missing required field: level');
  if (!kpi.unit) errors.push('Missing required field: unit');
  if (!kpi.formula) errors.push('Missing required field: formula');
  if (!kpi.description) errors.push('Missing required field: description');
  if (!kpi.rationale) errors.push('Missing required field: rationale');

  // Version format
  if (kpi.version && !/^\d+\.\d+\.\d+$/.test(kpi.version)) {
    errors.push(
      `Invalid version format: "${kpi.version}". Must be semver (e.g., 1.0.0)`
    );
  }

  // Category values
  const validCategories = [
    'efficiency',
    'reliability',
    'quality',
    'observability',
    'availability',
    'performance',
    'cost',
  ];
  if (kpi.category && !validCategories.includes(kpi.category)) {
    errors.push(
      `Invalid category: "${kpi.category}". Must be one of: ${validCategories.join(', ')}`
    );
  }

  // Level values
  const validLevels = ['factory', 'product', 'run'];
  if (kpi.level) {
    const invalidLevels = kpi.level.filter((l) => !validLevels.includes(l));
    if (invalidLevels.length > 0) {
      errors.push(
        `Invalid level(s): ${invalidLevels.join(', ')}. Must be one of: ${validLevels.join(', ')}`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate all canonical KPI definitions
 * Useful for CI/CD checks
 */
export function validateAllCanonicalKpis(): {
  isValid: boolean;
  results: Array<{
    kpiKey: string;
    kpiName: string;
    isValid: boolean;
    errors: string[];
  }>;
} {
  const results = Object.entries(CANONICAL_KPIS).map(([key, kpi]) => {
    const validation = validateKpiDefinition(kpi);
    return {
      kpiKey: key,
      kpiName: kpi.name,
      isValid: validation.isValid,
      errors: validation.errors,
    };
  });

  const allValid = results.every((r) => r.isValid);

  return {
    isValid: allValid,
    results,
  };
}

/**
 * Generate a migration guide for upgrading from one KPI version to another
 */
export function generateMigrationGuide(
  fromVersion: string,
  toVersion: string
): {
  isBreaking: boolean;
  changes: Array<{
    type: 'major' | 'minor' | 'patch';
    description: string;
  }>;
  migrationSteps: string[];
} {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);

  const changes: Array<{
    type: 'major' | 'minor' | 'patch';
    description: string;
  }> = [];
  const migrationSteps: string[] = [];

  if (to.major > from.major) {
    changes.push({
      type: 'major',
      description: 'Breaking change: Formula or semantics changed',
    });
    migrationSteps.push('1. Review KPI_CHANGELOG.md for breaking changes');
    migrationSteps.push('2. Update all KPI calculations to new formula');
    migrationSteps.push('3. Recalculate historical data if required');
    migrationSteps.push('4. Update dashboards and alerts');
    migrationSteps.push('5. Test all KPI consumers');
  }

  if (to.minor > from.minor) {
    changes.push({
      type: 'minor',
      description: 'Non-breaking: New KPIs or enhancements added',
    });
    migrationSteps.push('1. Review KPI_CHANGELOG.md for new KPIs');
    migrationSteps.push('2. Update type definitions if needed');
    migrationSteps.push('3. Optionally adopt new KPIs');
  }

  if (to.patch > from.patch) {
    changes.push({
      type: 'patch',
      description: 'Documentation clarification only',
    });
    migrationSteps.push('1. Review updated documentation');
  }

  return {
    isBreaking: to.major > from.major,
    changes,
    migrationSteps:
      migrationSteps.length > 0
        ? migrationSteps
        : ['No migration required - versions are compatible'],
  };
}
