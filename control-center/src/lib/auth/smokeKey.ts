export type SmokeEnvFormat = 'plain' | 'json' | 'json_invalid';

export type SmokeExpectedFormat = 'plain' | 'json-extracted' | 'json-unusable' | 'missing';

export type SmokeKeyExtraction = {
  expectedSmokeKey: string | null;
  envPresent: boolean;
  envFormat: SmokeEnvFormat;
  envLen: number;
  expectedLen: number;
  expectedFormat: SmokeExpectedFormat;
};

const JSON_FIELD_PRIORITY = ['key', 'smokeKey', 'value', 'token', 'secret', 'smoke_key', 'SMOKE_KEY'] as const;

export function normalizeSmokeKeyCandidate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function smokeKeysMatchConstantTime(provided: string | null, expected: string | null): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;

  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto') as typeof import('crypto');
    return nodeCrypto.timingSafeEqual(a, b);
  } catch {
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }
}

export function extractSmokeKeyFromEnv(rawEnv: string | undefined): SmokeKeyExtraction {
  const trimmed = typeof rawEnv === 'string' ? rawEnv.trim() : '';
  const envPresent = trimmed.length > 0;
  const envLen = trimmed.length;

  if (!envPresent) {
    return {
      expectedSmokeKey: null,
      envPresent: false,
      envFormat: 'plain',
      envLen: 0,
      expectedLen: 0,
      expectedFormat: 'missing',
    };
  }

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
  if (!looksJson) {
    return {
      expectedSmokeKey: trimmed,
      envPresent: true,
      envFormat: 'plain',
      envLen,
      expectedLen: trimmed.length,
      expectedFormat: 'plain',
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (typeof parsed === 'string') {
      const normalized = normalizeSmokeKeyCandidate(parsed);
      return {
        expectedSmokeKey: normalized,
        envPresent: true,
        envFormat: 'json',
        envLen,
        expectedLen: normalized?.length ?? 0,
        expectedFormat: normalized ? 'json-extracted' : 'json-unusable',
      };
    }

    if (typeof parsed === 'number') {
      const normalized = String(parsed);
      return {
        expectedSmokeKey: normalized,
        envPresent: true,
        envFormat: 'json',
        envLen,
        expectedLen: normalized.length,
        expectedFormat: 'json-extracted',
      };
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const field of JSON_FIELD_PRIORITY) {
        const v = record[field];
        if (typeof v === 'string') {
          const normalized = normalizeSmokeKeyCandidate(v);
          if (normalized) {
            return {
              expectedSmokeKey: normalized,
              envPresent: true,
              envFormat: 'json',
              envLen,
              expectedLen: normalized.length,
              expectedFormat: 'json-extracted',
            };
          }
        }
        if (typeof v === 'number') {
          const normalized = String(v);
          return {
            expectedSmokeKey: normalized,
            envPresent: true,
            envFormat: 'json',
            envLen,
            expectedLen: normalized.length,
            expectedFormat: 'json-extracted',
          };
        }
      }

      return {
        expectedSmokeKey: null,
        envPresent: true,
        envFormat: 'json',
        envLen,
        expectedLen: 0,
        expectedFormat: 'json-unusable',
      };
    }

    // JSON parsed but not a supported shape (array, boolean, null, etc.)
    return {
      expectedSmokeKey: null,
      envPresent: true,
      envFormat: 'json',
      envLen,
      expectedLen: 0,
      expectedFormat: 'json-unusable',
    };
  } catch {
    // Fail closed: if it looks JSON but isn't parseable, do not allow bypass.
    return {
      expectedSmokeKey: null,
      envPresent: true,
      envFormat: 'json_invalid',
      envLen,
      expectedLen: 0,
      expectedFormat: 'json-unusable',
    };
  }
}
