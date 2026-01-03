export type SmokeEnvFormat = 'plain' | 'json' | 'json_invalid';

export type SmokeKeyExtraction = {
  expectedSmokeKey: string | null;
  envPresent: boolean;
  envFormat: SmokeEnvFormat;
  envLen: number;
};

const JSON_FIELD_PRIORITY = ['smokeKey', 'key', 'value', 'AFU9_SMOKE_KEY'] as const;

export function normalizeSmokeKeyCandidate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    };
  }

  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"');
  if (!looksJson) {
    return {
      expectedSmokeKey: trimmed,
      envPresent: true,
      envFormat: 'plain',
      envLen,
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
      };
    }

    if (typeof parsed === 'number') {
      return {
        expectedSmokeKey: String(parsed),
        envPresent: true,
        envFormat: 'json',
        envLen,
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
            };
          }
        }
        if (typeof v === 'number') {
          return {
            expectedSmokeKey: String(v),
            envPresent: true,
            envFormat: 'json',
            envLen,
          };
        }
      }

      return {
        expectedSmokeKey: null,
        envPresent: true,
        envFormat: 'json',
        envLen,
      };
    }

    // JSON parsed but not a supported shape (array, boolean, null, etc.)
    return {
      expectedSmokeKey: null,
      envPresent: true,
      envFormat: 'json',
      envLen,
    };
  } catch {
    // Spec: if JSON parsing fails, treat as plain string (trimmed)
    return {
      expectedSmokeKey: trimmed,
      envPresent: true,
      envFormat: 'json_invalid',
      envLen,
    };
  }
}
