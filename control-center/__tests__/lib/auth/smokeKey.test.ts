import { extractSmokeKeyFromEnv } from '../../../src/lib/auth/smokeKey';

describe('extractSmokeKeyFromEnv', () => {
  test('plain "abc" -> "abc"', () => {
    const r = extractSmokeKeyFromEnv('abc');
    expect(r.expectedSmokeKey).toBe('abc');
    expect(r.envFormat).toBe('plain');
  });

  test('" abc \n" -> "abc"', () => {
    const r = extractSmokeKeyFromEnv(' abc \n');
    expect(r.expectedSmokeKey).toBe('abc');
    expect(r.envFormat).toBe('plain');
  });

  test('JSON {"smokeKey":"abc"} -> "abc"', () => {
    const r = extractSmokeKeyFromEnv('{"smokeKey":"abc"}');
    expect(r.expectedSmokeKey).toBe('abc');
    expect(r.envFormat).toBe('json');
  });

  test('JSON {"key":"abc"} -> "abc"', () => {
    const r = extractSmokeKeyFromEnv('{"key":"abc"}');
    expect(r.expectedSmokeKey).toBe('abc');
    expect(r.envFormat).toBe('json');
  });

  test('JSON invalid "{abc" -> trimmed raw', () => {
    const r = extractSmokeKeyFromEnv(' {abc  ');
    expect(r.expectedSmokeKey).toBe('{abc');
    expect(r.envFormat).toBe('json_invalid');
  });
});
