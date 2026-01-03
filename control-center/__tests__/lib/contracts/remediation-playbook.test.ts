/**
 * Remediation Playbook Contracts Tests
 * 
 * Tests for remediation playbook contracts and helper functions:
 * - Evidence predicate checking
 * - Input hash computation (deterministic)
 * - Run key computation
 * - Playbook definition validation
 * 
 * Reference: I771 (E77.1 - Remediation Playbook Framework)
 * 
 * @jest-environment node
 */

import {
  checkEvidencePredicate,
  checkAllEvidencePredicates,
  computeInputsHash,
  computeRunKey,
  validatePlaybookDefinition,
  EvidencePredicate,
  PlaybookDefinition,
} from '@/lib/contracts/remediation-playbook';

describe('Remediation Playbook Contracts', () => {
  // ========================================
  // Evidence Predicate Checking
  // ========================================

  describe('checkEvidencePredicate', () => {
    test('returns true when evidence kind matches and no required fields', () => {
      const predicate: EvidencePredicate = {
        kind: 'runner',
      };

      const evidence = [
        {
          kind: 'runner',
          ref: { runId: 'run-123' },
        },
      ];

      const result = checkEvidencePredicate(predicate, evidence);

      expect(result).toBe(true);
    });

    test('returns false when evidence kind does not match', () => {
      const predicate: EvidencePredicate = {
        kind: 'verification',
      };

      const evidence = [
        {
          kind: 'runner',
          ref: { runId: 'run-123' },
        },
      ];

      const result = checkEvidencePredicate(predicate, evidence);

      expect(result).toBe(false);
    });

    test('returns true when required fields are present', () => {
      const predicate: EvidencePredicate = {
        kind: 'verification',
        requiredFields: ['ref.reportHash', 'sha256'],
      };

      const evidence = [
        {
          kind: 'verification',
          ref: { reportHash: 'hash-123', runId: 'run-123' },
          sha256: 'sha256-hash',
        },
      ];

      const result = checkEvidencePredicate(predicate, evidence);

      expect(result).toBe(true);
    });

    test('returns false when required fields are missing', () => {
      const predicate: EvidencePredicate = {
        kind: 'verification',
        requiredFields: ['ref.reportHash'],
      };

      const evidence = [
        {
          kind: 'verification',
          ref: { runId: 'run-123' }, // Missing reportHash
        },
      ];

      const result = checkEvidencePredicate(predicate, evidence);

      expect(result).toBe(false);
    });

    test('returns true when at least one evidence item has all required fields', () => {
      const predicate: EvidencePredicate = {
        kind: 'verification',
        requiredFields: ['ref.reportHash'],
      };

      const evidence = [
        {
          kind: 'verification',
          ref: { runId: 'run-123' }, // Missing reportHash
        },
        {
          kind: 'verification',
          ref: { reportHash: 'hash-123', runId: 'run-456' }, // Has reportHash
        },
      ];

      const result = checkEvidencePredicate(predicate, evidence);

      expect(result).toBe(true);
    });
  });

  describe('checkAllEvidencePredicates', () => {
    test('returns satisfied=true when all predicates are met', () => {
      const predicates: EvidencePredicate[] = [
        {
          kind: 'runner',
          requiredFields: ['ref.runId'],
        },
        {
          kind: 'verification',
          requiredFields: ['ref.reportHash'],
        },
      ];

      const evidence = [
        {
          kind: 'runner',
          ref: { runId: 'run-123' },
        },
        {
          kind: 'verification',
          ref: { reportHash: 'hash-123' },
        },
      ];

      const result = checkAllEvidencePredicates(predicates, evidence);

      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('returns satisfied=false and lists missing predicates', () => {
      const predicates: EvidencePredicate[] = [
        {
          kind: 'runner',
          requiredFields: ['ref.runId'],
        },
        {
          kind: 'verification',
          requiredFields: ['ref.reportHash'],
        },
      ];

      const evidence = [
        {
          kind: 'runner',
          ref: { runId: 'run-123' },
        },
        // Missing verification evidence
      ];

      const result = checkAllEvidencePredicates(predicates, evidence);

      expect(result.satisfied).toBe(false);
      expect(result.missing).toHaveLength(1);
      expect(result.missing[0].kind).toBe('verification');
    });
  });

  // ========================================
  // Hash and Key Computation
  // ========================================

  describe('computeInputsHash', () => {
    test('generates same hash for same inputs', () => {
      const inputs1 = { service: 'prod-api', region: 'us-east-1' };
      const inputs2 = { service: 'prod-api', region: 'us-east-1' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).toBe(hash2);
    });

    test('generates same hash regardless of key order', () => {
      const inputs1 = { service: 'prod-api', region: 'us-east-1' };
      const inputs2 = { region: 'us-east-1', service: 'prod-api' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different inputs', () => {
      const inputs1 = { service: 'prod-api' };
      const inputs2 = { service: 'stage-api' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).not.toBe(hash2);
    });

    test('generates hash for empty inputs', () => {
      const inputs = {};
      const hash = computeInputsHash(inputs);

      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64); // SHA-256 hex string length
    });
  });

  describe('computeRunKey', () => {
    test('generates run key in correct format', () => {
      const incidentKey = 'test:incident:1';
      const playbookId = 'restart-service';
      const inputsHash = 'abc123';

      const runKey = computeRunKey(incidentKey, playbookId, inputsHash);

      expect(runKey).toBe('test:incident:1:restart-service:abc123');
    });

    test('generates same run key for same inputs', () => {
      const incidentKey = 'test:incident:1';
      const playbookId = 'restart-service';
      const inputsHash = 'abc123';

      const runKey1 = computeRunKey(incidentKey, playbookId, inputsHash);
      const runKey2 = computeRunKey(incidentKey, playbookId, inputsHash);

      expect(runKey1).toBe(runKey2);
    });

    test('generates different run key for different inputs', () => {
      const incidentKey = 'test:incident:1';
      const playbookId = 'restart-service';

      const runKey1 = computeRunKey(incidentKey, playbookId, 'hash1');
      const runKey2 = computeRunKey(incidentKey, playbookId, 'hash2');

      expect(runKey1).not.toBe(runKey2);
    });
  });

  // ========================================
  // Validation
  // ========================================

  describe('validatePlaybookDefinition', () => {
    test('validates correct playbook definition', () => {
      const playbook: PlaybookDefinition = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [
          {
            kind: 'verification',
            requiredFields: ['ref.reportHash'],
          },
        ],
        steps: [
          {
            stepId: 'step1',
            actionType: 'RESTART_SERVICE',
            description: 'Restart the service',
          },
        ],
      };

      const result = validatePlaybookDefinition(playbook);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(playbook);
    });

    test('rejects playbook with missing required fields', () => {
      const invalidPlaybook = {
        id: 'restart-service',
        version: '1.0.0',
        // Missing title
        applicableCategories: [],
        requiredEvidence: [],
        steps: [],
      };

      const result = validatePlaybookDefinition(invalidPlaybook);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('rejects playbook with invalid action type', () => {
      const invalidPlaybook = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: [],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'step1',
            actionType: 'INVALID_ACTION', // Invalid
            description: 'Invalid action',
          },
        ],
      };

      const result = validatePlaybookDefinition(invalidPlaybook);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    test('rejects playbook with empty steps array', () => {
      const invalidPlaybook = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: [],
        requiredEvidence: [],
        steps: [], // Empty steps not allowed
      };

      const result = validatePlaybookDefinition(invalidPlaybook);

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });
});
