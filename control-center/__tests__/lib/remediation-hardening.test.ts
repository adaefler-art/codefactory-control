/**
 * Remediation Playbook Security & Determinism Tests (E77.1 Hardening)
 * 
 * Tests for blocking fixes:
 * - BLOCKING FIX 1: Deterministic hashing (stableStringify)
 * - BLOCKING FIX 2: Secret sanitization (sanitizeRedact)
 * - BLOCKING FIX 3: Concurrency-safe idempotency
 * 
 * @jest-environment node
 */

import {
  stableStringify,
  sanitizeRedact,
  computeInputsHash,
  computeRunKey,
} from '@/lib/contracts/remediation-playbook';

describe('BLOCKING FIX 1: Deterministic Hashing', () => {
  describe('stableStringify', () => {
    test('generates same JSON for same inputs regardless of key order', () => {
      const obj1 = { service: 'api', region: 'us-east-1', env: 'prod' };
      const obj2 = { env: 'prod', service: 'api', region: 'us-east-1' };
      const obj3 = { region: 'us-east-1', env: 'prod', service: 'api' };

      const json1 = stableStringify(obj1);
      const json2 = stableStringify(obj2);
      const json3 = stableStringify(obj3);

      expect(json1).toBe(json2);
      expect(json2).toBe(json3);
      expect(json1).toBe('{"env":"prod","region":"us-east-1","service":"api"}');
    });

    test('handles nested objects with stable key ordering', () => {
      const obj1 = {
        config: { z: 3, a: 1, m: 2 },
        metadata: { name: 'test', id: '123' },
      };
      const obj2 = {
        metadata: { id: '123', name: 'test' },
        config: { a: 1, m: 2, z: 3 },
      };

      const json1 = stableStringify(obj1);
      const json2 = stableStringify(obj2);

      expect(json1).toBe(json2);
    });

    test('handles arrays stably (maintains order)', () => {
      const obj1 = { items: [3, 1, 2], tags: ['c', 'a', 'b'] };
      const obj2 = { tags: ['c', 'a', 'b'], items: [3, 1, 2] };

      const json1 = stableStringify(obj1);
      const json2 = stableStringify(obj2);

      expect(json1).toBe(json2);
      expect(json1).toBe('{"items":[3,1,2],"tags":["c","a","b"]}');
    });

    test('treats undefined as null for stability', () => {
      const obj1 = { a: 1, b: undefined, c: null };
      const obj2 = { a: 1, b: null, c: null };

      const json1 = stableStringify(obj1);
      const json2 = stableStringify(obj2);

      expect(json1).toBe(json2);
    });

    test('throws on circular references', () => {
      const obj: any = { a: 1 };
      obj.self = obj;

      expect(() => stableStringify(obj)).toThrow('cyclic structure');
    });

    test('handles primitives correctly', () => {
      expect(stableStringify(null)).toBe('null');
      expect(stableStringify(42)).toBe('42');
      expect(stableStringify('test')).toBe('"test"');
      expect(stableStringify(true)).toBe('true');
    });
  });

  describe('computeInputsHash with stableStringify', () => {
    test('generates identical hash for same inputs in different key order', () => {
      const inputs1 = { service: 'api', region: 'us-east-1', port: 8080 };
      const inputs2 = { port: 8080, service: 'api', region: 'us-east-1' };
      const inputs3 = { region: 'us-east-1', port: 8080, service: 'api' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      const hash3 = computeInputsHash(inputs3);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    test('generates different hash for different inputs', () => {
      const inputs1 = { service: 'api', env: 'prod' };
      const inputs2 = { service: 'api', env: 'stage' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).not.toBe(hash2);
    });

    test('hash is deterministic across multiple invocations', () => {
      const inputs = { service: 'api', config: { timeout: 30, retries: 3 } };

      const hash1 = computeInputsHash(inputs);
      const hash2 = computeInputsHash(inputs);
      const hash3 = computeInputsHash(inputs);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  describe('computeRunKey determinism', () => {
    test('generates same run_key for same inputs regardless of hash input order', () => {
      const incidentKey = 'deploy_status:prod:deploy-123:2024-01-01';
      const playbookId = 'restart-service';
      
      const inputs1 = { service: 'api', region: 'us-east-1' };
      const inputs2 = { region: 'us-east-1', service: 'api' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      const runKey1 = computeRunKey(incidentKey, playbookId, hash1);
      const runKey2 = computeRunKey(incidentKey, playbookId, hash2);

      expect(runKey1).toBe(runKey2);
    });
  });
});

describe('BLOCKING FIX 2: Secret Sanitization', () => {
  describe('sanitizeRedact', () => {
    test('redacts values for keys containing SECRET', () => {
      const data = {
        service: 'api',
        secret: 'my-secret-value',
        apiSecret: 'another-secret',
        SECRET_KEY: 'sensitive',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.service).toBe('api');
      expect(sanitized.secret).toBe('********');
      expect(sanitized.apiSecret).toBe('********');
      expect(sanitized.SECRET_KEY).toBe('********');
    });

    test('redacts values for keys containing TOKEN', () => {
      const data = {
        username: 'admin',
        token: 'abc123',
        authToken: 'xyz789',
        ACCESS_TOKEN: 'sensitive',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.username).toBe('admin');
      expect(sanitized.token).toBe('********');
      expect(sanitized.authToken).toBe('********');
      expect(sanitized.ACCESS_TOKEN).toBe('********');
    });

    test('redacts values for keys containing PASSWORD', () => {
      const data = {
        email: 'user@example.com',
        password: 'mypassword123',
        userPassword: 'secret',
        DB_PASSWORD: 'dbpass',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.email).toBe('user@example.com');
      expect(sanitized.password).toBe('********');
      expect(sanitized.userPassword).toBe('********');
      expect(sanitized.DB_PASSWORD).toBe('********');
    });

    test('redacts values for keys containing KEY', () => {
      const data = {
        name: 'service',
        apiKey: 'sk-12345',
        api_key: 'pk-67890',
        privateKey: 'rsa-key',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.name).toBe('service');
      expect(sanitized.apiKey).toBe('********');
      expect(sanitized.api_key).toBe('********');
      expect(sanitized.privateKey).toBe('********');
    });

    test('redacts values for keys containing AUTH, COOKIE, HEADER, BEARER', () => {
      const data = {
        auth: 'basic xyz',
        cookie: 'session=abc',
        header: 'Authorization: Bearer token',
        bearer: 'token123',
        credential: 'cred',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.auth).toBe('********');
      expect(sanitized.cookie).toBe('********');
      expect(sanitized.header).toBe('********');
      expect(sanitized.bearer).toBe('********');
      expect(sanitized.credential).toBe('********');
    });

    test('redacts JWT-like patterns', () => {
      const data = {
        service: 'api',
        // JWT-like token (3 base64 segments)
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.service).toBe('api');
      expect(sanitized.jwt).toBe('********');
    });

    test('redacts API key patterns (sk-, pk-, api-, key-)', () => {
      const data = {
        service: 'api',
        stripeKey: 'sk-live-123456789',
        publishableKey: 'pk-test-987654321',
        apiToken: 'api-key-abc123',
        key: 'key-value-xyz',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.service).toBe('api');
      expect(sanitized.stripeKey).toBe('********');
      expect(sanitized.publishableKey).toBe('********');
      expect(sanitized.apiToken).toBe('********');
      expect(sanitized.key).toBe('********');
    });

    test('redacts Bearer token patterns', () => {
      const data = {
        service: 'api',
        authHeader: 'Bearer eyJhbGciOiJIUzI1NiI...',
        bearerToken: 'bearer abc123',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.service).toBe('api');
      expect(sanitized.authHeader).toBe('********');
      expect(sanitized.bearerToken).toBe('********');
    });

    test('recursively sanitizes nested objects', () => {
      const data = {
        config: {
          service: 'api',
          credentials: {
            apiKey: 'secret-key',
            password: 'pass123',
          },
        },
        metadata: {
          name: 'test',
        },
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.config.service).toBe('api');
      expect(sanitized.config.credentials).toBe('********'); // Entire credentials object redacted
      expect(sanitized.metadata.name).toBe('test');
    });

    test('recursively sanitizes arrays', () => {
      const data = {
        items: [
          { name: 'item1', secret: 'secret1' },
          { name: 'item2', token: 'token2' },
        ],
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.items[0].name).toBe('item1');
      expect(sanitized.items[0].secret).toBe('********');
      expect(sanitized.items[1].name).toBe('item2');
      expect(sanitized.items[1].token).toBe('********');
    });

    test('handles null and undefined values', () => {
      const data = {
        service: 'api',
        secret: null,
        token: undefined,
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.service).toBe('api');
      expect(sanitized.secret).toBe('********');
      expect(sanitized.token).toBe('********');
    });

    test('does NOT redact safe values', () => {
      const data = {
        service: 'api',
        region: 'us-east-1',
        port: 8080,
        enabled: true,
        tags: ['prod', 'web'],
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized).toEqual(data);
    });

    test('case-insensitive secret detection', () => {
      const data = {
        SECRET: 'value1',
        Secret: 'value2',
        secret: 'value3',
        TOKEN: 'value4',
        Token: 'value5',
        token: 'value6',
      };

      const sanitized = sanitizeRedact(data);

      expect(sanitized.SECRET).toBe('********');
      expect(sanitized.Secret).toBe('********');
      expect(sanitized.secret).toBe('********');
      expect(sanitized.TOKEN).toBe('********');
      expect(sanitized.Token).toBe('********');
      expect(sanitized.token).toBe('********');
    });
  });
});

describe('BLOCKING FIX 3: Concurrency-Safe Idempotency', () => {
  // Note: Full concurrency tests would require actual database
  // These tests verify the logic/structure is in place
  
  describe('run_key uniqueness', () => {
    test('different incidents generate different run_keys', () => {
      const incidentKey1 = 'deploy_status:prod:deploy-123:2024-01-01';
      const incidentKey2 = 'deploy_status:prod:deploy-456:2024-01-01';
      const playbookId = 'restart-service';
      const inputs = { service: 'api' };
      
      const inputsHash = computeInputsHash(inputs);
      const runKey1 = computeRunKey(incidentKey1, playbookId, inputsHash);
      const runKey2 = computeRunKey(incidentKey2, playbookId, inputsHash);

      expect(runKey1).not.toBe(runKey2);
    });

    test('different playbooks generate different run_keys', () => {
      const incidentKey = 'deploy_status:prod:deploy-123:2024-01-01';
      const playbookId1 = 'restart-service';
      const playbookId2 = 'scale-up';
      const inputs = { service: 'api' };
      
      const inputsHash = computeInputsHash(inputs);
      const runKey1 = computeRunKey(incidentKey, playbookId1, inputsHash);
      const runKey2 = computeRunKey(incidentKey, playbookId2, inputsHash);

      expect(runKey1).not.toBe(runKey2);
    });

    test('different inputs generate different run_keys', () => {
      const incidentKey = 'deploy_status:prod:deploy-123:2024-01-01';
      const playbookId = 'restart-service';
      const inputs1 = { service: 'api' };
      const inputs2 = { service: 'web' };
      
      const inputsHash1 = computeInputsHash(inputs1);
      const inputsHash2 = computeInputsHash(inputs2);
      const runKey1 = computeRunKey(incidentKey, playbookId, inputsHash1);
      const runKey2 = computeRunKey(incidentKey, playbookId, inputsHash2);

      expect(runKey1).not.toBe(runKey2);
    });

    test('same incident + playbook + inputs generate same run_key', () => {
      const incidentKey = 'deploy_status:prod:deploy-123:2024-01-01';
      const playbookId = 'restart-service';
      const inputs = { service: 'api', region: 'us-east-1' };
      
      const inputsHash1 = computeInputsHash(inputs);
      const inputsHash2 = computeInputsHash(inputs);
      const runKey1 = computeRunKey(incidentKey, playbookId, inputsHash1);
      const runKey2 = computeRunKey(incidentKey, playbookId, inputsHash2);

      expect(runKey1).toBe(runKey2);
    });
  });
});

describe('Integration: Determinism + Sanitization', () => {
  test('sanitized values still produce deterministic hashes', () => {
    const data1 = {
      service: 'api',
      token: 'secret-token-123',
      region: 'us-east-1',
    };
    const data2 = {
      region: 'us-east-1',
      service: 'api',
      token: 'different-secret-456', // Different secret value
    };

    const sanitized1 = sanitizeRedact(data1);
    const sanitized2 = sanitizeRedact(data2);

    // Both should have token redacted to same value
    expect(sanitized1.token).toBe('********');
    expect(sanitized2.token).toBe('********');

    // Hashes of sanitized data should be identical
    const hash1 = computeInputsHash(sanitized1);
    const hash2 = computeInputsHash(sanitized2);
    
    expect(hash1).toBe(hash2);
  });

  test('complex nested structure with secrets maintains determinism', () => {
    const data1 = {
      config: { timeout: 30, apiKey: 'secret1' },
      metadata: { env: 'prod', token: 'token1' },
      service: 'api',
    };
    const data2 = {
      service: 'api',
      metadata: { token: 'token2', env: 'prod' },
      config: { apiKey: 'secret2', timeout: 30 },
    };

    const sanitized1 = sanitizeRedact(data1);
    const sanitized2 = sanitizeRedact(data2);

    // Convert to stable JSON to verify structure is identical after sanitization
    const json1 = stableStringify(sanitized1);
    const json2 = stableStringify(sanitized2);

    expect(json1).toBe(json2);
  });
});
