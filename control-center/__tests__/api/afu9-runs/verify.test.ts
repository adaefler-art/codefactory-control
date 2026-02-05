/**
 * Tests for POST /api/afu9/runs/:runId/verify
 * 
 * E9.3-CTRL-06: Verify Gate (S7 Verdict)
 * 
 * Tests verify that:
 * - Verdict is explicitly set (GREEN or RED, never null/undefined)
 * - Evidence is linked to verdict
 * - No implicit success (fail-closed)
 * - Deterministic evaluation (same evidence → same verdict)
 * - Idempotent (multiple calls → same result)
 */

import { evaluateVerdict, validateVerificationEvidence } from '@/lib/verification/verificationService';
import type { VerificationEvidence } from '@/lib/verification/verificationService';

describe('POST /api/afu9/runs/:runId/verify', () => {
  describe('Evidence Validation', () => {
    it('should reject missing evidence', () => {
      const result = validateVerificationEvidence(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Evidence must be an object');
    });

    it('should reject evidence without deploymentObservations', () => {
      const result = validateVerificationEvidence({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('deploymentObservations is required');
    });

    it('should reject deploymentObservations that is not an array', () => {
      const result = validateVerificationEvidence({
        deploymentObservations: 'not-an-array',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be an array');
    });

    it('should reject invalid deployment observation structure', () => {
      const result = validateVerificationEvidence({
        deploymentObservations: [
          {
            deploymentId: 'not-a-number', // should be number
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('deploymentId must be a number');
    });

    it('should accept valid evidence with only deploymentObservations', () => {
      const result = validateVerificationEvidence({
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid evidence with all optional fields', () => {
      const result = validateVerificationEvidence({
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        healthChecks: [
          {
            endpoint: '/health',
            status: 200,
            responseTime: 100,
            timestamp: '2026-02-05T00:00:00Z',
          },
        ],
        integrationTests: {
          passed: 10,
          failed: 0,
          skipped: 0,
          duration: 5000,
        },
        errorRates: {
          current: 0.01,
          threshold: 0.05,
        },
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Verdict Evaluation - GREEN verdicts', () => {
    it('should return GREEN for authentic successful deployment', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('GREEN');
      expect(result.rationale).toContain('All verification checks passed');
      expect(result.failedChecks).toHaveLength(0);
      expect(result.evaluationRules).toContain('RULE_AUTHENTIC_DEPLOYMENT');
    });

    it('should return GREEN with passing health checks', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        healthChecks: [
          {
            endpoint: '/health',
            status: 200,
            responseTime: 100,
            timestamp: '2026-02-05T00:00:00Z',
          },
          {
            endpoint: '/api/status',
            status: 204,
            responseTime: 50,
            timestamp: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('GREEN');
      expect(result.evaluationRules).toContain('RULE_HEALTH_CHECKS');
    });

    it('should return GREEN with passing integration tests', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        integrationTests: {
          passed: 100,
          failed: 0,
          skipped: 5,
          duration: 10000,
        },
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('GREEN');
      expect(result.evaluationRules).toContain('RULE_INTEGRATION_TESTS');
    });

    it('should return GREEN with acceptable error rates', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        errorRates: {
          current: 0.01,
          threshold: 0.05,
        },
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('GREEN');
      expect(result.evaluationRules).toContain('RULE_ERROR_RATES');
    });
  });

  describe('Verdict Evaluation - RED verdicts (fail-closed)', () => {
    it('should return RED when no authentic deployment exists', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: false, // Not authentic
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
      expect(result.rationale).toContain('No authentic successful deployment');
      expect(result.failedChecks).toContain('No authentic successful deployment found');
    });

    it('should return RED when deployment status is not success', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'failure', // Not successful
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
    });

    it('should return RED when health check fails', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        healthChecks: [
          {
            endpoint: '/health',
            status: 500, // Failed health check
            responseTime: 100,
            timestamp: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
      expect(result.rationale).toContain('Health checks failed');
      expect(result.failedChecks).toContain('Health check failed: /health returned 500');
    });

    it('should return RED when integration tests fail', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        integrationTests: {
          passed: 95,
          failed: 5, // Some tests failed
          skipped: 0,
          duration: 10000,
        },
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
      expect(result.rationale).toContain('Integration tests failed');
      expect(result.failedChecks).toContain('Integration tests failed: 5 failures');
    });

    it('should return RED when error rate exceeds threshold', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
        errorRates: {
          current: 0.10, // Above threshold
          threshold: 0.05,
        },
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
      expect(result.rationale).toContain('Error rate exceeds threshold');
      expect(result.failedChecks).toContain('Error rate 0.1 exceeds threshold 0.05');
    });
  });

  describe('Deterministic Evaluation', () => {
    it('should return same verdict for same evidence', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const result1 = evaluateVerdict(evidence);
      const result2 = evaluateVerdict(evidence);

      expect(result1.verdict).toBe(result2.verdict);
      expect(result1.rationale).toBe(result2.rationale);
      expect(result1.failedChecks).toEqual(result2.failedChecks);
      expect(result1.evaluationRules).toEqual(result2.evaluationRules);
    });

    it('should be deterministic regardless of call order', () => {
      const evidenceGreen: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'success',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      const evidenceRed: VerificationEvidence = {
        deploymentObservations: [
          {
            deploymentId: 123,
            environment: 'production',
            sha: 'abc123',
            status: 'failure',
            isAuthentic: true,
            observedAt: '2026-02-05T00:00:00Z',
          },
        ],
      };

      // Call in different orders
      const green1 = evaluateVerdict(evidenceGreen);
      const red1 = evaluateVerdict(evidenceRed);
      const green2 = evaluateVerdict(evidenceGreen);
      const red2 = evaluateVerdict(evidenceRed);

      expect(green1.verdict).toBe('GREEN');
      expect(green2.verdict).toBe('GREEN');
      expect(red1.verdict).toBe('RED');
      expect(red2.verdict).toBe('RED');
    });
  });

  describe('No Implicit Success (Fail-Closed)', () => {
    it('should never return null or undefined verdict', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).not.toBeNull();
      expect(result.verdict).not.toBeUndefined();
      expect(['GREEN', 'RED']).toContain(result.verdict);
    });

    it('should return RED for empty deploymentObservations (no implicit success)', () => {
      const evidence: VerificationEvidence = {
        deploymentObservations: [],
      };

      const result = evaluateVerdict(evidence);
      expect(result.verdict).toBe('RED');
      expect(result.rationale).toContain('No authentic successful deployment');
    });

    it('should always provide rationale', () => {
      const evidences: VerificationEvidence[] = [
        {
          deploymentObservations: [
            {
              deploymentId: 123,
              environment: 'production',
              sha: 'abc123',
              status: 'success',
              isAuthentic: true,
              observedAt: '2026-02-05T00:00:00Z',
            },
          ],
        },
        {
          deploymentObservations: [
            {
              deploymentId: 123,
              environment: 'production',
              sha: 'abc123',
              status: 'failure',
              isAuthentic: true,
              observedAt: '2026-02-05T00:00:00Z',
            },
          ],
        },
      ];

      for (const evidence of evidences) {
        const result = evaluateVerdict(evidence);
        expect(result.rationale).toBeTruthy();
        expect(result.rationale.length).toBeGreaterThan(0);
      }
    });
  });
});
